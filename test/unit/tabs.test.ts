import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../src/config';
import { launchForCommand } from '../../src/profiles';
import {
  type Multiplexer,
  type OpenResult,
  type SessionEntry,
  type SessionOptions,
  type SessionTag,
  setMultiplexer
} from '../../src/terminal/multiplexer';
import { Tabs, type TabsHost } from '../../src/terminal/tabs';
import type { ExtensionMessage, IPty, OnExitAction, TerminalConfig } from '../../src/types';
import { status } from './agents';

const vscode = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  errors: [] as string[]
}));

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => vscode.settings[key] ?? fallback
    })
  },
  window: {
    showErrorMessage: (message: string) => {
      vscode.errors.push(message);
      return Promise.resolve(undefined);
    }
  }
}));

/** A process started by node-pty, controlled by the test */
interface FakePty extends IPty {
  file: string;
  written: string[];
  size: [number, number];
  killed: boolean;
  emit(data: string): void;
  exit(code: number): void;
}

const spawned: FakePty[] = [];

// PtyManager loads node-pty with require(), which vi.mock does not see
const nodePty = {
  fail: undefined as string | undefined,
  spawn: (file: string, _args: string[], options: { cols: number; rows: number }) => {
    if (nodePty.fail) throw new Error(nodePty.fail);
    let onData: (data: string) => void = () => {};
    let onExit: (event: { exitCode: number }) => void = () => {};
    const pty: FakePty = {
      file,
      written: [],
      killed: false,
      onData: (callback) => {
        onData = callback;
      },
      onExit: (callback) => {
        onExit = callback;
      },
      write: (data) => pty.written.push(data),
      size: [0, 0],
      resize: (cols, rows) => {
        pty.size = [cols, rows];
      },
      kill: () => {
        pty.killed = true;
      },
      emit: (data) => onData(data),
      exit: (exitCode) => onExit({ exitCode })
    };
    pty.size = [options.cols, options.rows];
    spawned.push(pty);
    return pty;
  }
};
const Module = createRequire(__filename)('node:module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const load = Module._load;
beforeAll(() => {
  Module._load = (request, ...rest) => (request === 'node-pty' ? nodePty : load(request, ...rest));
});
afterAll(() => {
  Module._load = load;
});

// Commands found on the PATH; the real missingCommand checks them through isInstalled
const installed = vi.hoisted(() => new Set(['claude', 'codex', 'pi', 'tmux', 'abduco']));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  const known = (file: string) => installed.has(file.split(/[\\/]/).pop() ?? '');
  return {
    ...fs,
    accessSync: (file: string, mode?: number) => {
      if (!known(String(file))) throw new Error('ENOENT');
      return fs.accessSync('/', mode);
    },
    statSync: (file: string) => (known(String(file)) ? { isFile: () => true } : fs.statSync(file))
  };
});

const WORKSPACE = '/work/project';

function config(overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return {
    autoRun: true,
    shell: '/bin/sh',
    env: {},
    directMode: true,
    onExit: 'keep',
    programStatus: true,
    autoTabTitles: true,
    tabTitleWords: 4,
    statusColors: true,
    confirmClose: true,
    monochromeIcons: false,
    profiles: [launchForCommand('claude', [], true)],
    multiplexer: 'none',
    ...overrides
  };
}

function setup(overrides: Partial<TerminalConfig> = {}) {
  let current = config(overrides);
  const posted: ExtensionMessage[] = [];
  const host: TabsHost & { visible: boolean; attached: boolean; refreshes: number } = {
    visible: true,
    attached: true,
    refreshes: 0,
    post: (message) => posted.push(message),
    refresh: () => host.refreshes++,
    isVisible: () => host.visible,
    isAttached: () => host.attached
  };
  const manager = { getConfig: () => current } as unknown as ConfigManager;
  const tabs = new Tabs(manager, host, WORKSPACE);
  const output = (id: string) =>
    posted
      .filter((m): m is Extract<ExtensionMessage, { type: 'output' }> => m.type === 'output')
      .filter((m) => m.id === id)
      .map((m) => m.data)
      .join('');
  return {
    tabs,
    host,
    posted,
    output,
    setOnExit: (onExit: OnExitAction) => {
      current = { ...current, onExit };
    },
    instance: (id: string) => {
      const instance = tabs.state.get(id);
      if (!instance) throw new Error(`no tab ${id}`);
      return instance;
    },
    status: (id: string) => {
      const instance = tabs.state.get(id);
      return instance ? tabs.state.getStatus(instance) : 'gone';
    },
    pty: () => spawned[spawned.length - 1]
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  spawned.length = 0;
  vscode.errors.length = 0;
  vscode.settings = {};
  nodePty.fail = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening and closing tabs', () => {
  it('opens the first profile and shows it', async () => {
    const { tabs, posted, pty } = setup();
    const id = await tabs.create();
    expect(pty().file).toBe('claude');
    expect(tabs.state.getActiveId()).toBe(id);
    expect(posted.map((m) => m.type)).toEqual(['createTab', 'switchTab']);
  });

  it('switches to the last remaining tab after closing the active one', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.switchTo(b);
    tabs.close(b);
    expect(tabs.state.getActiveId()).toBe(c);
    expect(tabs.state.getAllIds()).toEqual([a, c]);
  });

  it('keeps the active tab when closing another', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    tabs.close(a);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('kills the process of a closed tab', async () => {
    const { tabs, pty } = setup();
    const id = await tabs.create();
    const process = pty();
    tabs.close(id);
    expect(process.killed).toBe(true);
  });

  it('opens a new tab after closing the last one', async () => {
    const { tabs } = setup();
    const id = await tabs.create();
    tabs.close(id);
    await vi.runAllTimersAsync();
    expect(tabs.state.count).toBe(1);
    expect(tabs.state.getAllIds()).not.toContain(id);
  });

  it('ignores closing a tab that does not exist', () => {
    const { tabs, posted } = setup();
    tabs.close('nope');
    expect(posted).toEqual([]);
  });
});

describe('switching tabs', () => {
  it('cycles forward and backward, wrapping around', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.cycle(1);
    expect(tabs.state.getActiveId()).toBe(a);
    tabs.cycle(-1);
    expect(tabs.state.getActiveId()).toBe(c);
    tabs.cycle(-1);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('switches by position, with 9 as the last tab', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    await tabs.create();
    const c = await tabs.create();
    tabs.switchToPosition(1);
    expect(tabs.state.getActiveId()).toBe(a);
    tabs.switchToPosition(9);
    expect(tabs.state.getActiveId()).toBe(c);
    tabs.switchToPosition(5);
    expect(tabs.state.getActiveId()).toBe(c);
  });
});

describe('process output', () => {
  it('forwards output and answers the status support query', async () => {
    const { tabs, output, pty } = setup();
    const id = await tabs.create();
    pty().emit('hello\x1b]7501;?\x1b\\');
    expect(output(id)).toContain('hello');
    expect(pty().written).toEqual(['\x1b]7501;?\x1b\\']);
  });

  it('tracks status while the view is gone', async () => {
    const { tabs, host, output, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.attached = false;
    pty().emit(status('state=working'));
    expect(tabStatus(id)).toBe('working');
    expect(output(id)).toBe('');
  });

  it('ignores status reports with programStatus off', async () => {
    const { tabs, status: tabStatus, pty } = setup({ programStatus: false });
    const id = await tabs.create();
    pty().emit(`\x1b]7501;?\x1b\\${status('state=working')}`);
    expect(tabStatus(id)).toBeUndefined();
    expect(pty().written).toEqual([]);
  });

  it('falls back to the prompt detector for agents that report nothing', async () => {
    vscode.settings.promptNotificationDelay = 100;
    const { tabs, status: tabStatus } = setup();
    const a = await tabs.create(launchForCommand('copilot', [], true));
    installed.add('copilot');
    tabs.close(a);
    const id = await tabs.create(launchForCommand('copilot', [], true));
    await tabs.create();
    spawned.find((pty) => pty.file === 'copilot')?.emit('Run this command?\r\n❯ 1. Yes');
    vi.advanceTimersByTime(100);
    expect(tabStatus(id)).toBe('blocked');
    installed.delete('copilot');
  });
});

describe('results in background tabs', () => {
  it('stays done until the tab has been in view for a second', async () => {
    const { tabs, status: tabStatus } = setup();
    const a = await tabs.create();
    const agentA = spawned[0];
    await tabs.create();
    agentA.emit(status('state=working') + status('state=done'));
    expect(tabStatus(a)).toBe('done');

    tabs.switchTo(a);
    vi.advanceTimersByTime(999);
    expect(tabStatus(a)).toBe('done');
    vi.advanceTimersByTime(1);
    expect(tabStatus(a)).toBeUndefined();
  });

  it('stays done when the user only flicks past the tab', async () => {
    const { tabs, status: tabStatus } = setup();
    const a = await tabs.create();
    const agentA = spawned[0];
    const b = await tabs.create();
    agentA.emit(status('state=working') + status('state=done'));
    tabs.switchTo(a);
    vi.advanceTimersByTime(500);
    tabs.switchTo(b);
    vi.advanceTimersByTime(2000);
    expect(tabStatus(a)).toBe('done');
  });

  it('stays done while the view is hidden', async () => {
    const { tabs, host, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.visible = false;
    pty().emit(status('state=working') + status('state=done'));
    expect(tabStatus(id)).toBe('done');
    tabs.scheduleSeen();
    vi.advanceTimersByTime(5000);
    expect(tabStatus(id)).toBe('done');

    host.visible = true;
    tabs.scheduleSeen();
    vi.advanceTimersByTime(1000);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('counts typing into the tab as seen', async () => {
    const { tabs, host, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.visible = false;
    pty().emit(status('state=working') + status('state=done'));
    host.visible = true;
    tabs.input(id, 'n');
    expect(tabStatus(id)).toBeUndefined();
  });
});

describe('typed input', () => {
  it('answers an unreported question with Enter or Esc, not with arrow keys', async () => {
    const { tabs, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    pty().emit(`${status('state=working')}\x07`);
    expect(tabStatus(id)).toBe('blocked');
    tabs.input(id, '\x1b[B');
    expect(tabStatus(id)).toBe('blocked');
    tabs.input(id, '\r');
    expect(tabStatus(id)).toBe('working');

    pty().emit('\x07');
    tabs.input(id, '\x1b');
    expect(tabStatus(id)).toBe('working');
  });

  it('does not count focus and mouse reports as input', async () => {
    vscode.settings.promptNotificationDelay = 100;
    const { tabs, host, status: tabStatus } = setup();
    const a = await tabs.create(launchForCommand('tmux', [], false));
    await tabs.create();
    spawned[0].emit(status('state=done'));
    spawned[0].emit('Continue?');
    vi.advanceTimersByTime(100);
    expect(tabs.state.get(a)?.isWaitingForInput).toBe(true);

    // Clicking into the tab right after switching sends focus and mouse reports
    tabs.switchTo(a);
    host.visible = true;
    tabs.input(a, '\x1b[I\x1b[<0;3;4M\x1b[<0;3;4m');
    expect(spawned[0].written).toContain('\x1b[I\x1b[<0;3;4M\x1b[<0;3;4m');
    expect(tabs.state.get(a)?.isWaitingForInput).toBe(true);
    expect(tabStatus(a)).toBe('done');
  });
});

describe('process exit', () => {
  it.each([
    ['auto', 0, false],
    ['auto', 1, true],
    ['close', 1, false],
    ['keep', 0, true]
  ] as const)('onExit %s with code %i keeps the tab: %s', async (onExit, code, kept) => {
    const { tabs, pty } = setup({ onExit });
    const id = await tabs.create();
    await tabs.create();
    spawned[0].exit(code);
    expect(tabs.state.get(id) !== undefined).toBe(kept);
    expect(pty()).toBe(spawned[1]);
  });

  it('shows the exit code, and Enter restarts the same command', async () => {
    const { tabs, output } = setup();
    const id = await tabs.create(launchForCommand('pi', ['--model', 'x'], true));
    spawned[0].exit(2);
    expect(output(id)).toContain('Process exited with code 2');
    tabs.input(id, 'x');
    expect(spawned).toHaveLength(1);
    tabs.input(id, '\r');
    expect(spawned).toHaveLength(2);
    expect(spawned[1].file).toBe('pi');
    expect(tabs.state.get(id)?.exited).toBe(false);
  });

  it('closes an exited tab with Esc', async () => {
    const { tabs } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].exit(0);
    tabs.input(id, '\x1b');
    expect(tabs.state.get(id)).toBeUndefined();
  });

  it('marks a failed run in a background tab, and clears a working status', async () => {
    const { tabs, status: tabStatus, instance } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status('state=working'));
    spawned[0].exit(1);
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.isBusy(instance(id))).toBe(false);
  });

  it('describes a failed exit without the message of the last report', async () => {
    const { tabs, instance } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status(`state=blocked:msg=${Buffer.from('Allow Bash?').toString('base64')}`));
    spawned[0].exit(1);
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed');
  });

  it('shows no status after a clean exit in a background tab', async () => {
    const { tabs, status: tabStatus } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status('state=working'));
    spawned[0].exit(0);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('restarts with onExit restart, unless the process died at once', async () => {
    const { tabs } = setup({ onExit: 'restart' });
    const id = await tabs.create();
    vi.advanceTimersByTime(3000);
    spawned[0].exit(0);
    expect(spawned).toHaveLength(2);

    spawned[1].exit(1);
    expect(spawned).toHaveLength(2);
    expect(tabs.state.get(id)?.exited).toBe(true);
  });

  it('forgets the previous run when it restarts', async () => {
    const { tabs, status: tabStatus, posted } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(`\x1b]0;✳ Fix login\x07${status('state=error')}`);
    spawned[0].exit(1);
    tabs.input(id, '\r');
    expect(tabStatus(id)).toBeUndefined();
    expect(tabs.state.get(id)?.titleLabel).toBeUndefined();
    expect(posted).toContainEqual({ type: 'clear', id });
  });

  it('ignores exits after the view is gone', async () => {
    const { tabs, host } = setup();
    const id = await tabs.create();
    host.attached = false;
    spawned[0].exit(0);
    expect(tabs.state.get(id)?.exited).toBeFalsy();
  });
});

describe('commands that cannot start', () => {
  it('explains a missing agent instead of starting it', async () => {
    const { tabs, output, status: tabStatus, instance } = setup();
    const id = await tabs.create(launchForCommand('gemini', [], true));
    expect(spawned).toHaveLength(0);
    expect(output(id)).toContain('Gemini CLI is not installed');
    expect(vscode.errors).toEqual([
      'Gemini CLI is not installed: `gemini` was not found on the PATH.'
    ]);
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed: gemini not found');
  });

  it('starts once the agent is installed and the user presses Enter', async () => {
    const { tabs, status: tabStatus } = setup();
    const id = await tabs.create(launchForCommand('gemini', [], true));
    installed.add('gemini');
    tabs.input(id, '\r');
    installed.delete('gemini');
    expect(spawned).toHaveLength(1);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('treats exit code 127 right after starting as not installed', async () => {
    const { tabs, output, status: tabStatus } = setup();
    const id = await tabs.create(launchForCommand('tmux', ['new-session', 'claude'], true));
    vi.advanceTimersByTime(100);
    spawned[0].exit(127);
    expect(output(id)).toContain('was not found on the PATH');
    expect(tabStatus(id)).toBe('error');
  });

  it('treats exit code 127 after a long run as a normal failure', async () => {
    const { tabs, output } = setup();
    const id = await tabs.create();
    vi.advanceTimersByTime(5000);
    spawned[0].exit(127);
    expect(output(id)).toContain('Process exited with code 127');
  });
});

describe('terminal size', () => {
  it('starts new processes with the last size the webview reported', async () => {
    const { tabs } = setup();
    tabs.setSize(120, 40);
    const id = await tabs.create();
    expect(spawned[0].size).toEqual([120, 40]);
    tabs.resize(id, 100, 30);
    expect(spawned[0].size).toEqual([100, 30]);
    await tabs.create();
    expect(spawned[1].size).toEqual([100, 30]);
  });
});

describe('spawn errors', () => {
  it('shows the error with the failed status, and Enter retries', async () => {
    const { tabs, output, status: tabStatus, instance } = setup();
    nodePty.fail = 'posix_spawnp failed';
    const id = await tabs.create();
    expect(output(id)).toContain('Error starting terminal: posix_spawnp failed');
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed: Terminal failed to start');

    nodePty.fail = undefined;
    tabs.input(id, '\r');
    expect(spawned).toHaveLength(1);
    expect(tabStatus(id)).toBeUndefined();
  });
});

describe('reset', () => {
  it('kills every process and forgets the tabs', async () => {
    const { tabs } = setup();
    await tabs.create();
    await tabs.create();
    tabs.reset();
    expect(spawned.every((pty) => pty.killed)).toBe(true);
    expect(tabs.state.count).toBe(0);
    expect(tabs.state.getActiveId()).toBeUndefined();
  });
});

/** A tmux-like multiplexer whose sessions live in memory */
class FakeMultiplexer implements Multiplexer {
  readonly id = 'tmux';
  readonly command = 'tmux';
  /** Sessions with their tag and the exit code of their program once it ended */
  readonly sessions = new Map<
    string,
    { options: SessionOptions; exitCode?: number; attached?: boolean }
  >();
  readonly killed: string[] = [];
  readonly replies: string[] = [];
  tapData: (data: string) => void = () => {};
  tapDisposed = 0;
  fail: string | undefined;

  open(options: SessionOptions, onData: (data: string) => void): Promise<OpenResult> {
    if (this.fail) return Promise.reject(new Error(this.fail));
    const existing = this.sessions.get(options.session);
    if (existing?.exitCode !== undefined) return Promise.resolve({ exitCode: existing.exitCode });
    if (!existing) this.sessions.set(options.session, { options });
    this.tapData = onData;
    return Promise.resolve({
      client: { command: 'tmux', args: ['attach-session', '-t', options.session] },
      tap: {
        reply: (data) => this.replies.push(data),
        dispose: () => this.tapDisposed++
      },
      created: !existing
    });
  }

  /** A session as another window or workspace left it */
  add(
    name: string,
    tag: Partial<SessionTag>,
    state: { exitCode?: number; attached?: boolean } = {}
  ) {
    const fullTag: SessionTag = {
      workspace: WORKSPACE,
      launch: launchForCommand('claude', [], true),
      created: 1,
      ...tag
    };
    this.sessions.set(name, {
      options: { session: name, tag: fullTag } as SessionOptions,
      ...state
    });
  }

  exists(session: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(session));
  }

  list(): Promise<SessionEntry[]> {
    return Promise.resolve(
      [...this.sessions].map(([name, entry]) => ({
        name,
        tag: entry.options.tag,
        ended: entry.exitCode !== undefined,
        attached: entry.attached === true
      }))
    );
  }

  ended(session: string, clientCode: number): Promise<number | undefined> {
    const entry = this.sessions.get(session);
    return Promise.resolve(entry ? entry.exitCode : clientCode);
  }

  kill(session: string): Promise<void> {
    this.killed.push(session);
    this.sessions.delete(session);
    return Promise.resolve();
  }
}

/** An abduco-like multiplexer without sessions */
const noSessions: Multiplexer = {
  id: 'abduco',
  command: 'abduco',
  open: () => Promise.reject(new Error('not used')),
  exists: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
  ended: (_session, code) => Promise.resolve(code),
  kill: () => Promise.resolve()
};

describe('tabs in a multiplexer', () => {
  let tmux: FakeMultiplexer;
  beforeEach(() => {
    tmux = new FakeMultiplexer();
    setMultiplexer(tmux, 'tmux');
    setMultiplexer(noSessions, 'abduco');
  });
  afterEach(() => {
    setMultiplexer(undefined, 'tmux');
    setMultiplexer(undefined, 'abduco');
  });

  const sessionOf = (instance: { session?: { name: string } }) => instance.session?.name ?? '';

  it('runs the profile in a tagged session and shows it with the client', async () => {
    const { tabs, instance, pty } = setup({ multiplexer: 'tmux', env: { A: '1' } });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    expect(session).toMatch(/^agent-tabs-/);
    expect(tmux.sessions.get(session)?.options).toMatchObject({
      command: 'claude',
      args: [],
      env: expect.objectContaining({ A: '1' }) as unknown,
      tag: { workspace: WORKSPACE, launch: { command: 'claude' } }
    });
    expect(pty().file).toBe('tmux');
  });

  it('runs a profile without a session when it says none', async () => {
    const { tabs, pty } = setup({ multiplexer: 'tmux' });
    await tabs.create({ ...launchForCommand('claude', [], true), multiplexer: 'none' });
    await vi.runAllTimersAsync();
    expect(pty().file).toBe('claude');
    expect(tmux.sessions.size).toBe(0);
  });

  it('reads status from the tap and replies through it', async () => {
    const { tabs, pty, status: tabStatus } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    // What the client draws carries no signals of the program
    pty().emit(status('state=error'));
    expect(tabStatus(id)).toBeUndefined();
    tmux.tapData(`\x1b]7501;?\x1b\\${status('state=working')}`);
    expect(tabStatus(id)).toBe('working');
    expect(tmux.replies).toEqual(['\x1b]7501;?\x1b\\']);
    expect(pty().written).toEqual([]);
  });

  it('ends the session when the tab closes', async () => {
    const { tabs, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    tabs.close(id);
    expect(tmux.killed).toEqual([session]);
    expect(tmux.tapDisposed).toBe(1);
    expect(tmux.sessions.size).toBe(1);
  });

  it('keeps sessions when the view goes away and attaches to them again', async () => {
    const { tabs, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    tabs.reset();
    expect(tmux.killed).toEqual([]);

    await expect(tabs.restore()).resolves.toBe(1);
    await vi.runAllTimersAsync();
    const [restored] = tabs.state.getAll();
    expect(restored.session?.name).toBe(session);
    expect(restored.launch.command).toBe('claude');
    expect(tmux.sessions.size).toBe(1);
  });

  it('restores the sessions of this workspace in the order they started', async () => {
    const { tabs } = setup();
    tmux.add('second', { created: 2, launch: launchForCommand('pi', [], true), cwd: '/work/b' });
    tmux.add('first', { created: 1 });
    tmux.add('elsewhere', { workspace: '/other' });
    await expect(tabs.restore()).resolves.toBe(2);
    expect(
      tabs.state.getAll().map((tab) => [tab.session?.name, tab.launch.label, tab.cwd])
    ).toEqual([
      ['first', 'Claude Code', undefined],
      ['second', 'Pi', '/work/b']
    ]);
    expect(tmux.killed).toEqual([]);
  });

  it('leaves a session alone that another window shows', async () => {
    const { tabs } = setup();
    tmux.add('shown', {}, { attached: true });
    const restoring = tabs.restore();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(restoring).resolves.toBe(0);
  });

  it('restores a session whose old client detached meanwhile', async () => {
    const { tabs } = setup();
    tmux.add('reconnected', {}, { attached: true });
    const restoring = tabs.restore();
    const entry = tmux.sessions.get('reconnected');
    if (entry) entry.attached = false;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(restoring).resolves.toBe(1);
  });

  it('ends ended sessions of other workspaces that no window shows', async () => {
    const { tabs } = setup();
    tmux.add('other-ended', { workspace: '/other' }, { exitCode: 0 });
    tmux.add('other-running', { workspace: '/other' });
    tmux.add('other-shown', { workspace: '/other' }, { exitCode: 0, attached: true });
    await expect(tabs.restore()).resolves.toBe(0);
    expect(tmux.killed).toEqual(['other-ended']);
  });

  it('handles the end of the program like an exit', async () => {
    const { tabs, instance, pty, output } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    const entry = tmux.sessions.get(session);
    if (entry) entry.exitCode = 2;
    pty().exit(0);
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('Process exited with code 2');
    expect(tmux.killed).toEqual([session]);
    expect(instance(id).session).toBeUndefined();

    tabs.input(id, '\r');
    await vi.runAllTimersAsync();
    expect(sessionOf(instance(id))).not.toBe(session);
    expect(tmux.sessions.size).toBe(1);
  });

  it('offers to attach again after the client was detached', async () => {
    const { tabs, instance, pty, output, status: tabStatus } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    const first = pty();
    first.exit(0);
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('Detached');
    expect(instance(id).detached).toBe(true);
    expect(tabStatus(id)).toBeUndefined();

    tabs.input(id, '\r');
    await vi.runAllTimersAsync();
    expect(pty()).not.toBe(first);
    expect(sessionOf(instance(id))).toBe(session);

    pty().exit(0);
    await vi.runAllTimersAsync();
    tabs.input(id, '\x1b');
    expect(tabs.state.get(id)).toBeUndefined();
    expect(tmux.killed).toEqual([session]);
  });

  it('shows a program of this workspace that ended while no client was attached', async () => {
    const { tabs, output } = setup();
    tmux.add('done', {}, { exitCode: 1 });
    await tabs.restore();
    await vi.runAllTimersAsync();
    const [tab] = tabs.state.getAll();
    expect(output(tab.id)).toContain('Process exited with code 1');
    expect(tmux.killed).toEqual(['done']);
  });

  it('explains a missing multiplexer', async () => {
    installed.delete('tmux');
    try {
      const { tabs, output } = setup({ multiplexer: 'tmux' });
      const id = await tabs.create();
      expect(output(id)).toContain('`tmux` was not found');
      expect(tmux.sessions.size).toBe(0);
    } finally {
      installed.add('tmux');
    }
  });

  it('shows an error when the session cannot start', async () => {
    tmux.fail = 'server exited unexpectedly';
    const { tabs, output, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('server exited unexpectedly');
    expect(instance(id).session).toBeUndefined();
  });

  it('ends a session that started after its tab closed', async () => {
    const { tabs } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await tabs.create();
    tabs.close(id);
    await vi.runAllTimersAsync();
    expect(tmux.sessions.size).toBe(1);
    expect(tmux.tapDisposed).toBe(1);
  });
});
