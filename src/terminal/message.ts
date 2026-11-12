/**
 * Follows the text typed into an agent's input, to name its tab after the
 * first message until the agent sets a title. The text is undefined once a
 * key edits the input in a way that cannot be followed, e.g. moving the
 * cursor, history or completion. Ctrl+C clears the input. Enter is up to the
 * caller.
 */
export function typed(text: string | undefined, data: string): string | undefined {
  if (data === '\x03') return '';
  if (text === undefined) return undefined;
  if (NEW_LINE.has(data)) return `${text}\n`;
  if (BACKSPACE.has(data)) return [...text].slice(0, -1).join('');
  const paste = PASTE.exec(data);
  if (paste) return text + paste[1];
  return CONTROL.test(data) ? undefined : text + data;
}

/** Shift+Enter, Alt+Enter and Ctrl+J insert a line break */
const NEW_LINE = new Set(['\x1b[13;2u', '\x1b\r', '\n']);
const BACKSPACE = new Set(['\x7f', '\b']);
const PASTE = /^\x1b\[200~([\s\S]*)\x1b\[201~$/;
const CONTROL = /[\x00-\x1f\x7f]/;

/**
 * A tab label from a sent message, on one line and at most 80 characters, or
 * undefined for a command such as `/model` or `!ls` and for text without
 * letters or digits
 */
export function labelFromMessage(text: string | undefined): string | undefined {
  const label = text?.replace(/\s+/g, ' ').trim();
  if (!label || /^[/!]/.test(label) || !/[\p{L}\p{N}]/u.test(label)) return undefined;
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
