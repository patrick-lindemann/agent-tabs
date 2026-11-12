export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Keys bound to Agent Tabs commands, which the terminal leaves to VS Code
 * instead of typing them. They follow VS Code's editor tabs; on Windows and
 * Linux closing is Ctrl+Shift+W, because Ctrl+W deletes a word in the agents.
 *
 * On macOS, moving a tab is the chord Cmd+K Cmd+Shift+Left/Right, so
 * Cmd+Shift+Left/Right goes to VS Code only `afterCmdK`, as the key right
 * after Cmd+K; otherwise the terminal gets it.
 *
 * Splitting follows VS Code's terminal: Cmd+\ or Ctrl+Shift+5. While the
 * view is `split`, the keys that focus the pane above or below go to VS Code
 * too, as in VS Code's split terminal: Cmd+Alt+Up/Down on macOS, Alt+Up/Down
 * on Windows and Linux.
 */
export function isTabShortcut(
  event: KeyboardEventLike,
  isMac: boolean,
  afterCmdK = false,
  split = false
): boolean {
  const { code, ctrlKey, metaKey, altKey, shiftKey } = event;
  const mods = `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}`;
  const digit = /^Digit[0-9]$/.test(code);
  const arrow = code === 'ArrowLeft' || code === 'ArrowRight';
  const upDown = code === 'ArrowUp' || code === 'ArrowDown';
  if (code === 'Tab' && (mods === 'Ctrl+' || mods === 'Ctrl+Shift+')) return true;
  if (mods === 'Ctrl+Shift+' && code === 'Digit5') return true;
  if (isMac) {
    return (
      (mods === 'Ctrl+' && digit) ||
      isCmdK(event) ||
      (mods === 'Meta+' && code === 'Backslash') ||
      (split && mods === 'Alt+Meta+' && upDown) ||
      (afterCmdK && mods === 'Shift+Meta+' && arrow) ||
      (mods === 'Meta+' && ['KeyN', 'KeyW', 'Digit9'].includes(code)) ||
      (mods === 'Shift+Meta+' && ['KeyT', 'BracketLeft', 'BracketRight'].includes(code)) ||
      (mods === 'Alt+Meta+' && arrow)
    );
  }
  return (
    (mods === 'Alt+' && digit) ||
    (split && mods === 'Alt+' && upDown) ||
    (mods === 'Ctrl+' && ['KeyN', 'PageUp', 'PageDown', 'F4'].includes(code)) ||
    (mods === 'Ctrl+Shift+' && ['KeyT', 'KeyW', 'PageUp', 'PageDown'].includes(code))
  );
}

/** Cmd+K, which starts VS Code's chords on macOS, e.g. Cmd+K Cmd+Shift+Left */
export function isCmdK(event: KeyboardEventLike): boolean {
  const { code, ctrlKey, metaKey, altKey, shiftKey } = event;
  return code === 'KeyK' && metaKey && !ctrlKey && !altKey && !shiftKey;
}

/** A key that only changes others, such as Shift, pressed on its own */
export function isModifierKey(event: KeyboardEventLike): boolean {
  return ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key);
}

export function keySequence(event: KeyboardEventLike, isMac: boolean): string | undefined {
  const { ctrlKey, altKey, shiftKey, metaKey, code } = event;
  const key = `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}${code}`;
  const sequences: Record<string, string> = {
    'Shift+Enter': '\x1b[13;2u',
    'Alt+Enter': '\x1b\r',
    // xterm's modifier 3 is Alt (5 would be Ctrl)
    'Alt+ArrowUp': '\x1b[1;3A',
    'Alt+ArrowDown': '\x1b[1;3B',
    'Ctrl+Alt+KeyG': '\x07',
    'Ctrl+Shift+Digit2': '\x00',
    'Ctrl+Shift+Digit6': '\x1e',
    ...(isMac
      ? {
          'Ctrl+KeyC': '\x03',
          'Meta+ArrowLeft': '\x01',
          'Meta+ArrowRight': '\x05',
          'Meta+Backspace': '\x15',
          'Alt+Backspace': '\x17',
          'Alt+Delete': '\x1bd'
        }
      : { 'Meta+KeyC': '\x03', 'Ctrl+Backspace': '\x17', 'Ctrl+Delete': '\x1bd' })
  };
  return sequences[key];
}
