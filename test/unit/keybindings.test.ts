import { describe, expect, it } from 'vitest';
import { isTabShortcut, keySequence } from '../../media/keybindings';
const event = (code: string, key = code, mods: Partial<Record<'ctrlKey'|'metaKey'|'altKey'|'shiftKey', boolean>> = {}) => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('webview keybindings', () => {
  it.each([
    [false, event('Digit1', '1', { altKey: true })], [true, event('Digit1', '1', { metaKey: true })],
    [false, event('KeyT', 't', { ctrlKey: true, shiftKey: true })], [true, event('KeyW', 'w', { metaKey: true })]
  ])('maps tab shortcut (%s)', (mac, input) => expect(isTabShortcut(input, mac)).toBe(true));
  it('maps platform key sequences', () => {
    expect(keySequence(event('Enter', 'Enter', { shiftKey: true }), false)).toBe('\x1b[13;2u');
    expect(keySequence(event('KeyC', 'c', { ctrlKey: true }), true)).toBe('\x03');
    expect(keySequence(event('KeyC', 'c', { metaKey: true }), false)).toBe('\x03');
  });
});
