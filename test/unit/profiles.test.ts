import { describe, expect, it } from 'vitest';
import {
  fromLegacyProfiles,
  launchForCommand,
  resolveProfiles,
  shortTitle,
  splitCommandLine
} from '../../src/profiles';

describe('command line profiles', () => {
  it('splits quoted and escaped shell words', () => {
    expect(splitCommandLine(`env NAME="hello world" claude --model 'sonnet'`)).toEqual([
      'env',
      'NAME=hello world',
      'claude',
      '--model',
      'sonnet'
    ]);
    expect(splitCommandLine(`echo 'unfinished`)).toBeUndefined();
  });

  it('detects agents in wrapped commands and adds status args', () => {
    const result = resolveProfiles({ Work: 'tmux new-session claude' }, true);
    expect(result.problems).toEqual([]);
    expect(result.profiles[0]).toMatchObject({ label: 'Work', command: 'tmux', agent: 'claude' });
  });

  it('normalizes legacy profiles and custom commands', () => {
    expect(fromLegacyProfiles([{ id: 'pi', args: ['--name', 'a b'] }])).toEqual({
      Pi: "pi --name 'a b'"
    });
    expect(launchForCommand('/usr/bin/gemini', ['--debug'], false)).toMatchObject({
      agent: 'gemini',
      command: '/usr/bin/gemini'
    });
  });

  it.each([
    ['env FOO=bar tmux new-session -- claude', 'claude'],
    ['"/usr/local/bin/cursor-agent" --x', 'cursor']
  ])('detects agent behind wrappers: %s', (line, agent) =>
    expect(resolveProfiles({ x: line }, false).profiles[0].agent).toBe(agent)
  );
  it('adds codex status configuration only when enabled', () => {
    const enabled = launchForCommand('codex', [], true);
    const disabled = launchForCommand('codex', [], false);
    expect(enabled.args.length).toBeGreaterThan(disabled.args.length);
  });
  it.each([
    ['Make it work', 2, 'Make it'],
    ['The API client', 3, 'API client'],
    ['日本語のテスト', 2, '日本語テスト']
  ])('shortens titles naturally', (text, count, expected) =>
    expect(shortTitle(text, count)).toBe(expected)
  );
});
