import { describe, expect, it } from 'vitest';
import { shellClearCommand, shellQuote } from '../../src/terminal/terminal-shell';

describe('shell helpers', () => {
  it.each([
    ['plain', 'plain'], ['a b', "'a b'"], ["it's", "'it'\\''s'"]
  ])('quotes POSIX %s', (input, expected) => expect(shellQuote(input, 'linux')).toBe(expected));
  it('quotes cmd metacharacters', () => expect(shellQuote('a&b', 'win32')).toBe('"a^&b"'));
  it.each([['linux', 'clear'], ['darwin', 'clear'], ['win32', 'cls']] as const)(
    'selects clear command on %s', (platform, expected) => expect(shellClearCommand(platform)).toBe(expected)
  );
});
