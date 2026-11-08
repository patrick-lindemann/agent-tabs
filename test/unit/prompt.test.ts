import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptDetector } from '../../src/terminal/prompt';
import { SILENT_AGENTS } from './agents';

const DELAY = 100;
let changes: Array<[string, boolean]>;

function detector(customPatterns: string[] = [], enabled = true) {
  return new PromptDetector({ enabled, showDelay: DELAY, customPatterns }, (id, waiting) =>
    changes.push([id, waiting])
  );
}

/** Whether output ends at something the detector reads as a prompt */
function waits(output: string, customPatterns: string[] = []): boolean {
  const d = detector(customPatterns);
  d.onData('tab', output);
  vi.advanceTimersByTime(DELAY);
  d.dispose();
  return changes.at(-1)?.[1] === true;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  changes = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(SILENT_AGENTS)('$agent without status reports', (agent) => {
  it('waits for input when it asks something', () => {
    expect(waits(agent.working + agent.prompt)).toBe(true);
  });

  it('does not wait while it works', () => {
    expect(waits(agent.working)).toBe(false);
  });
});

describe('built-in patterns', () => {
  it.each([
    ['a REPL prompt', 'output\n> '],
    ['a named prompt', 'gemini> '],
    ['Python', '\n>>> '],
    ['y/n', 'Overwrite file? (y/N)'],
    ['Y/n in brackets', 'Continue? [Y/n]: '],
    ['yes/no', 'Proceed (yes/no)'],
    ['a menu', '❯ 1. Yes\n  2. No'],
    ['Would you like to', 'Would you like to make these edits?\n'],
    ['esc to cancel', 'Enter to select · Esc to cancel'],
    ['a colored prompt', '\x1b[32mContinue?\x1b[0m']
  ])('match %s', (_, output) => {
    expect(waits(output)).toBe(true);
  });

  it.each([
    ['running output', 'Compiling 3 files...\n'],
    ['a redirect in code', 'echo a > out.txt\nDone.'],
    ['a question that scrolled away', `Would you like to run it?\n${'output\n'.repeat(30)}`]
  ])('do not match %s', (_, output) => {
    expect(waits(output)).toBe(false);
  });
});

describe('timing', () => {
  it('waits until output settles', () => {
    const d = detector();
    d.onData('tab', 'Continue?');
    vi.advanceTimersByTime(DELAY - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([['tab', true]]);
  });

  it('starts over when more output arrives, and clears a shown prompt', () => {
    const d = detector();
    d.onData('tab', 'Continue?');
    vi.advanceTimersByTime(DELAY);
    d.onData('tab', '\nworking...');
    expect(changes).toEqual([
      ['tab', true],
      ['tab', false]
    ]);
    vi.advanceTimersByTime(DELAY);
    expect(changes).toHaveLength(2);
  });

  it('clears on user input and forgets the earlier output', () => {
    const d = detector();
    d.onData('tab', 'Continue?');
    vi.advanceTimersByTime(DELAY);
    d.onUserInput('tab');
    expect(changes.at(-1)).toEqual(['tab', false]);
    d.onData('tab', 'y');
    vi.advanceTimersByTime(DELAY);
    expect(changes.at(-1)).toEqual(['tab', false]);
  });

  it('tracks tabs separately', () => {
    const d = detector();
    d.onData('a', 'Continue?');
    d.onData('b', 'working');
    vi.advanceTimersByTime(DELAY);
    expect(changes).toEqual([['a', true]]);
  });

  it('does nothing for a removed tab', () => {
    const d = detector();
    d.onData('tab', 'Continue?');
    d.removeTerminal('tab');
    vi.advanceTimersByTime(DELAY);
    expect(changes).toEqual([]);
  });

  it('does nothing when disabled', () => {
    const d = detector([], false);
    d.onData('tab', 'Continue?');
    vi.advanceTimersByTime(DELAY);
    expect(changes).toEqual([]);
  });

  it('clears a shown prompt when turned off', () => {
    const d = detector();
    d.onData('tab', 'Continue?');
    vi.advanceTimersByTime(DELAY);
    d.updateConfig({ enabled: false, showDelay: DELAY, customPatterns: [] });
    expect(changes.at(-1)).toEqual(['tab', false]);
  });

  it('applies new settings', () => {
    const d = detector();
    d.updateConfig({ enabled: true, showDelay: DELAY, customPatterns: ['ready\\$ $'] });
    d.onData('tab', 'ready$ ');
    vi.advanceTimersByTime(DELAY);
    expect(changes).toEqual([['tab', true]]);
  });
});

describe('custom patterns', () => {
  it('matches a custom prompt', () => {
    expect(waits('mybot: ', ['mybot: $'])).toBe(true);
  });

  it.each([
    ['invalid', '['],
    ['empty', ''],
    ['too long', `a{${'1'.repeat(200)}}`],
    ['nested quantifiers', '(a+)+$'],
    ['repeated quantifiers', 'a+b+$'],
    ['a high backreference', '(a)\\12']
  ])('rejects a %s pattern', (_, pattern) => {
    const d = detector([pattern]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    d.dispose();
  });

  it('keeps working after rejecting a pattern', () => {
    expect(waits('ready>', ['[', '^ready>$'])).toBe(true);
  });
});
