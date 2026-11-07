import { describe, expect, it } from 'vitest';
import { PROGRAM_STATUS_REPLY, TerminalSignalParser, isTerminalReport } from '../../src/terminal-signals';

describe('terminal signal parser', () => {
  it('parses status, title, notification and bell signals', () => {
    const parser = new TerminalSignalParser();
    const result = parser.scan(`\x1b]7501;state=working:kind=task\x1b\\\x1b]2;Build API\x07\x1b]9;approval needed\x07\x07`);
    expect(result.reports).toEqual([{ state: 'working', kind: 'task', message: undefined }]);
    expect(result.title).toBe('Build API');
    expect(result.notifications).toEqual(['approval needed']);
    expect(result.bell).toBe(true);
  });

  it('handles split sequences and status queries', () => {
    const parser = new TerminalSignalParser();
    expect(parser.scan('\x1b]7501;?').queries).toBe(0);
    expect(parser.scan('\x1b\\').queries).toBe(1);
    expect(PROGRAM_STATUS_REPLY).toContain('7501;?');
  });

  it('recognizes terminal-generated reports', () => {
    expect(isTerminalReport('\x1b[I')).toBe(true);
    expect(isTerminalReport('\x1b[13;2u')).toBe(false);
  });
});
