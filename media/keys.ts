export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isTabShortcut(event: KeyboardEventLike, isMac: boolean): boolean {
  const { key, code, ctrlKey, metaKey, altKey, shiftKey } = event;
  const digit = /^Digit[1-9]$/.test(code);
  if (ctrlKey && !metaKey && !altKey && key === 'Tab') return true;
  if (isMac) {
    return (
      (metaKey &&
        !ctrlKey &&
        !altKey &&
        !shiftKey &&
        (digit || code === 'KeyT' || code === 'KeyW')) ||
      (metaKey && altKey && !ctrlKey && !shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
    );
  }
  return (
    (altKey && !ctrlKey && !metaKey && !shiftKey && digit) ||
    (ctrlKey && !altKey && !metaKey && !shiftKey && (key === 'PageUp' || key === 'PageDown')) ||
    (ctrlKey && shiftKey && !altKey && !metaKey && (code === 'KeyT' || code === 'KeyW'))
  );
}

export function keySequence(event: KeyboardEventLike, isMac: boolean): string | undefined {
  const { ctrlKey, altKey, shiftKey, metaKey, code } = event;
  const key = `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}${code}`;
  const sequences: Record<string, string> = {
    'Shift+Enter': '\x1b[13;2u',
    'Alt+Enter': '\x1b\r',
    'Alt+ArrowUp': '\x1b[1;5A',
    'Alt+ArrowDown': '\x1b[1;5B',
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
