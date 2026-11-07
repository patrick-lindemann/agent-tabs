import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptDetector } from '../../src/promptDetector';

describe('prompt detection', () => {
  afterEach(() => vi.useRealTimers());
  it('notifies after a matching prompt settles', () => {
    vi.useFakeTimers();
    const changes: Array<[string, boolean]> = [];
    const detector = new PromptDetector({ enabled: true, showDelay: 100, customPatterns: [] }, (id, waiting) => changes.push([id, waiting]));
    detector.onData('one', '\x1b[32mContinue?\x1b[0m');
    vi.advanceTimersByTime(100);
    expect(changes).toEqual([['one', true]]);
    detector.onUserInput('one');
    expect(changes.at(-1)).toEqual(['one', false]);
    detector.dispose();
  });

  it('accepts safe custom patterns and rejects invalid ones', () => {
    vi.useFakeTimers();
    const changes: Array<[string, boolean]> = [];
    const detector = new PromptDetector({ enabled: true, showDelay: 1, customPatterns: ['^ready>$', '['] }, (id, waiting) => changes.push([id, waiting]));
    detector.onData('one', 'ready>');
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([['one', true]]);
    detector.dispose();
  });
});
