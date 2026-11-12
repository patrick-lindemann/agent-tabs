import { describe, expect, it } from 'vitest';
import {
  isTerminalReport,
  PROGRAM_STATUS_REPLY,
  type StatusEvent,
  TerminalSignalParser,
  type TerminalSignals
} from '../../src/terminal/signals';
import { msg, notify, query, status, TRANSCRIPTS, title } from './agents';

const scan = (data: string) => new TerminalSignalParser().scan(data);
const reports = (signals: TerminalSignals) =>
  signals.events.flatMap((event) => (event.type === 'report' ? [event.report] : []));

/** Scans data in pieces split at each given position */
function scanSplit(data: string, cuts: number[]): TerminalSignals {
  const parser = new TerminalSignalParser();
  const merged: TerminalSignals = { events: [], queries: 0 };
  let start = 0;
  for (const cut of [...cuts, data.length]) {
    const signals = parser.scan(data.slice(start, cut));
    merged.events.push(...signals.events);
    merged.queries += signals.queries;
    if (signals.title !== undefined) merged.title = signals.title;
    start = cut;
  }
  return merged;
}

describe('program status reports', () => {
  it('reads state, kind and a base64 message', () => {
    expect(
      reports(scan(status(`state=blocked:kind=permission:msg=${msg('Run npm test?')}`)))
    ).toEqual([{ state: 'blocked', kind: 'permission', message: 'Run npm test?' }]);
  });

  it.each(['idle', 'working', 'blocked', 'done', 'error', 'clear'])('accepts state=%s', (state) => {
    expect(reports(scan(status(`state=${state}`)))).toEqual([{ state }]);
  });

  it('accepts BEL as the terminator', () => {
    expect(reports(scan('\x1b]7501;state=done\x07'))).toEqual([{ state: 'done' }]);
  });

  it('ignores unknown keys such as app, title and progress', () => {
    expect(reports(scan(status('state=working:app=claude-code:progress=40:title=QQ==')))).toEqual([
      { state: 'working' }
    ]);
  });

  it.each([
    ['no state', 'app=pi'],
    ['an unknown state', 'state=sleeping'],
    ['a malformed id', 'state=working:id=a b'],
    ['an empty id segment', 'state=working:id=subagents//run'],
    ['an id segment over 32 characters', `state=working:id=${'a'.repeat(33)}`],
    ['a control character in the message', `state=done:msg=${msg('a\x1b[31mb')}`],
    ['a C1 control in the message', `state=done:msg=${msg('a\u009bb')}`],
    ['an oversized message', `state=done:msg=${'A'.repeat(2733)}`],
    ['a message that is not base64', 'state=done:msg=not base64!']
  ])('drops a report with %s', (_, body) => {
    expect(reports(scan(status(body)))).toEqual([]);
  });

  it('reads the id of a child record', () => {
    expect(
      reports(scan(status('state=working:id=subagents/3f9c2a107b1e:app=pi-subagents')))
    ).toEqual([{ state: 'working', id: 'subagents/3f9c2a107b1e', app: 'pi-subagents' }]);
    expect(reports(scan(status('state=clear:id=subagents/3f9c2a107b1e')))).toEqual([
      { state: 'clear', id: 'subagents/3f9c2a107b1e' }
    ]);
  });

  it('counts support queries separately from reports', () => {
    const signals = scan(query + status('state=idle') + query);
    expect(signals.queries).toBe(2);
    expect(reports(signals)).toEqual([{ state: 'idle' }]);
  });

  it('replies with a bare support answer, as the spec allows', () => {
    expect(PROGRAM_STATUS_REPLY).toBe('\x1b]7501;?\x1b\\');
  });
});

describe('titles, notifications and the bell', () => {
  it('keeps the last title of a chunk, from OSC 0 or 2', () => {
    expect(scan(`${title('first')}\x1b]2;second\x1b\\`).title).toBe('second');
  });

  it('reads OSC 9 notifications but not ConEmu progress (9;4)', () => {
    const events = scan(`${notify('Agent turn complete')}\x1b]9;4;3\x07`).events;
    expect(events).toEqual([{ type: 'notification', text: 'Agent turn complete' }]);
  });

  it('reports a bell only outside escape sequences', () => {
    expect(scan(title('x') + notify('y')).events.some((e) => e.type === 'bell')).toBe(false);
    expect(scan('Allow? \x07').events).toEqual([{ type: 'bell' }]);
  });

  it('keeps the order of reports, notifications and bells', () => {
    const events = scan(
      `${status('state=working')}\x07${notify('Approval requested')}${status('state=blocked')}`
    ).events;
    expect(events.map((event: StatusEvent) => event.type)).toEqual([
      'report',
      'bell',
      'notification',
      'report'
    ]);
  });
});

describe('chunk boundaries', () => {
  it('holds an unfinished sequence until its terminator arrives', () => {
    const parser = new TerminalSignalParser();
    expect(parser.scan('\x1b]7501;state=id').events).toEqual([]);
    expect(reports(parser.scan('le\x1b'))).toEqual([]);
    expect(reports(parser.scan('\\'))).toEqual([{ state: 'idle' }]);
  });

  it('gives up on a sequence longer than the protocol allows', () => {
    const parser = new TerminalSignalParser();
    parser.scan(`\x1b]7501;state=done:msg=${'A'.repeat(5000)}`);
    expect(reports(parser.scan(`\x1b\\${status('state=idle')}`))).toEqual([{ state: 'idle' }]);
  });

  // Every agent's output, cut at every position, gives the same signals as in one piece
  for (const transcript of TRANSCRIPTS) {
    const turn = [
      transcript.start,
      transcript.working,
      transcript.blocked ?? '',
      transcript.done
    ].join('');
    it(`reads ${transcript.agent}'s turn the same at any split`, () => {
      const whole = scan(turn);
      for (let cut = 1; cut < turn.length; cut++) {
        expect(scanSplit(turn, [cut]), `split at ${cut}`).toEqual(whole);
      }
    });
  }

  it('reads a turn delivered one character at a time', () => {
    const turn = TRANSCRIPTS[0].start + TRANSCRIPTS[0].working + TRANSCRIPTS[0].done;
    const cuts = Array.from({ length: turn.length - 1 }, (_, i) => i + 1);
    expect(scanSplit(turn, cuts)).toEqual(scan(turn));
  });
});

describe('terminal reports in typed input', () => {
  it.each([
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['SGR mouse press', '\x1b[<0;12;5M'],
    ['legacy mouse', '\x1b[M #!'],
    ['device attributes', '\x1b[?62;22c'],
    ['cursor position', '\x1b[12;40R'],
    ['mode report', '\x1b[?2026;2$y'],
    ['keyboard flags', '\x1b[?1u'],
    ['OSC color reply', '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\'],
    ['several reports', '\x1b[I\x1b[<0;1;1M\x1b[<0;1;1m']
  ])('treats %s as generated by the terminal', (_, data) => {
    expect(isTerminalReport(data)).toBe(true);
  });

  it.each([
    ['Enter', '\r'],
    ['Esc', '\x1b'],
    ['text', 'yes'],
    ['an arrow key', '\x1b[A'],
    ['Shift+Enter (CSI u)', '\x1b[13;2u'],
    ['a report followed by typing', '\x1b[Iy']
  ])('treats %s as typed', (_, data) => {
    expect(isTerminalReport(data)).toBe(false);
  });
});
