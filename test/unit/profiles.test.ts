import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isInstalled,
  labelFromTitle,
  launchForCommand,
  migrateProfiles,
  missingCommand,
  resolveProfiles,
  shortTitle,
  splitCommandLine
} from '../../src/profiles';
import type { AgentId } from '../../src/types';

const CODEX_STATUS_ARGS = [
  '-c',
  'tui.notification_method="osc9"',
  '-c',
  'tui.notifications=["agent-turn-complete","approval-requested"]',
  '-c',
  'tui.notification_condition="always"'
];

describe('splitting command lines', () => {
  it.each([
    ['claude --model sonnet', ['claude', '--model', 'sonnet']],
    [`env NAME="hello world" claude`, ['env', 'NAME=hello world', 'claude']],
    [`pi --name 'my session'`, ['pi', '--name', 'my session']],
    [`echo "a \\"b\\" \\$c"`, ['echo', 'a "b" $c']],
    [`echo a\\ b`, ['echo', 'a b']],
    [`echo ''`, ['echo', '']],
    ['  spaced   out  ', ['spaced', 'out']]
  ])('splits %s', (line, words) => {
    expect(splitCommandLine(line)).toEqual(words);
  });

  it.each([`echo 'open`, 'echo "open'])('rejects an unclosed quote in %s', (line) => {
    expect(splitCommandLine(line)).toBeUndefined();
  });
});

describe('recognizing agents', () => {
  it.each([
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['agy', 'antigravity'],
    ['gemini', 'gemini'],
    ['opencode', 'opencode'],
    ['pi', 'pi'],
    ['agent', 'cursor'],
    ['cursor-agent', 'cursor'],
    ['copilot', 'copilot'],
    ['grok', 'grok'],
    ['hermes', 'hermes'],
    ['devin', 'devin'],
    ['/usr/local/bin/claude', 'claude'],
    ...(process.platform === 'win32' ? [['C:\\Tools\\codex.exe', 'codex']] : []),
    ['gemini.cmd', 'gemini'],
    ['env FOO=bar claude', 'claude'],
    ['tmux new-session -- claude', 'claude'],
    ['npx @openai/codex', 'codex'],
    ['npx pi', 'pi'],
    ['"/opt/cursor/cursor-agent" --x', 'cursor'],
    ['bash -lc "claude --continue"', 'claude'],
    ['claudette', undefined],
    ['zsh', undefined]
  ] as Array<[string, AgentId | undefined]>)('reads %s as %s', (line, agent) => {
    expect(resolveProfiles([{ command: line }], false).profiles[0].agent).toBe(agent);
  });

  it('labels a custom command with the agent name or the executable', () => {
    expect(launchForCommand('/usr/bin/gemini', ['--debug'], false)).toMatchObject({
      label: 'Gemini CLI',
      agent: 'gemini',
      command: '/usr/bin/gemini',
      args: ['--debug']
    });
    expect(launchForCommand('/usr/bin/htop', [], false)).toMatchObject({ label: 'htop' });
  });
});

describe('status arguments', () => {
  it('adds the notification options right after codex', () => {
    expect(launchForCommand('codex', ['--full-auto'], true).args).toEqual([
      ...CODEX_STATUS_ARGS,
      '--full-auto'
    ]);
  });

  it('adds them after codex inside a wrapper', () => {
    const [profile] = resolveProfiles([{ command: 'env A=1 codex resume' }], true).profiles;
    expect([profile.command, ...profile.args]).toEqual([
      'env',
      'A=1',
      'codex',
      ...CODEX_STATUS_ARGS,
      'resume'
    ]);
  });

  it.each(['bash -c "codex --full-auto"', 'bash -lc codex'])(
    'leaves a shell command string alone: %s',
    (line) => {
      const [profile] = resolveProfiles([{ command: line }], true).profiles;
      expect(profile.agent).toBe('codex');
      expect([profile.command, ...profile.args]).toEqual(splitCommandLine(line));
    }
  );

  it('adds nothing with programStatus off or for other agents', () => {
    expect(launchForCommand('codex', [], false).args).toEqual([]);
    expect(launchForCommand('claude', [], true).args).toEqual([]);
  });
});

describe('resolving the profiles setting', () => {
  it('keeps the order of the settings and their command lines', () => {
    const { profiles, problems } = resolveProfiles(
      [
        { name: 'B', command: 'pi' },
        { name: 'A', command: 'claude --continue' }
      ],
      false
    );
    expect(problems).toEqual([]);
    expect(profiles.map((p) => [p.label, p.commandLine])).toEqual([
      ['B', 'pi'],
      ['A', 'claude --continue']
    ]);
  });

  it('names a profile without a name after its agent or program', () => {
    const { profiles } = resolveProfiles(
      [
        { command: 'env A=1 claude' },
        { command: '/usr/bin/htop -d 5' },
        { name: ' ', command: 'pi' }
      ],
      false
    );
    expect(profiles.map((p) => p.label)).toEqual(['Claude Code', 'htop', 'Pi']);
  });

  it('keeps the environment of a profile', () => {
    const [profile] = resolveProfiles([{ command: 'pi', env: { MODEL: 'fast' } }], false).profiles;
    expect(profile.env).toEqual({ MODEL: 'fast' });
  });

  it('skips invalid entries and says why', () => {
    const { profiles, problems } = resolveProfiles(
      [
        { name: 'Empty', command: '' },
        { command: 3 },
        'pi',
        { command: "pi 'x" },
        { name: 4, command: 'pi' },
        { command: 'pi', env: { A: 1 } },
        { name: 'Good', command: 'pi' }
      ],
      false
    );
    expect(profiles.map((p) => p.label)).toEqual(['Good']);
    expect(problems).toEqual([
      'profile 1 needs a command',
      'profile 2 needs a command',
      'profile 3 needs a command',
      'the command of profile 4 has an unclosed quote',
      'the name of profile 5 must be text',
      'the env of profile 6 must map names to text'
    ]);
  });

  it('still reads the table of names and command lines from 2.0', () => {
    const { profiles, problems } = resolveProfiles({ B: 'pi', A: 'claude' }, false);
    expect(problems).toEqual([]);
    expect(profiles.map((p) => [p.label, p.commandLine])).toEqual([
      ['B', 'pi'],
      ['A', 'claude']
    ]);
    expect(migrateProfiles({ B: 'pi' })).toEqual([{ name: 'B', command: 'pi' }]);
    expect(migrateProfiles([{ command: 'pi' }])).toBeUndefined();
  });

  it('rejects a setting that is not a list', () => {
    expect(resolveProfiles('claude', false).problems).toEqual(['it must be a list of profiles']);
  });

  it('offers every agent when none is configured or installed', () => {
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
      const { profiles } = resolveProfiles(undefined, false);
      expect(profiles.map((p) => p.agent)).toEqual([
        'claude',
        'codex',
        'antigravity',
        'gemini',
        'opencode',
        'pi',
        'cursor',
        'copilot',
        'grok',
        'hermes',
        'devin'
      ]);
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('finding commands', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
    for (const [name, mode] of [
      ['claude', 0o755],
      ['tmux', 0o755],
      ['notes', 0o644]
    ] as const) {
      fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n', { mode });
    }
    fs.mkdirSync(path.join(dir, 'folder'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.skipIf(process.platform === 'win32')('finds executables on the given PATH only', () => {
    expect(isInstalled('claude', dir)).toBe(true);
    expect(isInstalled('notes', dir)).toBe(false);
    expect(isInstalled('folder', dir)).toBe(false);
    expect(isInstalled('codex', dir)).toBe(false);
    expect(isInstalled(path.join(dir, 'claude'), '')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('names the missing command or wrapped agent', () => {
    const wrapped = launchForCommand('tmux', ['new-session', 'claude'], false);
    expect(missingCommand(wrapped, dir)).toBeUndefined();
    expect(missingCommand(launchForCommand('screen', [], false), dir)).toBe('screen');
    expect(missingCommand(launchForCommand('tmux', ['new-session', 'pi'], false), dir)).toBe('pi');
    expect(missingCommand(launchForCommand('tmux', ['ls'], false), dir)).toBeUndefined();
  });
});

describe('tab labels from terminal titles', () => {
  const label = (agent: string, text: string) =>
    labelFromTitle(text, launchForCommand(agent, [], false));

  it('drops a title that only names the program', () => {
    expect(label('claude', 'Claude Code')).toBeUndefined();
    expect(label('htop', 'htop')).toBeUndefined();
    expect(label('claude', '⠂  ')).toBeUndefined();
  });

  it('shortens a very long title', () => {
    const result = label('claude', `✳ ${'word '.repeat(30)}`);
    expect(result).toHaveLength(80);
    expect(result?.endsWith('…')).toBe(true);
  });

  it('keeps an unknown program title without leading glyphs', () => {
    expect(label('htop', '● build: 3 errors')).toBe('build: 3 errors');
  });
});

describe('shortening titles', () => {
  it.each([
    ['Refactor the API client', 4, 'Refactor API client'],
    ['The API client', 3, 'API client'],
    ['Make it work', 2, 'Make it'],
    ['Make it work', 1, 'work'],
    ['Fix the login bug in the settings page', 3, 'Fix login bug'],
    ['Behebe den Fehler in der Anmeldung', 3, 'Behebe Fehler Anmeldung'],
    ['日本語のテスト', 2, '日本語テスト'],
    ['src/app.ts: fix', 4, 'src/app.ts fix'],
    ['!!!', 4, undefined]
  ] as Array<[string, number, string | undefined]>)(
    'shortens %j to %i words',
    (text, count, expected) => {
      expect(shortTitle(text, count)).toBe(expected);
    }
  );
});
