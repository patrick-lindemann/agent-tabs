import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultProfile,
  isInstalled,
  labelFromTitle,
  launchForCommand,
  missingCommand,
  resolveProfiles,
  shortTitle,
  splitCommandLine,
  terminalLaunch
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
    ['npx -y @openai/codex@latest', 'codex'],
    ['bunx @google/gemini-cli', 'gemini'],
    ['pnpm dlx @anthropic-ai/claude-code', 'claude'],
    ['npx pi', 'pi'],
    ['ssh -p 2222 devbox claude --continue', 'claude'],
    ['tmux new -s work claude', 'claude'],
    ['abduco -A work pi', 'pi'],
    ['nohup env A=1 codex', 'codex'],
    ['"/opt/cursor/cursor-agent" --x', 'cursor'],
    ['bash -lc "claude --continue"', 'claude'],
    ['claudette', undefined],
    ['zsh', undefined],
    // Only the program a command line runs counts, not any word naming an agent
    ['tmux new -s claude', undefined],
    ['tmux attach -t claude', undefined],
    ['docker run --name codex img', undefined],
    ['git log --author pi', undefined],
    ['python -m agent', undefined],
    ['env -S "claude"', undefined]
  ] as Array<[string, AgentId | undefined]>)('reads %s as %s', (line, agent) => {
    expect(resolveProfiles([{ name: 'P', command: line }], false).profiles[0].agent).toBe(agent);
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

describe('the plain terminal', () => {
  it('starts a POSIX shell as a login shell on macOS, like VS Code', () => {
    expect(terminalLaunch('/bin/zsh', 'darwin')).toMatchObject({
      label: 'Terminal',
      command: '/bin/zsh',
      args: ['-l'],
      commandLine: '/bin/zsh -l',
      icon: 'terminal'
    });
    expect(terminalLaunch('/bin/bash', 'linux').args).toEqual([]);
    expect(terminalLaunch('C:\\Windows\\System32\\cmd.exe', 'win32').args).toEqual([]);
  });

  it('comes after the agents when no profile is configured', () => {
    const terminal = terminalLaunch('/bin/zsh', 'linux');
    const { profiles } = resolveProfiles(undefined, false, terminal);
    expect(profiles.at(-1)).toBe(terminal);
    expect(profiles[0].agent).toBeDefined();
    // Configured profiles replace it, so it can be removed
    const configured = resolveProfiles([{ name: 'P', command: 'pi' }], false, terminal);
    expect(configured.profiles.map((p) => p.label)).toEqual(['P']);
  });

  it.each([
    ['zsh', true],
    ['/bin/bash -l', true],
    ['fish --login', true],
    ['pwsh -NoLogo', true],
    ['env A=1 zsh', true],
    ['sh', true],
    ['bash build.sh', true],
    ["sh -c 'echo bye'", true],
    // A known agent's logo wins
    ['bash -lc pi', false],
    ['ssh devbox bash', false],
    ['htop', false]
  ])('shows %s with the terminal icon: %s', (line, terminal) => {
    const [profile] = resolveProfiles([{ name: 'P', command: line }], false).profiles;
    expect(profile.icon === 'terminal').toBe(terminal);
  });

  it.each([
    [undefined, 'claude'],
    ['terminal', 'terminal'],
    ['pi', 'pi'],
    ['sparkle', 'sparkle'],
    // The same as not set
    [null, 'claude']
  ] as const)('uses the icon %s of a profile', (icon, shown) => {
    const { profiles, problems } = resolveProfiles([{ name: 'P', command: 'claude', icon }], false);
    expect(problems).toEqual([]);
    expect(profiles[0].icon).toBe(shown);
    // The icon changes nothing else
    expect(profiles[0].agent).toBe('claude');
  });

  it('skips a profile with an unknown icon, like other invalid entries', () => {
    const { profiles, problems } = resolveProfiles(
      [
        { name: 'P', command: 'claude', icon: 'rocket' },
        { name: 'Q', command: 'pi' }
      ],
      false
    );
    expect(profiles.map((profile) => profile.label)).toEqual(['Q']);
    expect(problems).toEqual([expect.stringContaining('the icon of profile 1 must be one of')]);
  });

  it('has no agent', () => {
    expect(terminalLaunch('/bin/zsh').agent).toBeUndefined();
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
    const [profile] = resolveProfiles(
      [{ name: 'P', command: 'env A=1 codex resume' }],
      true
    ).profiles;
    expect([profile.command, ...profile.args]).toEqual([
      'env',
      'A=1',
      'codex',
      ...CODEX_STATUS_ARGS,
      'resume'
    ]);
  });

  it.each(['tmux new -s codex', 'docker run --name codex img'])(
    'adds nothing to a command that only mentions codex: %s',
    (line) => {
      const [profile] = resolveProfiles([{ name: 'P', command: line }], true).profiles;
      expect([profile.command, ...profile.args]).toEqual(splitCommandLine(line));
    }
  );

  it('adds them after codex run by npx', () => {
    const [profile] = resolveProfiles([{ name: 'P', command: 'npx @openai/codex' }], true).profiles;
    expect(profile.args).toEqual(['@openai/codex', ...CODEX_STATUS_ARGS]);
  });

  it.each(['bash -c "codex --full-auto"', 'bash -lc codex'])(
    'leaves a shell command string alone: %s',
    (line) => {
      const [profile] = resolveProfiles([{ name: 'P', command: line }], true).profiles;
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

  it('needs a unique name for each profile', () => {
    const { profiles, problems } = resolveProfiles(
      [
        { command: 'claude' },
        { name: ' ', command: 'pi' },
        { name: 'Pi', command: 'pi' },
        { name: ' Pi ', command: 'pi --model fast' }
      ],
      false
    );
    expect(profiles.map((p) => p.label)).toEqual(['Pi']);
    expect(problems).toEqual([
      'profile 1 needs a name',
      'profile 2 needs a name',
      'the name of profile 4, "Pi", is already taken'
    ]);
  });

  it('keeps the environment of a profile', () => {
    const [profile] = resolveProfiles(
      [{ name: 'P', command: 'pi', env: { MODEL: 'fast' } }],
      false
    ).profiles;
    expect(profile.env).toEqual({ MODEL: 'fast' });
  });

  it('skips invalid entries and says why', () => {
    const { profiles, problems } = resolveProfiles(
      [
        { name: 'Empty', command: '' },
        { name: 'Number', command: 3 },
        'pi',
        { name: 'Quote', command: "pi 'x" },
        { name: 4, command: 'pi' },
        { name: 'Env', command: 'pi', env: { A: 1 } },
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
      'profile 5 needs a name',
      'the env of profile 6 must map names to text'
    ]);
  });

  it('rejects a setting that is not a list', () => {
    for (const setting of ['claude', { Claude: 'claude' }]) {
      expect(resolveProfiles(setting, false).problems).toEqual([
        'it must be a list of profiles, e.g. [{ "name": "Claude", "command": "claude" }]'
      ]);
    }
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

describe('the default profile', () => {
  const { profiles } = resolveProfiles(
    [
      { name: 'Claude Code', command: 'claude' },
      { name: 'Pi fast', command: 'pi --model fast' },
      { name: 'Codex', command: 'codex' }
    ],
    false
  );

  it('is the first profile when unset', () => {
    expect(defaultProfile(profiles, undefined)).toEqual({ profile: profiles[0] });
    expect(defaultProfile(profiles, ' ')).toEqual({ profile: profiles[0] });
  });

  it('is found by name', () => {
    expect(defaultProfile(profiles, 'Pi fast').profile).toBe(profiles[1]);
    expect(defaultProfile(profiles, ' Codex ').profile).toBe(profiles[2]);
  });

  it('is not found by command line', () => {
    expect(defaultProfile(profiles, 'pi --model fast').profile).toBe(profiles[0]);
  });

  it('falls back to the first profile and says so when not found', () => {
    const { profile, problem } = defaultProfile(profiles, 'Gemini');
    expect(profile).toBe(profiles[0]);
    expect(problem).toBe(
      'the default profile "Gemini" is not one of the profiles, so "Claude Code" is used'
    );
  });
});

describe('finding commands', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
    for (const [name, mode] of [
      ['claude', 0o755],
      ['tmux', 0o755],
      ['npx', 0o755],
      ['ssh', 0o755],
      ['env', 0o755],
      ['bash', 0o755],
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
    expect(missingCommand(launchForCommand('env', ['A=1', 'htop'], false), dir)).toBe('htop');
  });

  it.skipIf(process.platform === 'win32')('does not look for programs that run elsewhere', () => {
    const launch = (line: string) =>
      resolveProfiles([{ name: 'P', command: line }], false).profiles[0];
    expect(missingCommand(launch('npx @openai/codex'), dir)).toBeUndefined();
    expect(missingCommand(launch('ssh devbox pi'), dir)).toBeUndefined();
    expect(missingCommand(launch('bash -lc "cd x && pi"'), dir)).toBeUndefined();
    expect(missingCommand(launch('bash -lc "pi --continue"'), dir)).toBe('pi');
    expect(missingCommand(launch('tmux new -s pi'), dir)).toBeUndefined();
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
    // A tie between English and German goes to English, so `die` stays
    ['Fix the die roll', 4, 'Fix die roll'],
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
