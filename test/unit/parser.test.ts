import { describe, expect, it } from 'vitest';
import { CommandHelpParser } from '../../src/picker/parser';

describe('command help parsing', () => {
  it('parses GNU flags and continuation text', () => {
    const parsed = new CommandHelpParser().parse(
      'tool',
      'Options:\n  -v, --verbose  Show verbose output\n          More details'
    );
    expect(parsed.flags[0]).toMatchObject({
      flag: '--verbose',
      shortFlag: '-v',
      takesValue: false
    });
    expect(parsed.flags[0].description).toContain('More details');
  });
});
