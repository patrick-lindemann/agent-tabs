import { describe, expect, it } from 'vitest';
import { isCmdK, isModifierKey, isTabShortcut, keySequence } from '../../media/keys';

const event = (
  code: string,
  key = code,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}
) => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('webview keybindings', () => {
  it.each([
    ['Cmd+N', event('KeyN', 'n', { metaKey: true })],
    ['Cmd+W', event('KeyW', 'w', { metaKey: true })],
    ['Cmd+Shift+T', event('KeyT', 'T', { metaKey: true, shiftKey: true })],
    ['Cmd+Shift+]', event('BracketRight', '}', { metaKey: true, shiftKey: true })],
    ['Cmd+Alt+Left', event('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true })],
    ['Ctrl+1', event('Digit1', '1', { ctrlKey: true })],
    ['Ctrl+0', event('Digit0', '0', { ctrlKey: true })],
    ['Cmd+9', event('Digit9', '9', { metaKey: true })],
    ['Ctrl+Tab', event('Tab', 'Tab', { ctrlKey: true })],
    ['Ctrl+Shift+Tab', event('Tab', 'Tab', { ctrlKey: true, shiftKey: true })]
  ])('leaves %s to VS Code on macOS', (_name, input) =>
    expect(isTabShortcut(input, true)).toBe(true)
  );

  it.each([
    ['Ctrl+N', event('KeyN', 'n', { ctrlKey: true })],
    ['Ctrl+Shift+W', event('KeyW', 'W', { ctrlKey: true, shiftKey: true })],
    ['Ctrl+F4', event('F4', 'F4', { ctrlKey: true })],
    ['Ctrl+Shift+T', event('KeyT', 'T', { ctrlKey: true, shiftKey: true })],
    ['Ctrl+PageDown', event('PageDown', 'PageDown', { ctrlKey: true })],
    ['Ctrl+Shift+PageUp', event('PageUp', 'PageUp', { ctrlKey: true, shiftKey: true })],
    ['Ctrl+Shift+PageDown', event('PageDown', 'PageDown', { ctrlKey: true, shiftKey: true })],
    ['Alt+1', event('Digit1', '1', { altKey: true })],
    ['Alt+0', event('Digit0', '0', { altKey: true })],
    ['Ctrl+Tab', event('Tab', 'Tab', { ctrlKey: true })]
  ])('leaves %s to VS Code on Windows and Linux', (_name, input) =>
    expect(isTabShortcut(input, false)).toBe(true)
  );

  it.each([
    ['Ctrl+W deletes a word', event('KeyW', 'w', { ctrlKey: true }), false],
    ['Ctrl+C', event('KeyC', 'c', { ctrlKey: true }), false],
    ['Cmd+1 on Windows', event('Digit1', '1', { metaKey: true }), false],
    ['Cmd+T', event('KeyT', 't', { metaKey: true }), true],
    ['Cmd+1', event('Digit1', '1', { metaKey: true }), true],
    ['Ctrl+N', event('KeyN', 'n', { ctrlKey: true }), true]
  ])('types %s into the terminal', (_name, input, mac) =>
    expect(isTabShortcut(input, mac)).toBe(false)
  );

  it('leaves Cmd+K Cmd+Shift+Left/Right to VS Code on macOS, else types it', () => {
    const cmdK = event('KeyK', 'k', { metaKey: true });
    const left = event('ArrowLeft', 'ArrowLeft', { metaKey: true, shiftKey: true });
    const right = event('ArrowRight', 'ArrowRight', { metaKey: true, shiftKey: true });
    expect(isTabShortcut(cmdK, true)).toBe(true);
    expect(isTabShortcut(cmdK, false)).toBe(false);
    expect(isTabShortcut(left, true, true)).toBe(true);
    expect(isTabShortcut(right, true, true)).toBe(true);
    expect(isTabShortcut(left, true)).toBe(false);
    expect(isTabShortcut(event('KeyA', 'a', { metaKey: true }), true, true)).toBe(false);
  });

  it('tells Cmd+K and lone modifier keys apart from other keys', () => {
    expect(isCmdK(event('KeyK', 'k', { metaKey: true }))).toBe(true);
    expect(isCmdK(event('KeyK', 'K', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isModifierKey(event('MetaLeft', 'Meta'))).toBe(true);
    expect(isModifierKey(event('KeyK', 'k'))).toBe(false);
  });

  it('maps platform key sequences', () => {
    expect(keySequence(event('Enter', 'Enter', { shiftKey: true }), false)).toBe('\x1b[13;2u');
    expect(keySequence(event('KeyC', 'c', { ctrlKey: true }), true)).toBe('\x03');
    expect(keySequence(event('KeyC', 'c', { metaKey: true }), false)).toBe('\x03');
    expect(keySequence(event('ArrowUp', 'ArrowUp', { altKey: true }), true)).toBe('\x1b[1;3A');
  });
});
