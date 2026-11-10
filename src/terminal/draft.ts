/**
 * Whether a tab may have unsent text in its agent's input, for asking before
 * the tab closes. Only characters are counted; the text is never kept.
 *
 * - Typed characters add to the count and Backspace takes one away, so text
 *   that was typed and deleted again counts as nothing.
 * - Other keys that edit the input in ways the count cannot follow, e.g.
 *   deleting a word, moving the cursor or pasting, make it unknown, which
 *   counts as unsent text until the next message is sent.
 * - With an empty input, keys that cannot bring text into it, e.g. Esc,
 *   Ctrl+C or Left, keep it empty. History (Up, Down), Tab completion and
 *   pasting can.
 *
 * Enter is up to the caller: whether it sent a message depends on the agent.
 */
export type Draft = number | 'unknown';

const BACKSPACE = new Set(['\x7f', '\b']);
/** Shift+Enter, Alt+Enter and Ctrl+J insert a line break */
const NEW_LINE = new Set(['\x1b[13;2u', '\x1b\r', '\n']);
/** Keys that can fill an empty input: history, completion and pasting */
const FILLS_INPUT = /^(?:\x1b\[[AB]|\x1bO[AB]|\t)$|\x1b\[200~/;
const CONTROL = /[\x00-\x1f\x7f]/;

export function typed(draft: Draft, data: string): Draft {
  if (NEW_LINE.has(data)) return add(draft, 1);
  // A paste without bracketed paste: several characters with line breaks,
  // which may or may not have sent the text
  if (
    [...data].length > 1 &&
    /^[^\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]+$/.test(data) &&
    /[\r\n]/.test(data)
  ) {
    return 'unknown';
  }
  if (BACKSPACE.has(data)) return draft === 'unknown' ? draft : Math.max(0, draft - 1);
  if (!CONTROL.test(data)) return add(draft, [...data].length);
  if (draft === 0 && !FILLS_INPUT.test(data)) return 0;
  return 'unknown';
}

function add(draft: Draft, count: number): Draft {
  return draft === 'unknown' ? draft : draft + count;
}

/** Whether there may be text in the input */
export function hasDraft(draft: Draft | undefined): boolean {
  return draft === 'unknown' || (draft ?? 0) > 0;
}
