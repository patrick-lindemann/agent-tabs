import type { ProgramState } from '../types';

/**
 * Reads the signals CLI agents write to their terminal:
 *
 * - Program Status Protocol (OSC 7501) reports and support queries.
 *   https://www.superlogical.com/rex/docs/build/program-status
 *   pi and Claude Code only report after the terminal answers `OSC 7501 ; ?`,
 *   so the extension host replies directly, which works while the webview is
 *   hidden.
 * - Window titles (OSC 0 and 2), used as tab labels.
 * - Notifications (OSC 9), which Codex writes when a turn completes or needs
 *   approval.
 * - The terminal bell (BEL outside an escape sequence), which some dialogs
 *   ring when they ask the user something.
 *
 * A report without `id` is the program's own (root) record. A report with
 * `id` is a child record, e.g. pi-subagents' `subagents/<run>` for each
 * background run, which can be working while the root record is done.
 */

export interface ProgramStatusReport {
  /** `clear` removes the record, and a child record's descendants */
  state: ProgramState | 'clear';
  /** The child record, e.g. `subagents/3f9c2a107b1e`; none for the root record */
  id?: string;
  /** The program that sent it, e.g. `pi-subagents` */
  app?: string;
  kind?: string;
  message?: string;
}

/** A status report, notification or bell, in the order the program wrote them */
export type StatusEvent =
  | { type: 'report'; report: ProgramStatusReport }
  | { type: 'notification'; text: string }
  | { type: 'bell' };

export interface TerminalSignals {
  events: StatusEvent[];
  /** Number of OSC 7501 support queries that need a reply */
  queries: number;
  /** Last window title in the chunk */
  title?: string;
}

export const PROGRAM_STATUS_REPLY = '\x1b]7501;?\x1b\\';

/**
 * Input that xterm.js generates itself rather than the user typing it:
 * focus reports (`CSI I`, `CSI O`), mouse reports (SGR `CSI < … M/m` and
 * legacy `CSI M` + 3 bytes) and replies to the program's queries (device
 * attributes and status, cursor position, mode and keyboard-flag reports,
 * OSC replies such as colors). CSI-u keys such as Shift+Enter (`CSI 13;2u`)
 * are typed input and do not match. Programs like pi turn on focus and mouse reporting, so clicking
 * into the terminal sends these.
 */
const TERMINAL_REPORT =
  /^(?:\x1b\[[IO]|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[?>=]?[\d;]*(?:[cnR]|\$y)|\x1b\[\?\d*u|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/;

export function isTerminalReport(data: string): boolean {
  return TERMINAL_REPORT.test(data);
}

const OSC = '\x1b]';
const MAX_SEQUENCE_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 2732;
const STATES = new Set<string>(['idle', 'working', 'blocked', 'done', 'error', 'clear']);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/** The protocol's id grammar: up to 8 segments of 1 to 32 characters, 128 in all */
const RECORD_ID = /^[A-Za-z0-9_.+-]{1,32}(?:\/[A-Za-z0-9_.+-]{1,32}){0,7}$/;

export class TerminalSignalParser {
  private pending = '';

  scan(data: string): TerminalSignals {
    const signals: TerminalSignals = { events: [], queries: 0 };
    const text = this.pending + data;
    this.pending = '';

    let position = 0;
    while (position < text.length) {
      const osc = text.indexOf(OSC, position);
      const bell = text.indexOf('\x07', position);
      if (bell !== -1 && bell < (osc === -1 ? text.length : osc)) {
        signals.events.push({ type: 'bell' });
      }
      if (osc === -1) {
        // Keep a trailing ESC that may start the next sequence
        if (text.endsWith('\x1b')) this.pending = '\x1b';
        break;
      }

      const bodyStart = osc + OSC.length;
      const end = findTerminator(text, bodyStart);
      if (!end) {
        if (text.length - osc <= MAX_SEQUENCE_LENGTH) this.pending = text.slice(osc);
        break;
      }
      this.applySequence(text.slice(bodyStart, end.index), signals);
      position = end.index + end.length;
    }

    return signals;
  }

  private applySequence(body: string, signals: TerminalSignals): void {
    const separator = body.indexOf(';');
    const code = separator === -1 ? body : body.slice(0, separator);
    const payload = separator === -1 ? '' : body.slice(separator + 1);

    if (code === '7501') {
      if (payload.trim() === '?') {
        signals.queries++;
      } else {
        const report = parseReport(payload);
        if (report) signals.events.push({ type: 'report', report });
      }
    } else if (code === '0' || code === '2') {
      signals.title = payload;
    } else if (code === '9' && payload && !/^\d+;/.test(payload)) {
      // `9;4;…` is ConEmu progress, not a notification
      signals.events.push({ type: 'notification', text: payload });
    }
  }
}

function findTerminator(text: string, from: number): { index: number; length: number } | undefined {
  const bel = text.indexOf('\x07', from);
  const st = text.indexOf('\x1b\\', from);
  if (bel === -1 && st === -1) return undefined;
  if (st === -1 || (bel !== -1 && bel < st)) return { index: bel, length: 1 };
  return { index: st, length: 2 };
}

function parseReport(body: string): ProgramStatusReport | undefined {
  const pairs = new Map<string, string>();
  for (const pair of body.split(':')) {
    const separator = pair.indexOf('=');
    if (separator > 0) {
      pairs.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  const state = pairs.get('state');
  if (!state || !STATES.has(state)) {
    return undefined;
  }
  // A malformed id is ignored rather than read as the root record
  const id = pairs.get('id');
  if (id !== undefined && (id.length > 128 || !RECORD_ID.test(id))) {
    return undefined;
  }

  let message: string | undefined;
  const encoded = pairs.get('msg');
  if (encoded) {
    if (encoded.length > MAX_MESSAGE_LENGTH || !BASE64.test(encoded)) return undefined;
    message = Buffer.from(encoded, 'base64').toString('utf8');
    if (CONTROL_CHARACTERS.test(message)) return undefined;
  }

  const report: ProgramStatusReport = {
    state: state as ProgramStatusReport['state'],
    kind: pairs.get('kind'),
    message
  };
  if (id !== undefined) report.id = id;
  const app = pairs.get('app');
  if (id !== undefined && app) report.app = app;
  return report;
}
