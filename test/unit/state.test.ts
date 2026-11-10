import { describe, expect, it } from 'vitest';
import { launchForCommand } from '../../src/profiles';
import { TerminalStateManager } from '../../src/terminal/state';
import type { TerminalInstance } from '../../src/types';
import { WORKSPACE_ACCENT_COLORS } from '../../src/types';

const tab = (overrides: Partial<TerminalInstance> = {}): TerminalInstance => ({
  id: 'a',
  isActive: false,
  launch: launchForCommand('claude', [], false),
  ...overrides
});

function manager(...instances: TerminalInstance[]) {
  const state = new TerminalStateManager();
  for (const instance of instances) state.set(instance.id, instance);
  return state;
}

describe('active tab', () => {
  it('activates one tab at a time', () => {
    const a = tab();
    const b = tab({ id: 'b' });
    const state = manager(a, b);
    state.setActive('a');
    state.setActive('b');
    expect([a.isActive, b.isActive]).toEqual([false, true]);
    expect(state.getActiveId()).toBe('b');
  });

  it('keeps the active tab when activating an unknown id', () => {
    const state = manager(tab());
    state.setActive('a');
    state.setActive('missing');
    expect(state.getActiveId()).toBe('a');
  });

  it('generates unique ids', () => {
    const state = new TerminalStateManager();
    const ids = new Set(Array.from({ length: 100 }, () => state.generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('tab status', () => {
  // Highest priority first
  it.each([
    ['a command that is missing', { missing: 'claude', needsInput: true }, 'error'],
    ['an unreported question', { needsInput: true, programState: 'working' }, 'blocked'],
    ['working', { programState: 'working', unseen: 'done' }, 'working'],
    ['a reported question', { programState: 'blocked', unseen: 'done' }, 'blocked'],
    ['an unseen result', { programState: 'idle', unseen: 'done' }, 'done'],
    ['an unseen failure', { unseen: 'error' }, 'error'],
    ['a prompt guess in a background tab', { isWaitingForInput: true }, 'blocked'],
    ['idle', { programState: 'idle' }, undefined],
    ['a seen result', { programState: 'done' }, undefined]
  ] as Array<[string, Partial<TerminalInstance>, string | undefined]>)(
    'shows %s',
    (_, changes, expected) => {
      const instance = tab(changes);
      expect(manager(instance).getStatus(instance)).toBe(expected);
    }
  );

  it('ignores the prompt guess in the active tab', () => {
    const instance = tab({ isWaitingForInput: true, isActive: true });
    expect(manager(instance).getStatus(instance)).toBeUndefined();
  });

  it('ignores the prompt guess for agents that report their status', () => {
    const instance = tab({ isWaitingForInput: true, reportsStatus: true });
    expect(manager(instance).getStatus(instance)).toBeUndefined();
  });

  it.each([
    [{ programState: 'working' }, 'Working'],
    [{ programState: 'blocked', statusMessage: 'Allow Bash?' }, 'Needs input: Allow Bash?'],
    [{ unseen: 'done' }, 'Done'],
    [{ missing: 'claude', statusMessage: 'claude not found' }, 'Failed: claude not found'],
    [{ programState: 'idle', statusMessage: 'Ready' }, undefined]
  ] as Array<[Partial<TerminalInstance>, string | undefined]>)(
    'describes %o as %j',
    (changes, text) => {
      const instance = tab(changes);
      expect(manager(instance).describeStatus(instance)).toBe(text);
    }
  );

  it.each([
    [{ programState: 'working' }, true],
    [{ programState: 'blocked' }, true],
    [{ needsInput: true }, true],
    [{ isWaitingForInput: true }, false],
    [{ programState: 'done' }, false],
    [{ programState: 'working', exited: true }, false]
  ] as Array<[Partial<TerminalInstance>, boolean]>)('busy with %o: %s', (changes, busy) => {
    const instance = tab(changes);
    expect(manager(instance).isBusy(instance)).toBe(busy);
  });

  it.each([
    [{ programState: 'blocked' }, true],
    [{ unseen: 'done' }, true],
    [{ unseen: 'error' }, true],
    [{ programState: 'working' }, false],
    [{}, false]
  ] as Array<[Partial<TerminalInstance>, boolean]>)(
    'needs attention with %o: %s',
    (changes, attention) => {
      const instance = tab(changes);
      expect(manager(instance).needsAttention(instance)).toBe(attention);
    }
  );
});

describe('tab labels', () => {
  it('uses the shortened title with automatic titles, else the profile name', () => {
    const instance = tab({ titleLabel: 'Refactor the API client for retries' });
    const state = manager(instance);
    expect(state.getLabel(instance, true, 3)).toBe('Refactor API client');
    expect(state.getLabel(instance, false, 3)).toBe('Claude Code');
    expect(state.getFullLabel(instance, true)).toBe(
      'Claude Code / Refactor the API client for retries'
    );
    expect(state.getFullLabel(instance, false)).toBe('Claude Code');
  });

  it('uses the profile name until the agent sets a title', () => {
    const instance = tab();
    expect(manager(instance).getLabel(instance, true, 4)).toBe('Claude Code');
  });
});

describe('tab list', () => {
  it('describes every tab for the webview', () => {
    const a = tab({ isActive: true, programState: 'working' });
    const b = tab({ id: 'b', workspaceFolderIndex: 9, titleLabel: 'Fix login' });
    expect(manager(a, b).getTabsInfo(true, 4)).toEqual([
      {
        id: 'a',
        label: 'Claude Code',
        description: 'Claude Code',
        icon: 'claude',
        isActive: true,
        accentColor: undefined,
        status: 'working',
        statusText: 'Working'
      },
      {
        id: 'b',
        label: 'Fix login',
        description: 'Claude Code / Fix login',
        icon: 'claude',
        isActive: false,
        accentColor: WORKSPACE_ACCENT_COLORS[1],
        status: undefined,
        statusText: undefined
      }
    ]);
  });
});
