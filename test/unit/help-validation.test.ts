import { describe, expect, it } from 'vitest';
import { CommandHelpParser } from '../../src/commandHelpParser';
import { isWebviewMessage } from '../../src/message-validation';

describe('help parsing and protocol guards', () => {
  it('parses GNU flags and continuation text', () => {
    const parsed = new CommandHelpParser().parse('tool', 'Options:\n  -v, --verbose  Show verbose output\n          More details');
    expect(parsed.flags[0]).toMatchObject({ flag: '--verbose', shortFlag: '-v', takesValue: false });
    expect(parsed.flags[0].description).toContain('More details');
  });

  it('validates message shapes and bounds', () => {
    expect(isWebviewMessage({ type: 'resize', id: 'tab', cols: 80, rows: 24 })).toBe(true);
    expect(isWebviewMessage({ type: 'resize', id: '', cols: 80, rows: 24 })).toBe(false);
    expect(isWebviewMessage({ type: 'newTab', extra: true })).toBe(false);
    expect(isWebviewMessage({ type: 'openFile', id: 'tab', path: 'a.ts', line: 3 })).toBe(true);
  });
});
