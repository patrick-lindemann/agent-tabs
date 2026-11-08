import { describe, expect, it } from 'vitest';
import { TerminalStateManager } from '../../src/terminal/state';
import type { TerminalInstance } from '../../src/types';

const launch = { label: 'Work', command: 'claude', args: [], env: {}, commandLine: 'claude' };
const instance = (overrides: Partial<TerminalInstance> = {}): TerminalInstance => ({
  id: 'a',
  isActive: false,
  launch,
  ...overrides
});

describe('terminal state', () => {
  it('activates tabs and computes priority status', () => {
    const manager = new TerminalStateManager();
    const a = instance();
    const b = instance({ id: 'b' });
    manager.set('a', a);
    manager.set('b', b);
    expect(manager.setActive('a')).toBeUndefined();
    expect(manager.setActive('b')).toBe(a);
    expect(a.isActive).toBe(false);
    expect(b.isActive).toBe(true);
    b.needsInput = true;
    b.programState = 'working';
    expect(manager.getStatus(b)).toBe('blocked');
    b.missing = 'claude';
    expect(manager.getStatus(b)).toBe('error');
  });
  it.each([
    [{ programState: 'working' }, 'working'],
    [{ unseen: 'done' }, 'done'],
    [{ isWaitingForInput: true }, 'blocked']
  ] as const)('computes status %o', (changes, expected) => {
    const manager = new TerminalStateManager();
    const tab = instance(changes);
    manager.set('a', tab);
    expect(manager.getStatus(tab)).toBe(expected);
  });
});
