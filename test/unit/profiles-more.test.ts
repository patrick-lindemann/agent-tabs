import { describe, expect, it } from 'vitest';
import { launchForCommand, resolveProfiles, shortTitle } from '../../src/profiles/profiles';

describe('profile behaviour and titles', () => {
  it.each([
    ['env FOO=bar tmux new-session -- claude', 'claude'],
    ['"/usr/local/bin/cursor-agent" --x', 'cursor']
  ])('detects agent behind wrappers: %s', (line, agent) => expect(resolveProfiles({ x: line }, false).profiles[0].agent).toBe(agent));
  it('adds codex status configuration only when enabled', () => {
    const enabled = launchForCommand('codex', [], true);
    const disabled = launchForCommand('codex', [], false);
    expect(enabled.args.length).toBeGreaterThan(disabled.args.length);
  });
  it.each([
    ['Make it work', 2, 'Make it'], ['The API client', 3, 'API client'], ['日本語のテスト', 2, '日本語テスト']
  ])('shortens titles naturally', (text, count, expected) => expect(shortTitle(text, count)).toBe(expected));
});
