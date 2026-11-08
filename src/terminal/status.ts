import { idleWhenDone, labelFromTitle } from '../profiles';
import type { TerminalInstance } from '../types';
import {
  PROGRAM_STATUS_REPLY,
  type ProgramStatusReport,
  TerminalSignalParser,
  type TerminalSignals
} from './signals';

/**
 * Applies status signals from a tab's output and returns whether the tab
 * changed. Signals apply in the order the program wrote them, except that
 * an idle report also sees a notification right after it in the same chunk,
 * so a Codex turn counts as done in either order. `inView` is whether the
 * tab is shown, so a result arriving there counts as seen.
 *
 * - OSC 7501 reports set the tab status. A finished run in a tab that is
 *   not in view stays marked until the tab is shown.
 * - A bell while working means a dialog asks something the agent did not
 *   report, e.g. pi's ask_user_question tool. It counts as blocked until
 *   the user types or the agent reports again.
 * - `idle` right after `working` is a cancel, as the protocol asks for,
 *   except for agents that report `idle` instead of `done` (OpenCode).
 *   Codex before 0.163 also did; with the profile's options it writes an
 *   OSC 9 notification first when the turn completed, so idle after a
 *   notification is done. A plan prompt notification asks for input
 *   instead.
 */
export function applySignals(
  instance: TerminalInstance,
  signals: TerminalSignals,
  inView: boolean
): boolean {
  let changed = false;
  const { events } = signals;
  for (const [index, event] of events.entries()) {
    if (event.type === 'notification') {
      instance.lastNotification = event.text;
    } else if (event.type === 'report') {
      const next = events[index + 1];
      if (event.report.state === 'idle' && next?.type === 'notification') {
        instance.lastNotification ??= next.text;
      }
      applyProgramStatus(instance, event.report, inView);
      changed = true;
    } else if (
      event.type === 'bell' &&
      instance.programState === 'working' &&
      !instance.needsInput
    ) {
      instance.needsInput = true;
      changed = true;
    }
  }
  return changed;
}

export function applyProgramStatus(
  instance: TerminalInstance,
  report: ProgramStatusReport,
  inView: boolean
): void {
  const previous = instance.programState;
  const notification = instance.lastNotification;
  instance.reportsStatus = true;
  instance.needsInput = false;

  if (report.state === 'clear') {
    instance.programState = undefined;
    instance.statusMessage = undefined;
    instance.lastNotification = undefined;
    return;
  }

  instance.programState = report.state;
  instance.statusMessage = report.message;

  if (report.state === 'working') {
    instance.unseen = undefined;
    instance.lastNotification = undefined;
    return;
  }
  if (report.state === 'blocked' && !report.message && notification) {
    instance.statusMessage = notification;
  }
  if (report.state === 'idle' && previous === 'working') {
    instance.lastNotification = undefined;
    if (notification?.startsWith('Plan mode prompt')) {
      instance.needsInput = true;
      instance.statusMessage = notification;
      return;
    }
    const finished = idleWhenDone(instance.launch.agent) || notification !== undefined;
    if (finished && !inView) {
      instance.unseen = 'done';
    }
    return;
  }
  if ((report.state === 'done' || report.state === 'error') && !inView) {
    instance.unseen = report.state;
  }
}

/** Clears what a previous run reported, before the tab restarts */
export function resetStatus(instance: TerminalInstance): void {
  instance.exited = false;
  instance.reportsStatus = false;
  instance.programState = undefined;
  instance.statusMessage = undefined;
  instance.needsInput = false;
  instance.lastNotification = undefined;
  instance.titleLabel = undefined;
  instance.unseen = undefined;
  instance.missing = undefined;
}

/**
 * Reads status reports, titles, notifications and the bell from each tab's
 * output, keeping escape sequences split across chunks, and answers OSC 7501
 * support queries.
 */
export class StatusTracker {
  private readonly parsers = new Map<string, TerminalSignalParser>();

  /** Returns whether the tab's label or status changed */
  track(
    instance: TerminalInstance,
    data: string,
    options: { programStatus: boolean; inView: boolean; reply: (data: string) => void }
  ): boolean {
    let parser = this.parsers.get(instance.id);
    if (!parser) {
      parser = new TerminalSignalParser();
      this.parsers.set(instance.id, parser);
    }
    const signals = parser.scan(data);

    let changed = false;
    if (signals.title !== undefined) {
      const label = labelFromTitle(signals.title, instance.launch);
      if (label !== instance.titleLabel) {
        instance.titleLabel = label;
        changed = true;
      }
    }
    if (options.programStatus) {
      for (let i = 0; i < signals.queries; i++) {
        options.reply(PROGRAM_STATUS_REPLY);
      }
      changed = applySignals(instance, signals, options.inView) || changed;
    }
    return changed;
  }

  forget(id: string): void {
    this.parsers.delete(id);
  }

  clear(): void {
    this.parsers.clear();
  }
}
