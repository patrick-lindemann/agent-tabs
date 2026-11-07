import { describe, expect, it } from 'vitest';
import { fromLegacyProfiles, launchForCommand, resolveProfiles, splitCommandLine } from '../../src/profiles/profiles';

describe('command line profiles', () => {
  it('splits quoted and escaped shell words', () => {
    expect(splitCommandLine(`env NAME="hello world" claude --model 'sonnet'`)).toEqual([
      'env', 'NAME=hello world', 'claude', '--model', 'sonnet'
    ]);
    expect(splitCommandLine(`echo 'unfinished`)).toBeUndefined();
  });

  it('detects agents in wrapped commands and adds status args', () => {
    const result = resolveProfiles({ Work: 'tmux new-session claude' }, true);
    expect(result.problems).toEqual([]);
    expect(result.profiles[0]).toMatchObject({ label: 'Work', command: 'tmux', agent: 'claude' });
  });

  it('normalizes legacy profiles and custom commands', () => {
    expect(fromLegacyProfiles([{ id: 'pi', args: ['--name', 'a b'] }])).toEqual({ Pi: "pi --name 'a b'" });
    expect(launchForCommand('/usr/bin/gemini', ['--debug'], false)).toMatchObject({ agent: 'gemini', command: '/usr/bin/gemini' });
  });
});
