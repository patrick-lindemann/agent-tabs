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

  it('moves a tab in the order, clamped to the first and last position', () => {
    const state = manager(tab(), tab({ id: 'b' }), tab({ id: 'c' }));
    expect(state.move('a', 2)).toBe(true);
    expect(state.getAllIds()).toEqual(['b', 'c', 'a']);
    expect(state.move('a', -5)).toBe(true);
    expect(state.getAllIds()).toEqual(['a', 'b', 'c']);
    expect(state.move('a', 0)).toBe(false);
    expect(state.move('missing', 1)).toBe(false);
    expect(state.get('a')?.id).toBe('a');
  });

  it('generates unique ids', () => {
    const state = new TerminalStateManager();
    const ids = new Set(Array.from({ length: 100 }, () => state.generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('panes', () => {
  it('splits a tab into a new pane on a side, which gets focus', () => {
    const state = manager(tab(), tab({ id: 'b' }), tab({ id: 'c' }), tab({ id: 'd' }));
    const [first] = state.getPaneIds();
    const below = state.split('b', first, 'bottom');
    expect(state.getPaneIds()).toEqual([first, below]);
    expect(state.getPaneTabs(first)).toEqual(['a', 'c', 'd']);
    expect(state.getPaneTabs(below)).toEqual(['b']);
    expect(state.getFocusedPaneId()).toBe(below);
    expect(state.getActiveId()).toBe('b');
    const above = state.split('c', first, 'top');
    expect(state.getPaneIds()).toEqual([above, first, below]);
    // Beside a pane in a column: a row in its place
    const right = state.split('d', first, 'right');
    expect(state.getPaneIds()).toEqual([above, first, right, below]);
    expect(state.getAllIds()).toEqual(['c', 'a', 'd', 'b']);
  });

  it("does not split a pane's only tab from itself", () => {
    const state = manager(tab());
    const [pane] = state.getPaneIds();
    expect(state.split('a', pane, 'bottom')).toBeUndefined();
    expect(state.getPaneIds()).toEqual([pane]);
  });

  it('keeps a shown tab in each pane and the focused pane for commands', () => {
    const state = manager(tab(), tab({ id: 'b' }), tab({ id: 'c' }));
    const [first] = state.getPaneIds();
    state.setActive('a');
    const second = state.split('c', first, 'right') as string;
    expect(state.getShownIds()).toEqual(['a', 'c']);
    state.setActive('b', false);
    expect(state.getShownIds()).toEqual(['b', 'c']);
    expect(state.getActiveId()).toBe('c');
    expect(state.focusPane(first)).toBe(true);
    expect(state.getActiveId()).toBe('b');
    expect(state.focusPane(first)).toBe(false);
    expect(state.getPaneTabs()).toEqual(['a', 'b']);
    expect(state.getPaneTabs(second)).toEqual(['c']);
  });

  it('closes a pane with its last tab and gives the pane before it its space and focus', () => {
    const state = manager(tab(), tab({ id: 'b' }));
    const [first] = state.getPaneIds();
    const second = state.split('b', first, 'bottom') as string;
    state.delete('b');
    expect(state.getPaneIds()).toEqual([first]);
    expect(state.getFocusedPaneId()).toBe(first);
    expect(state.getPaneTabs(second)).toEqual([]);
    expect(state.getLayoutInfo(false, 4).type).toBe('pane');
  });

  it('keeps the last pane when its last tab closes', () => {
    const state = manager(tab());
    const [pane] = state.getPaneIds();
    state.delete('a');
    expect(state.getPaneIds()).toEqual([pane]);
    expect(state.getActiveId()).toBeUndefined();
  });

  it('moves a tab into another pane at a position, which shows it', () => {
    const state = manager(tab(), tab({ id: 'b' }), tab({ id: 'c' }));
    const [first] = state.getPaneIds();
    const second = state.split('c', first, 'bottom') as string;
    expect(state.move('a', 0, second)).toBe(true);
    expect(state.getPaneTabs(second)).toEqual(['a', 'c']);
    expect(state.getActiveId()).toBe('a');
    expect(state.getShownIds()).toEqual(['b', 'a']);
    // The pane it left closes once it is empty
    state.move('b', 5, second);
    expect(state.getPaneIds()).toEqual([second]);
    expect(state.getPaneTabs(second)).toEqual(['a', 'c', 'b']);
  });

  it('describes the layout with each pane, its tabs and focus, and the split sizes', () => {
    const state = manager(tab(), tab({ id: 'b' }));
    const [first] = state.getPaneIds();
    const second = state.split('b', first, 'right') as string;
    const layout = state.getLayoutInfo(false, 4);
    if (layout.type !== 'split') throw new Error('not split');
    expect(state.resizeSplit(layout.id, [3, 1])).toBe(true);
    expect(state.resizeSplit(layout.id, [1])).toBe(false);
    expect(state.resizeSplit('missing', [1, 1])).toBe(false);
    const strip = (info: ReturnType<typeof state.getLayoutInfo>): unknown =>
      info.type === 'pane'
        ? [info.id, info.focused, info.tabs.map((t) => [t.id, t.isActive])]
        : [info.direction, info.sizes, info.children.map(strip)];
    expect(strip(state.getLayoutInfo(false, 4))).toEqual([
      'row',
      [3, 1],
      [
        [first, false, [['a', true]]],
        [second, true, [['b', true]]]
      ]
    ]);
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
      // Behind another tab, which its pane shows
      const instance = tab({ id: 'background', ...changes });
      expect(manager(tab(), instance).getStatus(instance)).toBe(expected);
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
