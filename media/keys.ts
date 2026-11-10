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
 */
export function isTabShortcut(event: KeyboardEventLike, isMac: boolean): boolean {
  const { code, ctrlKey, metaKey, altKey, shiftKey } = event;
  const mods = `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}`;
  const digit = /^Digit[0-9]$/.test(code);
  if (code === 'Tab' && (mods === 'Ctrl+' || mods === 'Ctrl+Shift+')) return true;
  if (isMac) {
    return (
      (mods === 'Ctrl+' && digit) ||
      (mods === 'Meta+' && ['KeyN', 'KeyW', 'Digit9'].includes(code)) ||
      (mods === 'Shift+Meta+' && ['KeyT', 'BracketLeft', 'BracketRight'].includes(code)) ||
      (mods === 'Alt+Meta+' && (code === 'ArrowLeft' || code === 'ArrowRight'))
    );
  }
  return (
    (mods === 'Alt+' && digit) ||
    (mods === 'Ctrl+' && ['KeyN', 'PageUp', 'PageDown', 'F4'].includes(code)) ||
    (mods === 'Ctrl+Shift+' && (code === 'KeyT' || code === 'KeyW'))
  );
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
