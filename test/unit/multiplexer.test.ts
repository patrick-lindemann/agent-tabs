import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { launchForCommand } from '../../src/profiles';
import {
  Abduco,
  ControlModeParser,
  decodeTag,
  encodeTag,
  hexBytes,
  type Run,
  type SessionOptions,
  type SessionTag,
  Tmux
} from '../../src/terminal/multiplexer';

const TAG: SessionTag = {
  workspace: '/work',
  launch: launchForCommand('claude', ['--continue'], true),
  cwd: '/work',
  created: 1
};

const OPTIONS: SessionOptions = {
  session: 'agent-tabs-1',
  command: 'claude',
  args: ['--continue'],
  env: { A: '1' },
  cwd: '/work',
  cols: 100,
  rows: 30,
  tag: TAG
};

/** Records commands and answers them from a table of argument prefixes */
function fakeRun(answers: Array<[string, string | Error]> = []) {
  const calls: string[][] = [];
  const execute: Run = (command, args) => {
    calls.push([command, ...args]);
    const line = args.join(' ');
    const answer = answers.find(([prefix]) => line.includes(prefix))?.[1] ?? '';
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { calls, execute };
}

function fakeControl() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdin.on('data', (chunk: Buffer) => written.push(chunk.toString()));
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
    killed: false,
    kill: () => {
      child.killed = true;
      return true;
    }
  });
  return { child, written, args: [] as string[] };
}

describe('tmux control mode output', () => {
  it('decodes octal escapes, keeps other bytes and skips other lines', () => {
    const out: string[] = [];
    const parser = new ControlModeParser((data) => out.push(data));
    parser.push(
      Buffer.from('%begin 1 2 0\n%end 1 2 0\n%output %0 \\033]7501;state=working\\033\\134')
    );
    expect(out).toEqual([]);
    parser.push(Buffer.from('\n%window-renamed @1 x\n%output %0 a\\134b\\007\n'));
    expect(out).toEqual(['\x1b]7501;state=working\x1b\\', 'a\\b\x07']);
  });

  it('keeps UTF-8 characters split across lines', () => {
    const out: string[] = [];
    const parser = new ControlModeParser((data) => out.push(data));
    const bytes = Buffer.from('π', 'utf8');
    parser.push(
      Buffer.concat([Buffer.from('%output %0 '), bytes.subarray(0, 1), Buffer.from('\n')])
    );
    parser.push(Buffer.concat([Buffer.from('%output %0 '), bytes.subarray(1), Buffer.from('\n')]));
    expect(out.join('')).toBe('π');
  });

  it('writes bytes for send-keys -H', () => {
    expect(hexBytes('\x1b]π')).toEqual(['1b', '5d', 'cf', '80']);
  });
});

describe('tmux sessions', () => {
  it('starts a held session on its own server and releases it once tapped', async () => {
    const { calls, execute } = fakeRun([['has-session', new Error('no session')]]);
    const control = fakeControl();
    const tmux = new Tmux(execute, (args) => {
      control.args = args;
      return control.child as never;
    });
    const result = await tmux.open(OPTIONS, () => {});
    if (!('client' in result)) throw new Error('no client');

    const newSession = calls.find((call) => call.includes('new-session')) ?? [];
    expect(newSession.slice(0, 3)).toEqual(['tmux', '-L', 'agent-tabs']);
    expect(newSession).toEqual(expect.arrayContaining(['-e', 'A=1', '-c', '/work', '-x', '100']));
    const program = newSession.indexOf('--');
    expect(newSession.slice(program + 4, program + 9)).toEqual([
      'tmux',
      'agent-tabs-1',
      'claude',
      '--continue',
      ';'
    ]);
    expect(result.client).toEqual({
      command: 'tmux',
      args: ['-L', 'agent-tabs', 'attach-session', '-t', '=agent-tabs-1']
    });
    expect(result.created).toBe(true);
    expect(control.args).toEqual([
      '-L',
      'agent-tabs',
      '-C',
      'attach-session',
      '-t',
      '=agent-tabs-1'
    ]);
    expect(control.written.join('')).toBe(
      'refresh-client -f ignore-size\nwait-for -S agent-tabs-1\n'
    );

    result.tap?.reply('\x1b]7501;?\x1b\\');
    expect(control.written.at(-1)).toBe(
      'send-keys -t =agent-tabs-1: -H 1b 5d 37 35 30 31 3b 3f 1b 5c\n'
    );
    result.tap?.dispose();
    expect(control.child.killed).toBe(true);
  });

  it('attaches to a running session without starting or releasing it', async () => {
    const { calls, execute } = fakeRun([['display-message', ' 0  \n']]);
    const control = fakeControl();
    const tmux = new Tmux(execute, () => control.child as never);
    const result = await tmux.open(OPTIONS, () => {});
    expect(calls.some((call) => call.includes('new-session'))).toBe(false);
    expect('client' in result && result.created).toBe(false);
    expect(control.written.join('')).toBe('refresh-client -f ignore-size\n');
  });

  it('feeds the control client output to the tap', async () => {
    const { execute } = fakeRun([['display-message', ' 0  ']]);
    const control = fakeControl();
    const tmux = new Tmux(execute, () => control.child as never);
    const out: string[] = [];
    await tmux.open(OPTIONS, (data) => out.push(data));
    control.child.stdout.write('%output %1 hi\\033\n');
    expect(out).toEqual(['hi\x1b']);
  });

  it('reports the exit code of a program that ended', async () => {
    const tmux = new Tmux(fakeRun([['display-message', '3 0  \n']]).execute);
    await expect(tmux.open(OPTIONS, () => {})).resolves.toEqual({ exitCode: 3 });
    await expect(tmux.ended('s', 0)).resolves.toBe(3);
    const dead = new Tmux(fakeRun([['display-message', ' 1 5 \n']]).execute);
    await expect(dead.ended('s', 0)).resolves.toBe(5);
    const signalled = new Tmux(fakeRun([['display-message', ' 1  9\n']]).execute);
    await expect(signalled.ended('s', 0)).resolves.toBe(137);
  });

  it('tells a detached client from an ended session', async () => {
    const running = new Tmux(fakeRun([['display-message', ' 0  \n']]).execute);
    await expect(running.ended('s', 0)).resolves.toBeUndefined();
    const gone = new Tmux(fakeRun([['has-session', new Error('no session')]]).execute);
    await expect(gone.ended('s', 4)).resolves.toBe(4);
  });

  it('tags a new session', async () => {
    const { calls, execute } = fakeRun([['has-session', new Error('no session')]]);
    await new Tmux(execute, () => fakeControl().child as never).open(OPTIONS, () => {});
    const newSession = calls.find((call) => call.includes('new-session')) ?? [];
    const option = newSession.indexOf('@agent-tabs');
    expect(newSession[option - 1]).toBe('=agent-tabs-1:');
    expect(decodeTag(newSession[option + 1])).toEqual(TAG);
  });

  it('lists only tagged sessions', async () => {
    const tag = encodeTag(TAG);
    const listing = [
      `0 0  ${tag} agent-tabs-1`,
      `1 1  ${tag} agent-tabs-2`,
      `0 0 0 ${tag} agent-tabs-3`,
      '0 0   mine',
      '0 0  bm90IGEgdGFn forged',
      ''
    ].join('\n');
    const tmux = new Tmux(fakeRun([['list-sessions', listing]]).execute);
    await expect(tmux.list()).resolves.toEqual([
      { name: 'agent-tabs-1', tag: TAG, ended: false, attached: false },
      { name: 'agent-tabs-2', tag: TAG, ended: true, attached: true },
      { name: 'agent-tabs-3', tag: TAG, ended: true, attached: false }
    ]);
    const noServer = new Tmux(fakeRun([['list-sessions', new Error('no server')]]).execute);
    await expect(noServer.list()).resolves.toEqual([]);
  });

  it('kills a session and ignores one that is gone', async () => {
    const { calls, execute } = fakeRun([['kill-session', new Error('no session')]]);
    await new Tmux(execute).kill('s');
    expect(calls).toEqual([['tmux', '-L', 'agent-tabs', 'kill-session', '-t', '=s']]);
  });

  it('replaces the tag of a session', async () => {
    const { calls, execute } = fakeRun();
    await new Tmux(execute).updateTag('s', TAG);
    expect(calls).toEqual([
      ['tmux', '-L', 'agent-tabs', 'set-option', '-t', '=s:', '@agent-tabs', encodeTag(TAG)]
    ]);
  });
});

describe('abduco sessions', () => {
  const LIST =
    'Active sessions (on host box)\n' +
    '* Tue\t 2026-11-10 13:43:12\trunning\n' +
    '+ Tue\t 2026-11-10 13:43:12\tended\n' +
    '  Tue\t 2026-11-10 13:43:12\tdetached\n';
  let tags: string;
  beforeEach(() => {
    tags = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tabs-tags-'));
  });
  afterEach(() => {
    fs.rmSync(tags, { recursive: true, force: true });
  });

  it('creates or attaches with one client and needs no tap', async () => {
    const abduco = new Abduco(fakeRun([['', LIST]]).execute, tags);
    await expect(abduco.open({ ...OPTIONS, session: 'running' })).resolves.toEqual({
      client: { command: 'abduco', args: ['-A', 'running', 'claude', '--continue'] },
      created: false
    });
    await expect(abduco.open(OPTIONS)).resolves.toMatchObject({ created: true });
  });

  it('knows sessions, also without any', async () => {
    const abduco = new Abduco(fakeRun([['', LIST]]).execute, tags);
    await expect(abduco.exists('ended')).resolves.toBe(true);
    await expect(abduco.exists('other')).resolves.toBe(false);
    await expect(abduco.ended('running', 0)).resolves.toBeUndefined();
    await expect(abduco.ended('ended', 2)).resolves.toBe(2);
    const empty = new Abduco(() => Promise.reject(new Error('no sessions')), tags);
    await expect(empty.exists('running')).resolves.toBe(false);
  });

  it('lists only sessions with a tag file and removes tags of sessions that are gone', async () => {
    const abduco = new Abduco(fakeRun([['', LIST]]).execute, tags);
    for (const name of ['running', 'ended', 'gone']) {
      fs.writeFileSync(path.join(tags, `${name}.tag`), encodeTag(TAG));
    }
    fs.writeFileSync(path.join(tags, 'detached.tag'), 'not a tag');
    await expect(abduco.list()).resolves.toEqual([
      { name: 'ended', tag: TAG, ended: true, attached: false },
      { name: 'running', tag: TAG, ended: false, attached: true }
    ]);
    expect(fs.existsSync(path.join(tags, 'gone.tag'))).toBe(false);
    await expect(new Abduco(fakeRun().execute, path.join(tags, 'none')).list()).resolves.toEqual(
      []
    );
  });

  it('kills the server of a session and removes its tag', async () => {
    const { calls, execute } = fakeRun([['', LIST]]);
    const abduco = new Abduco(execute, tags);
    await abduco.open({ ...OPTIONS, session: 'gone' });
    await abduco.kill('running');
    await abduco.kill('gone');
    expect(calls.filter(([command]) => command === 'pkill')).toEqual([
      ['pkill', '-f', 'abduco -A running ']
    ]);
    expect(fs.readdirSync(tags)).toEqual([]);
  });

  it('replaces the tag file of a session', async () => {
    const abduco = new Abduco(fakeRun([['', LIST]]).execute, tags);
    await abduco.open({ ...OPTIONS, session: 'detached' });
    const started = { ...TAG, conversation: { id: 'c', started: true } };
    await abduco.updateTag('detached', started);
    await expect(abduco.list()).resolves.toEqual([
      { name: 'detached', tag: started, ended: false, attached: false }
    ]);
  });
});

describe('session tags', () => {
  it('reads back what it wrote and rejects anything else', () => {
    expect(decodeTag(encodeTag(TAG))).toEqual(TAG);
    expect(decodeTag('')).toBeUndefined();
    expect(decodeTag('%%%')).toBeUndefined();
    expect(decodeTag(Buffer.from('{"workspace":1}').toString('base64'))).toBeUndefined();
  });
});
