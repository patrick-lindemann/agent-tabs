import { describe, expect, it } from 'vitest';
import { isWebviewMessage } from '../../src/validate';

describe('webview message validation', () => {
  it('accepts every valid webview message type', () => {
    const valid = [
      { type: 'ready' },
      { type: 'input', id: 'tab', data: 'ls' },
      { type: 'resize', id: 'tab', cols: 80, rows: 24 },
      { type: 'newTab' },
      { type: 'newTabWithProfile' },
      { type: 'newTabWithCommand' },
      { type: 'closeTab', id: 'tab' },
      { type: 'switchTab', id: 'tab' },
      { type: 'openFile', id: 'tab', path: 'a.ts', line: 3, column: 2 },
      { type: 'focus', focused: true }
    ];
    expect(valid.every(isWebviewMessage)).toBe(true);
  });

  it('validates message shapes and bounds', () => {
    expect(isWebviewMessage({ type: 'resize', id: 'tab', cols: 80, rows: 24 })).toBe(true);
    expect(isWebviewMessage({ type: 'resize', id: '', cols: 80, rows: 24 })).toBe(false);
    expect(isWebviewMessage({ type: 'newTab', extra: true })).toBe(false);
    expect(isWebviewMessage({ type: 'openFile', id: 'tab', path: 'a.ts', line: 3 })).toBe(true);
  });
});
