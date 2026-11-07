import { describe, expect, it } from 'vitest';
import { PROGRAM_STATUS_REPLY, TerminalSignalParser, isTerminalReport } from '../../src/terminal-signals';

describe('terminal signals', () => {
  it('parses status, title, notification and bell', () => {
    const p = new TerminalSignalParser();
    const result = p.scan('\x1b]7501;state=working:msg=SGVsbG8=\x1b\\\x1b]2;Build API\x07\x1b]9;approve\x07\x07');
    expect(result.reports).toEqual([{ state: 'working', message: 'Hello' }]);
    expect(result.title).toBe('Build API');
    expect(result.notifications).toEqual(['approve']);
    expect(result.bell).toBe(true);
  });
  it('handles sequences split across PTY chunks and queries', () => {
    const p = new TerminalSignalParser();
    expect(p.scan('\x1b]7501;state=idle').reports).toEqual([]);
    expect(p.scan(':kind=agent\x1b\\').reports).toEqual([{ state: 'idle', kind: 'agent' }]);
    expect(p.scan('\x1b]7501;?\x1b\\').queries).toBe(1);
    expect(PROGRAM_STATUS_REPLY).toContain('7501;?');
  });
  it('recognizes terminal-generated reports but not typed CSI-u input', () => {
    expect(isTerminalReport('\x1b[I')).toBe(true);
    expect(isTerminalReport('\x1b[13;2u')).toBe(false);
  });
});
