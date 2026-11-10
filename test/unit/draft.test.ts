import { describe, expect, it } from 'vitest';
import { type Draft, hasDraft, typed } from '../../src/terminal/draft';

const type = (...keys: string[]) => keys.reduce<Draft>((draft, key) => typed(draft, key), 0);

describe('unsent input', () => {
  it('counts typed characters, also several at once and beyond the BMP', () => {
    expect(type('h', 'i')).toBe(2);
    expect(type('héllo 👋')).toBe(7);
  });

  it('counts nothing after the typed text was deleted again', () => {
    const draft = type('h', 'i', '\x7f', '\x7f');
    expect(draft).toBe(0);
    expect(hasDraft(draft)).toBe(false);
    expect(type('\x7f', '\x7f', 'a', '\b')).toBe(0);
  });

  it('counts line breaks from Shift+Enter, Alt+Enter and Ctrl+J', () => {
    expect(type('a', '\x1b[13;2u', 'b', '\x1b\r', '\n')).toBe(5);
  });

  it.each([
    ['a word deleted', '\x17'],
    ['the line deleted', '\x15'],
    ['the cursor moved', '\x1b[D'],
    ['Esc', '\x1b'],
    ['Ctrl+C', '\x03'],
    ['a paste', '\x1b[200~text\x1b[201~']
  ])('becomes unknown after %s in typed text', (_name, key) => {
    const draft = type('hello', key);
    expect(draft).toBe('unknown');
    expect(hasDraft(draft)).toBe(true);
    // Backspace cannot make it known again
    expect(typed(draft, '\x7f')).toBe('unknown');
  });

  it.each([
    ['Esc', '\x1b'],
    ['Ctrl+C', '\x03'],
    ['the cursor moved', '\x1b[D'],
    ['a deleted word', '\x17']
  ])('stays empty after %s in an empty input', (_name, key) => {
    expect(type(key)).toBe(0);
  });

  it.each([
    ['history', '\x1b[A'],
    ['history in application mode', '\x1bOB'],
    ['completion', '\t'],
    ['a paste', '\x1b[200~text\x1b[201~'],
    ['a paste without bracketed paste', 'line one\rline two']
  ])('may fill an empty input from %s', (_name, key) => {
    expect(type(key)).toBe('unknown');
  });

  it('has no draft before anything was typed', () => {
    expect(hasDraft(undefined)).toBe(false);
  });
});
