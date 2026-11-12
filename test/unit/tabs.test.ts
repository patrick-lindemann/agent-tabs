import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../src/config';
import { launchForCommand, resolveProfiles } from '../../src/profiles';
import {
  type Multiplexer,
  type OpenResult,
  type SessionEntry,
  type SessionOptions,
  type SessionTag,
  setMultiplexer
} from '../../src/terminal/multiplexer';
import { Tabs, type TabsHost } from '../../src/terminal/tabs';
import type {
  ClosedTab,
  ExtensionMessage,
  IPty,
  LaunchSpec,
  OnExitAction,
  OpenTab,
  TerminalConfig
} from '../../src/types';
import { status } from './agents';

const vscode = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  errors: [] as string[]
}));

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => vscode.settings[key] ?? fallback
    })
  },
  window: {
    showErrorMessage: (message: string) => {
      vscode.errors.push(message);
      return Promise.resolve(undefined);
    }
  }
}));

/** A process started by node-pty, controlled by the test */
interface FakePty extends IPty {
  file: string;
  args: string[];
  written: string[];
  size: [number, number];
  killed: boolean;
  emit(data: string): void;
  exit(code: number): void;
}

const spawned: FakePty[] = [];

// PtyManager loads node-pty with require(), which vi.mock does not see
const nodePty = {
  fail: undefined as string | undefined,
  spawn: (file: string, args: string[], options: { cols: number; rows: number }) => {
    if (nodePty.fail) throw new Error(nodePty.fail);
    let onData: (data: string) => void = () => {};
    let onExit: (event: { exitCode: number }) => void = () => {};
    const pty: FakePty = {
      file,
      args,
      written: [],
      killed: false,
      onData: (callback) => {
        onData = callback;
        return { dispose: () => (onData = () => {}) };
      },
      onExit: (callback) => {
        onExit = callback;
        return { dispose: () => (onExit = () => {}) };
      },
      write: (data) => pty.written.push(data),
      size: [0, 0],
      resize: (cols, rows) => {
        pty.size = [cols, rows];
      },
      kill: () => {
        pty.killed = true;
      },
      emit: (data) => onData(data),
      exit: (exitCode) => onExit({ exitCode })
    };
    pty.size = [options.cols, options.rows];
    spawned.push(pty);
    return pty;
  }
};
const Module = createRequire(__filename)('node:module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const load = Module._load;
beforeAll(() => {
  Module._load = (request, ...rest) => (request === 'node-pty' ? nodePty : load(request, ...rest));
});
afterAll(() => {
  Module._load = load;
});

// Commands found on the PATH; the real missingCommand checks them through
// isInstalled. Tests may change it; each test starts with these.
const INSTALLED = ['claude', 'codex', 'pi', 'env', 'tmux', 'abduco'];
const installed = vi.hoisted(() => new Set<string>());
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  const known = (file: string) => installed.has(file.split(/[\\/]/).pop() ?? '');
  return {
    ...fs,
    accessSync: (file: string, mode?: number) => {
      if (!known(String(file))) throw new Error('ENOENT');
      return fs.accessSync('/', mode);
    },
    statSync: (file: string) => (known(String(file)) ? { isFile: () => true } : fs.statSync(file))
  };
});

const WORKSPACE = '/work/project';
const CLAUDE = launchForCommand('claude', [], true);

function config(overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return {
    autoRun: true,
    shell: '/bin/sh',
    env: {},
    directMode: true,
    onExit: 'keep',
    programStatus: true,
    autoTabTitles: true,
    tabTitleWords: 4,
    statusColors: true,
    confirmClose: true,
    monochromeIcons: false,
    restoreTabs: true,
    profiles: [CLAUDE],
    defaultProfile: CLAUDE,
    multiplexer: 'none',
    ...overrides
  };
}

/** Tabs whose `create` fails the test instead of returning no tab */
class TestTabs extends Tabs {
  override async create(launch?: LaunchSpec): Promise<string> {
    const id = await super.create(launch);
    if (!id) throw new Error('no tab opened');
    return id;
  }
}

function setup(overrides: Partial<TerminalConfig> = {}) {
  let current = config(overrides);
  const posted: ExtensionMessage[] = [];
  const host: TabsHost & {
    visible: boolean;
    attached: boolean;
    refreshes: number;
    closeRequests: string[][];
  } = {
    visible: true,
    attached: true,
    refreshes: 0,
    closeRequests: [],
    post: (message) => posted.push(message),
    refresh: () => host.refreshes++,
    isVisible: () => host.visible,
    isAttached: () => host.attached,
    requestClose: (ids) => host.closeRequests.push(ids)
  };
  const manager = { getConfig: () => current } as unknown as ConfigManager;
  const closed = {
    tabs: [] as ClosedTab[],
    get: () => closed.tabs,
    set: (tabs: ClosedTab[]) => {
      closed.tabs = tabs;
    }
  };
  const open = {
    tabs: [] as OpenTab[],
    get: () => open.tabs,
    set: (tabs: OpenTab[]) => {
      open.tabs = tabs;
    }
  };
  const tabs = new TestTabs(manager, host, WORKSPACE, closed, open);
  const output = (id: string) =>
    posted
      .filter((m): m is Extract<ExtensionMessage, { type: 'output' }> => m.type === 'output')
      .filter((m) => m.id === id)
      .map((m) => m.data)
      .join('');
  return {
    tabs,
    host,
    closed,
    open,
    posted,
    output,
    setOnExit: (onExit: OnExitAction) => {
      current = { ...current, onExit };
    },
    setConfig: (overrides: Partial<TerminalConfig>) => {
      current = { ...current, ...overrides };
    },
    instance: (id: string) => {
      const instance = tabs.state.get(id);
      if (!instance) throw new Error(`no tab ${id}`);
      return instance;
    },
    status: (id: string) => {
      const instance = tabs.state.get(id);
      return instance ? tabs.state.getStatus(instance) : 'gone';
    },
    pty: () => spawned[spawned.length - 1]
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  installed.clear();
  for (const command of INSTALLED) installed.add(command);
  spawned.length = 0;
  vscode.errors.length = 0;
  vscode.settings = {};
  nodePty.fail = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening and closing tabs', () => {
  it('opens the first profile and shows it', async () => {
    const { tabs, posted, pty } = setup();
    const id = await tabs.create();
    expect(pty().file).toBe('claude');
    expect(tabs.state.getActiveId()).toBe(id);
    expect(posted.map((m) => m.type)).toEqual(['createTab', 'switchTab']);
  });

  it('switches to the last remaining tab after closing the active one', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.switchTo(b);
    tabs.close(b);
    expect(tabs.state.getActiveId()).toBe(c);
    expect(tabs.state.getAllIds()).toEqual([a, c]);
  });

  it('keeps the active tab when closing another', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    tabs.close(a);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('kills the process of a closed tab', async () => {
    const { tabs, pty } = setup();
    const id = await tabs.create();
    const process = pty();
    tabs.close(id);
    expect(process.killed).toBe(true);
  });

  it('opens a new tab after closing the last one', async () => {
    const { tabs } = setup();
    const id = await tabs.create();
    tabs.close(id);
    await vi.runAllTimersAsync();
    expect(tabs.state.count).toBe(1);
    expect(tabs.state.getAllIds()).not.toContain(id);
  });

  it('ignores closing a tab that does not exist', () => {
    const { tabs, posted } = setup();
    tabs.close('nope');
    expect(posted).toEqual([]);
  });
});

describe('switching tabs', () => {
  it('cycles forward and backward, wrapping around', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.cycle(1);
    expect(tabs.state.getActiveId()).toBe(a);
    tabs.cycle(-1);
    expect(tabs.state.getActiveId()).toBe(c);
    tabs.cycle(-1);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('switches by position, with 0 as the last tab', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.switchToPosition(1);
    expect(tabs.state.getActiveId()).toBe(a);
    tabs.switchToPosition(0);
    expect(tabs.state.getActiveId()).toBe(c);
    tabs.switchToPosition(2);
    expect(tabs.state.getActiveId()).toBe(b);
    tabs.switchToPosition(5);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('moves a dragged tab to a position, clamped to the strip', async () => {
    const { tabs, open, host } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const pi = launchForCommand('pi', [], true);
    const c = await tabs.create(pi);
    const refreshes = host.refreshes;
    tabs.move(c, 0);
    expect(tabs.state.getAllIds()).toEqual([c, a, b]);
    expect(open.tabs[0].launch).toEqual(pi);
    expect(host.refreshes).toBe(refreshes + 1);
    tabs.move(c, 99);
    expect(tabs.state.getAllIds()).toEqual([a, b, c]);
    tabs.move(c, 2);
    tabs.move('nope', 0);
    expect(host.refreshes).toBe(refreshes + 2);
    expect(tabs.state.getActiveId()).toBe(c);
  });

  it('moves the active tab left, right, to the start and end without wrapping', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.switchTo(b);
    tabs.moveActive('left');
    expect(tabs.state.getAllIds()).toEqual([b, a, c]);
    tabs.moveActive('left');
    expect(tabs.state.getAllIds()).toEqual([b, a, c]);
    tabs.moveActive('right');
    expect(tabs.state.getAllIds()).toEqual([a, b, c]);
    tabs.moveActive('last');
    expect(tabs.state.getAllIds()).toEqual([a, c, b]);
    tabs.moveActive('right');
    expect(tabs.state.getAllIds()).toEqual([a, c, b]);
    tabs.moveActive('first');
    expect(tabs.state.getAllIds()).toEqual([b, a, c]);
    expect(tabs.state.getActiveId()).toBe(b);
  });

  it('switches by position and cycles in the moved order', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    tabs.move(b, 0);
    tabs.switchToPosition(1);
    expect(tabs.state.getActiveId()).toBe(b);
    tabs.cycle(1);
    expect(tabs.state.getActiveId()).toBe(a);
  });

  it('lists tabs most recently used first', async () => {
    const { tabs } = setup();
    const a = await tabs.create();
    const b = await tabs.create();
    const c = await tabs.create();
    tabs.switchTo(a);
    expect(tabs.recentlyUsed()).toEqual([a, c, b]);
    tabs.close(c);
    expect(tabs.recentlyUsed()).toEqual([a, b]);
  });
});

describe('process output', () => {
  it('forwards output and answers the status support query', async () => {
    const { tabs, output, pty } = setup();
    const id = await tabs.create();
    pty().emit('hello\x1b]7501;?\x1b\\');
    expect(output(id)).toContain('hello');
    expect(pty().written).toEqual(['\x1b]7501;?\x1b\\']);
  });

  it('tracks status while the view is gone', async () => {
    const { tabs, host, output, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.attached = false;
    pty().emit(status('state=working'));
    expect(tabStatus(id)).toBe('working');
    expect(output(id)).toBe('');
  });

  it('ignores status reports with programStatus off', async () => {
    const { tabs, status: tabStatus, pty } = setup({ programStatus: false });
    const id = await tabs.create();
    pty().emit(`\x1b]7501;?\x1b\\${status('state=working')}`);
    expect(tabStatus(id)).toBeUndefined();
    expect(pty().written).toEqual([]);
  });

  it('falls back to the prompt detector for agents that report nothing', async () => {
    vscode.settings.promptNotificationDelay = 100;
    installed.add('copilot');
    const { tabs, status: tabStatus } = setup();
    const id = await tabs.create(launchForCommand('copilot', [], true));
    // Shown only for tabs in the background
    await tabs.create();
    spawned[0].emit('Run this command?\r\n❯ 1. Yes');
    vi.advanceTimersByTime(100);
    expect(tabStatus(id)).toBe('blocked');
  });
});

describe('results in background tabs', () => {
  it('stays done until the tab has been in view for a second', async () => {
    const { tabs, status: tabStatus } = setup();
    const a = await tabs.create();
    const agentA = spawned[0];
    await tabs.create();
    agentA.emit(status('state=working') + status('state=done'));
    expect(tabStatus(a)).toBe('done');

    tabs.switchTo(a);
    vi.advanceTimersByTime(999);
    expect(tabStatus(a)).toBe('done');
    vi.advanceTimersByTime(1);
    expect(tabStatus(a)).toBeUndefined();
  });

  it('stays done when the user only flicks past the tab', async () => {
    const { tabs, status: tabStatus } = setup();
    const a = await tabs.create();
    const agentA = spawned[0];
    const b = await tabs.create();
    agentA.emit(status('state=working') + status('state=done'));
    tabs.switchTo(a);
    vi.advanceTimersByTime(500);
    tabs.switchTo(b);
    vi.advanceTimersByTime(2000);
    expect(tabStatus(a)).toBe('done');
  });

  it('stays done while the view is hidden', async () => {
    const { tabs, host, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.visible = false;
    pty().emit(status('state=working') + status('state=done'));
    expect(tabStatus(id)).toBe('done');
    tabs.scheduleSeen();
    vi.advanceTimersByTime(5000);
    expect(tabStatus(id)).toBe('done');

    host.visible = true;
    tabs.scheduleSeen();
    vi.advanceTimersByTime(1000);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('counts typing into the tab as seen', async () => {
    const { tabs, host, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    host.visible = false;
    pty().emit(status('state=working') + status('state=done'));
    host.visible = true;
    tabs.input(id, 'n');
    expect(tabStatus(id)).toBeUndefined();
  });
});

describe('typed input', () => {
  it('answers an unreported question with Enter or Esc, not with arrow keys', async () => {
    const { tabs, status: tabStatus, pty } = setup();
    const id = await tabs.create();
    pty().emit(`${status('state=working')}\x07`);
    expect(tabStatus(id)).toBe('blocked');
    tabs.input(id, '\x1b[B');
    expect(tabStatus(id)).toBe('blocked');
    tabs.input(id, '\r');
    expect(tabStatus(id)).toBe('working');

    pty().emit('\x07');
    tabs.input(id, '\x1b');
    expect(tabStatus(id)).toBe('working');
  });

  it('does not count focus and mouse reports as input', async () => {
    vscode.settings.promptNotificationDelay = 100;
    const { tabs, host, status: tabStatus } = setup();
    const a = await tabs.create(launchForCommand('tmux', [], false));
    await tabs.create();
    spawned[0].emit(status('state=done'));
    spawned[0].emit('Continue?');
    vi.advanceTimersByTime(100);
    expect(tabs.state.get(a)?.isWaitingForInput).toBe(true);

    // Clicking into the tab right after switching sends focus and mouse reports
    tabs.switchTo(a);
    host.visible = true;
    tabs.input(a, '\x1b[I\x1b[<0;3;4M\x1b[<0;3;4m');
    expect(spawned[0].written).toContain('\x1b[I\x1b[<0;3;4M\x1b[<0;3;4m');
    expect(tabs.state.get(a)?.isWaitingForInput).toBe(true);
    expect(tabStatus(a)).toBe('done');
  });
});

describe('process exit', () => {
  it.each([
    ['auto', 0, false],
    ['auto', 1, true],
    ['close', 1, false],
    ['keep', 0, true]
  ] as const)('onExit %s with code %i keeps the tab: %s', async (onExit, code, kept) => {
    const { tabs, pty } = setup({ onExit });
    const id = await tabs.create();
    await tabs.create();
    vi.advanceTimersByTime(3000);
    spawned[0].exit(code);
    expect(tabs.state.get(id) !== undefined).toBe(kept);
    expect(pty()).toBe(spawned[1]);
  });

  it.each(['auto', 'close'] as const)(
    'onExit %s keeps a process that exits at once, instead of opening it again',
    async (onExit) => {
      const { tabs, output } = setup({ onExit });
      const id = await tabs.create();
      spawned[0].exit(0);
      await vi.runAllTimersAsync();
      expect(spawned).toHaveLength(1);
      expect(tabs.state.getAllIds()).toEqual([id]);
      expect(output(id)).toContain('Process exited with code 0');
    }
  );

  it('opens a new tab when the last one closes after a clean run', async () => {
    const { tabs } = setup({ onExit: 'auto' });
    const id = await tabs.create();
    vi.advanceTimersByTime(3000);
    spawned[0].exit(0);
    await vi.runAllTimersAsync();
    expect(spawned).toHaveLength(2);
    expect(tabs.state.getAllIds()).not.toContain(id);
  });

  it('shows the exit code, and Enter restarts the same command', async () => {
    const { tabs, output } = setup();
    const id = await tabs.create(launchForCommand('pi', ['--model', 'x'], true));
    spawned[0].exit(2);
    expect(output(id)).toContain('Process exited with code 2');
    tabs.input(id, 'x');
    expect(spawned).toHaveLength(1);
    tabs.input(id, '\r');
    expect(spawned).toHaveLength(2);
    expect(spawned[1].file).toBe('pi');
    expect(tabs.state.get(id)?.exited).toBe(false);
  });

  it('closes an exited tab with Esc', async () => {
    const { tabs } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].exit(0);
    tabs.input(id, '\x1b');
    expect(tabs.state.get(id)).toBeUndefined();
  });

  it('marks a failed run in a background tab, and clears a working status', async () => {
    const { tabs, status: tabStatus, instance } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status('state=working'));
    spawned[0].exit(1);
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.isBusy(instance(id))).toBe(false);
  });

  it('describes a failed exit without the message of the last report', async () => {
    const { tabs, instance } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status(`state=blocked:msg=${Buffer.from('Allow Bash?').toString('base64')}`));
    spawned[0].exit(1);
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed');
  });

  it('shows no status after a clean exit in a background tab', async () => {
    const { tabs, status: tabStatus } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(status('state=working'));
    spawned[0].exit(0);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('restarts with onExit restart, unless the process died at once', async () => {
    const { tabs } = setup({ onExit: 'restart' });
    const id = await tabs.create();
    vi.advanceTimersByTime(3000);
    spawned[0].exit(0);
    expect(spawned).toHaveLength(2);

    spawned[1].exit(1);
    expect(spawned).toHaveLength(2);
    expect(tabs.state.get(id)?.exited).toBe(true);
  });

  it('forgets the previous run when it restarts', async () => {
    const { tabs, status: tabStatus, posted } = setup();
    const id = await tabs.create();
    await tabs.create();
    spawned[0].emit(`\x1b]0;✳ Fix login\x07${status('state=error')}`);
    spawned[0].exit(1);
    tabs.input(id, '\r');
    expect(tabStatus(id)).toBeUndefined();
    expect(tabs.state.get(id)?.titleLabel).toBeUndefined();
    expect(posted).toContainEqual({ type: 'clear', id });
  });

  it('ignores exits after the view is gone', async () => {
    const { tabs, host } = setup();
    const id = await tabs.create();
    host.attached = false;
    spawned[0].exit(0);
    expect(tabs.state.get(id)?.exited).toBeFalsy();
  });
});

describe('commands that cannot start', () => {
  it('explains a missing agent instead of starting it', async () => {
    const { tabs, output, status: tabStatus, instance } = setup();
    const id = await tabs.create(launchForCommand('gemini', [], true));
    expect(spawned).toHaveLength(0);
    expect(output(id)).toContain('Gemini CLI is not installed');
    expect(vscode.errors).toEqual([
      'Gemini CLI is not installed: `gemini` was not found on the PATH.'
    ]);
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed: gemini not found');
  });

  it('starts once the agent is installed and the user presses Enter', async () => {
    const { tabs, status: tabStatus } = setup();
    const id = await tabs.create(launchForCommand('gemini', [], true));
    installed.add('gemini');
    tabs.input(id, '\r');
    installed.delete('gemini');
    expect(spawned).toHaveLength(1);
    expect(tabStatus(id)).toBeUndefined();
  });

  it('treats exit code 127 right after starting as not installed', async () => {
    const { tabs, output, status: tabStatus } = setup();
    const id = await tabs.create(launchForCommand('tmux', ['new-session', 'claude'], true));
    vi.advanceTimersByTime(100);
    spawned[0].exit(127);
    expect(output(id)).toContain('was not found on the PATH');
    expect(tabStatus(id)).toBe('error');
  });

  it('treats exit code 127 after a long run as a normal failure', async () => {
    const { tabs, output } = setup();
    const id = await tabs.create();
    vi.advanceTimersByTime(5000);
    spawned[0].exit(127);
    expect(output(id)).toContain('Process exited with code 127');
  });
});

describe('terminal size', () => {
  it('starts new processes with the last size the webview reported', async () => {
    const { tabs } = setup();
    tabs.setSize(120, 40);
    const id = await tabs.create();
    expect(spawned[0].size).toEqual([120, 40]);
    tabs.resize(id, 100, 30);
    expect(spawned[0].size).toEqual([100, 30]);
    await tabs.create();
    expect(spawned[1].size).toEqual([100, 30]);
  });
});

describe('spawn errors', () => {
  it('shows the error with the failed status, and Enter retries', async () => {
    const { tabs, output, status: tabStatus, instance } = setup();
    nodePty.fail = 'posix_spawnp failed';
    const id = await tabs.create();
    expect(output(id)).toContain('Error starting terminal: posix_spawnp failed');
    expect(tabStatus(id)).toBe('error');
    expect(tabs.state.describeStatus(instance(id))).toBe('Failed: Terminal failed to start');

    nodePty.fail = undefined;
    tabs.input(id, '\r');
    expect(spawned).toHaveLength(1);
    expect(tabStatus(id)).toBeUndefined();
  });
});

describe('showing the tabs in a view', () => {
  it('opens the first profile when there is nothing to restore', async () => {
    const { tabs } = setup();
    await tabs.attachView();
    expect(tabs.state.count).toBe(1);
  });

  it('shows the open tabs to a view that loads again, without restoring twice', async () => {
    const { tabs, open, posted } = setup();
    open.tabs = [{ launch: CLAUDE }, { launch: CLAUDE, active: true }];
    await tabs.attachView();
    const ids = tabs.state.getAllIds();
    expect(ids).toHaveLength(2);
    posted.length = 0;

    await tabs.attachView();
    expect(tabs.state.getAllIds()).toEqual(ids);
    expect(spawned).toHaveLength(2);
    expect(posted).toEqual([
      { type: 'createTab', id: ids[0] },
      { type: 'createTab', id: ids[1] },
      { type: 'switchTab', id: ids[1] }
    ]);
  });

  it('shows each tab its recent output again and has its program redraw', async () => {
    const { tabs, posted } = setup();
    await tabs.attachView();
    const [id] = tabs.state.getAllIds();
    tabs.resize(id, 100, 30);
    spawned[0].emit('hello\r\n');
    posted.length = 0;

    await tabs.attachView();
    expect(posted.slice(0, 2)).toEqual([
      { type: 'createTab', id },
      { type: 'output', id, data: 'hello\r\n' }
    ]);
    expect(spawned[0].size).toEqual([100, 29]);
    vi.advanceTimersByTime(50);
    expect(spawned[0].size).toEqual([100, 30]);
  });

  it('forgets the output of a tab that restarted', async () => {
    const { tabs, posted, output } = setup();
    await tabs.attachView();
    const [id] = tabs.state.getAllIds();
    spawned[0].emit('old run');
    spawned[0].exit(1);
    tabs.input(id, '\r');
    spawned[1].emit('new run');
    posted.length = 0;
    await tabs.attachView();
    expect(output(id)).toBe('new run');
  });

  it('restores again after the view was reset', async () => {
    const { tabs } = setup();
    await tabs.attachView();
    tabs.reset();
    await tabs.attachView();
    expect(tabs.state.count).toBe(1);
    expect(spawned).toHaveLength(2);
  });

  it('opens no extra tab when one was opened while restoring', async () => {
    const tmux = new FakeMultiplexer();
    setMultiplexer(tmux, 'tmux');
    try {
      const { tabs } = setup();
      tmux.add('other-window', { workspace: '/other' }, { attached: true });
      tmux.add('mine', {}, { attached: true });
      const attaching = tabs.attachView();
      await tabs.create();
      await vi.advanceTimersByTimeAsync(1000);
      await attaching;
      expect(tabs.state.count).toBe(1);
    } finally {
      setMultiplexer(undefined, 'tmux');
    }
  });
});

describe('reset', () => {
  it('kills every process and forgets the tabs', async () => {
    const { tabs } = setup();
    await tabs.create();
    await tabs.create();
    tabs.reset();
    expect(spawned.every((pty) => pty.killed)).toBe(true);
    expect(tabs.state.count).toBe(0);
    expect(tabs.state.getActiveId()).toBeUndefined();
  });
});

/** A tmux-like multiplexer whose sessions live in memory */
class FakeMultiplexer implements Multiplexer {
  readonly id = 'tmux';
  readonly command = 'tmux';
  /** Sessions with their tag and the exit code of their program once it ended */
  readonly sessions = new Map<
    string,
    { options: SessionOptions; exitCode?: number; attached?: boolean }
  >();
  readonly killed: string[] = [];
  readonly replies: string[] = [];
  tapData: (data: string) => void = () => {};
  tapDisposed = 0;
  fail: string | undefined;

  open(options: SessionOptions, onData: (data: string) => void): Promise<OpenResult> {
    if (this.fail) return Promise.reject(new Error(this.fail));
    const existing = this.sessions.get(options.session);
    if (existing?.exitCode !== undefined) return Promise.resolve({ exitCode: existing.exitCode });
    if (!existing) this.sessions.set(options.session, { options });
    this.tapData = onData;
    return Promise.resolve({
      client: { command: 'tmux', args: ['attach-session', '-t', options.session] },
      tap: {
        reply: (data) => this.replies.push(data),
        dispose: () => this.tapDisposed++
      },
      created: !existing
    });
  }

  /** A session as another window or workspace left it */
  add(
    name: string,
    tag: Partial<SessionTag>,
    state: { exitCode?: number; attached?: boolean } = {}
  ) {
    const fullTag: SessionTag = {
      workspace: WORKSPACE,
      launch: launchForCommand('claude', [], true),
      created: 1,
      ...tag
    };
    this.sessions.set(name, {
      options: { session: name, tag: fullTag } as SessionOptions,
      ...state
    });
  }

  exists(session: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(session));
  }

  list(): Promise<SessionEntry[]> {
    return Promise.resolve(
      [...this.sessions].map(([name, entry]) => ({
        name,
        tag: entry.options.tag,
        ended: entry.exitCode !== undefined,
        attached: entry.attached === true
      }))
    );
  }

  ended(session: string, clientCode: number): Promise<number | undefined> {
    const entry = this.sessions.get(session);
    return Promise.resolve(entry ? entry.exitCode : clientCode);
  }

  kill(session: string): Promise<void> {
    this.killed.push(session);
    this.sessions.delete(session);
    return Promise.resolve();
  }

  updateTag(session: string, tag: SessionTag): Promise<void> {
    const entry = this.sessions.get(session);
    if (entry) entry.options = { ...entry.options, tag };
    return Promise.resolve();
  }
}

/** An abduco-like multiplexer without sessions */
const noSessions: Multiplexer = {
  id: 'abduco',
  command: 'abduco',
  open: () => Promise.reject(new Error('not used')),
  exists: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
  ended: (_session, code) => Promise.resolve(code),
  kill: () => Promise.resolve(),
  updateTag: () => Promise.resolve()
};

describe('tabs in a multiplexer', () => {
  let tmux: FakeMultiplexer;
  beforeEach(() => {
    tmux = new FakeMultiplexer();
    setMultiplexer(tmux, 'tmux');
    setMultiplexer(noSessions, 'abduco');
  });
  afterEach(() => {
    setMultiplexer(undefined, 'tmux');
    setMultiplexer(undefined, 'abduco');
  });

  const sessionOf = (instance: { session?: { name: string } }) => instance.session?.name ?? '';

  it('runs the profile in a tagged session and shows it with the client', async () => {
    const { tabs, instance, pty } = setup({ multiplexer: 'tmux', env: { A: '1' } });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    expect(session).toMatch(/^agent-tabs-/);
    expect(tmux.sessions.get(session)?.options).toMatchObject({
      command: 'claude',
      args: ['--session-id', instance(id).conversation?.id],
      env: expect.objectContaining({ A: '1' }) as unknown,
      tag: { workspace: WORKSPACE, launch: { command: 'claude' } }
    });
    expect(pty().file).toBe('tmux');
  });

  it('runs a profile without a session when it says none', async () => {
    const { tabs, pty } = setup({ multiplexer: 'tmux' });
    await tabs.create({ ...launchForCommand('claude', [], true), multiplexer: 'none' });
    await vi.runAllTimersAsync();
    expect(pty().file).toBe('claude');
    expect(tmux.sessions.size).toBe(0);
  });

  it('reads status from the tap and replies through it', async () => {
    const { tabs, pty, status: tabStatus } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    // What the client draws carries no signals of the program
    pty().emit(status('state=error'));
    expect(tabStatus(id)).toBeUndefined();
    tmux.tapData(`\x1b]7501;?\x1b\\${status('state=working')}`);
    expect(tabStatus(id)).toBe('working');
    expect(tmux.replies).toEqual(['\x1b]7501;?\x1b\\']);
    expect(pty().written).toEqual([]);
  });

  it('ends the session when the tab closes', async () => {
    const { tabs, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    tabs.close(id);
    expect(tmux.killed).toEqual([session]);
    expect(tmux.tapDisposed).toBe(1);
    expect(tmux.sessions.size).toBe(1);
  });

  it('keeps sessions when the view goes away and attaches to them again', async () => {
    const { tabs, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    tabs.reset();
    expect(tmux.killed).toEqual([]);

    await expect(tabs.restore()).resolves.toBe(1);
    await vi.runAllTimersAsync();
    const [restored] = tabs.state.getAll();
    expect(restored.session?.name).toBe(session);
    expect(restored.launch.command).toBe('claude');
    expect(tmux.sessions.size).toBe(1);
  });

  it('restores the sessions of this workspace in the order they started', async () => {
    const { tabs } = setup();
    tmux.add('second', { created: 2, launch: launchForCommand('pi', [], true), cwd: '/work/b' });
    tmux.add('first', { created: 1 });
    tmux.add('elsewhere', { workspace: '/other' });
    await expect(tabs.restore()).resolves.toBe(2);
    expect(
      tabs.state.getAll().map((tab) => [tab.session?.name, tab.launch.label, tab.cwd])
    ).toEqual([
      ['first', 'Claude Code', undefined],
      ['second', 'Pi', '/work/b']
    ]);
    expect(tmux.killed).toEqual([]);
  });

  it('adopts no sessions in a window without a folder', async () => {
    const tabs = new TestTabs(
      { getConfig: () => config() } as unknown as ConfigManager,
      {
        post: () => {},
        refresh: () => {},
        isVisible: () => true,
        isAttached: () => true,
        requestClose: () => {}
      },
      ''
    );
    tmux.add('other-empty-window', { workspace: '' });
    await expect(tabs.restore()).resolves.toBe(0);
  });

  it('leaves a session alone that another window shows', async () => {
    const { tabs } = setup();
    tmux.add('shown', {}, { attached: true });
    const restoring = tabs.restore();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(restoring).resolves.toBe(0);
  });

  it('restores a session whose old client detached meanwhile', async () => {
    const { tabs } = setup();
    tmux.add('reconnected', {}, { attached: true });
    const restoring = tabs.restore();
    const entry = tmux.sessions.get('reconnected');
    if (entry) entry.attached = false;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(restoring).resolves.toBe(1);
  });

  it('does not start a session again that ended while it was restored', async () => {
    const { tabs, output } = setup({ multiplexer: 'tmux' });
    tmux.add('mine', {});
    const restoring = tabs.restore();
    await Promise.resolve();
    tmux.sessions.delete('mine');
    await restoring;
    await vi.runAllTimersAsync();
    const [tab] = tabs.state.getAll();
    expect(output(tab.id)).toContain('The session ended elsewhere');
    expect(tmux.sessions.size).toBe(0);
    expect(tab.exited).toBe(true);

    tabs.input(tab.id, '\r');
    await vi.runAllTimersAsync();
    expect(tmux.sessions.size).toBe(1);
  });

  it('ends ended sessions of other workspaces that no window shows', async () => {
    const { tabs } = setup();
    tmux.add('other-ended', { workspace: '/other' }, { exitCode: 0 });
    tmux.add('other-running', { workspace: '/other' });
    tmux.add('other-shown', { workspace: '/other' }, { exitCode: 0, attached: true });
    await expect(tabs.restore()).resolves.toBe(0);
    expect(tmux.killed).toEqual(['other-ended']);
  });

  it('handles the end of the program like an exit', async () => {
    const { tabs, instance, pty, output } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    const entry = tmux.sessions.get(session);
    if (entry) entry.exitCode = 2;
    pty().exit(0);
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('Process exited with code 2');
    expect(tmux.killed).toEqual([session]);
    expect(instance(id).session).toBeUndefined();

    tabs.input(id, '\r');
    await vi.runAllTimersAsync();
    expect(sessionOf(instance(id))).not.toBe(session);
    expect(tmux.sessions.size).toBe(1);
  });

  it('offers to attach again after the client was detached', async () => {
    const { tabs, instance, pty, output, status: tabStatus } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    const first = pty();
    first.exit(0);
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('Detached');
    expect(instance(id).detached).toBe(true);
    expect(tabStatus(id)).toBeUndefined();

    tabs.input(id, '\r');
    await vi.runAllTimersAsync();
    expect(pty()).not.toBe(first);
    expect(sessionOf(instance(id))).toBe(session);

    pty().exit(0);
    await vi.runAllTimersAsync();
    tabs.close(id);
    expect(tabs.state.get(id)).toBeUndefined();
    expect(tmux.killed).toEqual([session]);
  });

  it('asks before Esc ends a detached session', async () => {
    const { tabs, instance, pty, host } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    pty().exit(0);
    await vi.runAllTimersAsync();
    tabs.input(id, '\x1b');
    expect(host.closeRequests).toEqual([[id]]);
    expect(tabs.state.get(id)).toBeDefined();
    expect(tmux.killed).toEqual([]);
    expect(tabs.state.closeRisk(instance(id))).toBe('session');
  });

  it('keeps a session that started after the view went away', async () => {
    const { tabs } = setup({ multiplexer: 'tmux' });
    await tabs.create();
    tabs.reset();
    await vi.runAllTimersAsync();
    expect(tmux.sessions.size).toBe(1);
    expect(tmux.killed).toEqual([]);
    expect(tmux.tapDisposed).toBe(1);
  });

  it('shows a program of this workspace that ended while no client was attached', async () => {
    const { tabs, output } = setup();
    tmux.add('done', {}, { exitCode: 1 });
    await tabs.restore();
    await vi.runAllTimersAsync();
    const [tab] = tabs.state.getAll();
    expect(output(tab.id)).toContain('Process exited with code 1');
    expect(tmux.killed).toEqual(['done']);
  });

  it('explains a missing multiplexer', async () => {
    installed.delete('tmux');
    try {
      const { tabs, output } = setup({ multiplexer: 'tmux' });
      const id = await tabs.create();
      expect(output(id)).toContain('`tmux` was not found');
      expect(tmux.sessions.size).toBe(0);
    } finally {
      installed.add('tmux');
    }
  });

  it('shows an error when the session cannot start', async () => {
    tmux.fail = 'server exited unexpectedly';
    const { tabs, output, instance } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    expect(output(id)).toContain('server exited unexpectedly');
    expect(instance(id).session).toBeUndefined();
  });

  it('stores in the session tag once its conversation started', async () => {
    const { tabs, instance, pty } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await vi.runAllTimersAsync();
    const session = sessionOf(instance(id));
    const tag = () => tmux.sessions.get(session)?.options.tag;
    expect(tag()?.conversation).toEqual({ id: instance(id).conversation?.id, started: false });

    tmux.tapData(status('state=working'));
    await vi.runAllTimersAsync();
    expect(tag()?.conversation?.started).toBe(true);
    expect(pty().file).toBe('tmux');
  });

  it('attaches to a session whose conversation never started without resuming it', async () => {
    const { tabs, instance } = setup();
    tmux.add('fresh', { conversation: { id: 'c1', started: false } });
    tmux.add('used', { conversation: { id: 'c2', started: true }, created: 2 });
    tmux.add('old', { conversation: { id: 'c3' }, created: 3 });
    await tabs.restore();
    expect(tabs.state.getAll().map((tab) => tab.conversation?.started)).toEqual([
      false,
      true,
      true
    ]);
    tabs.close(tabs.state.getAllIds()[0]);
    expect(instance(tabs.state.getAllIds()[0]).conversation?.id).toBe('c2');
  });

  it('ends a session that started after its tab closed', async () => {
    const { tabs } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create();
    await tabs.create();
    tabs.close(id);
    await vi.runAllTimersAsync();
    expect(tmux.sessions.size).toBe(1);
    expect(tmux.tapDisposed).toBe(1);
  });
});

describe('reopening closed tabs', () => {
  const args = (pty: { args?: string[] } | undefined) => pty?.args ?? [];
  const working = status('state=working');

  it('starts Claude with a conversation ID and continues it when reopened', async () => {
    const { tabs, pty, instance, closed } = setup();
    const id = await tabs.create();
    const conversation = instance(id).conversation?.id ?? '';
    expect(conversation).toMatch(/^[0-9a-f-]{36}$/);
    expect(args(pty())).toEqual(['--session-id', conversation]);
    pty().emit(working);
    tabs.close(id);
    expect(closed.tabs).toEqual([expect.objectContaining({ conversation })]);

    expect(tabs.reopenClosed()).toBe(true);
    expect(args(pty())).toEqual(['--resume', conversation]);
    expect(closed.tabs).toEqual([]);
    expect(tabs.reopenClosed()).toBe(false);
  });

  it('does not remember a tab before a message was sent', async () => {
    const { tabs, closed } = setup();
    const id = await tabs.create();
    tabs.input(id, 'h');
    tabs.input(id, '\r');
    tabs.close(id);
    expect(closed.tabs).toEqual([]);
  });

  it('remembers an agent without status once Enter was pressed', async () => {
    installed.add('cursor-agent');
    try {
      const { tabs, closed, pty } = setup();
      const id = await tabs.create(launchForCommand('cursor-agent', [], true));
      const conversation = args(pty())[1];
      expect(args(pty())[0]).toBe('--new-session-id');
      tabs.input(id, 'fix it');
      tabs.input(id, '\r');
      tabs.close(id);
      expect(closed.tabs).toEqual([expect.objectContaining({ conversation })]);
      tabs.reopenClosed();
      expect(args(pty())).toEqual(['--resume', conversation]);
    } finally {
      installed.delete('cursor-agent');
    }
  });

  it('reopens several closed tabs, newest first', async () => {
    const { tabs, pty, instance } = setup();
    const ids = [await tabs.create(), await tabs.create(), await tabs.create()];
    const conversations = ids.map((id) => instance(id).conversation?.id);
    for (const process of spawned) process.emit(working);
    tabs.close(ids[0]);
    tabs.close(ids[1]);
    tabs.reopenClosed();
    expect(args(pty())).toEqual(['--resume', conversations[1]]);
    tabs.reopenClosed();
    expect(args(pty())).toEqual(['--resume', conversations[0]]);
  });

  it('keeps at most ten closed tabs', async () => {
    const { tabs, closed } = setup();
    for (let i = 0; i < 12; i++) {
      const id = await tabs.create();
      spawned[spawned.length - 1].emit(working);
      tabs.close(id);
      await vi.runAllTimersAsync();
    }
    expect(closed.tabs).toHaveLength(10);
  });

  it('starts a new conversation on restart and keeps the old one for reopening', async () => {
    const { tabs, pty, instance, closed } = setup();
    const id = await tabs.create();
    const first = instance(id).conversation?.id;
    pty().emit(working);
    pty().exit(1);
    tabs.input(id, '\r');
    const second = instance(id).conversation?.id;
    expect(second).not.toBe(first);
    expect(args(pty())).toEqual(['--session-id', second]);
    expect(closed.tabs).toEqual([expect.objectContaining({ conversation: first })]);
  });

  it('leaves command lines alone that pick a conversation themselves', async () => {
    const { tabs, pty, instance } = setup();
    const id = await tabs.create(launchForCommand('claude', ['--continue'], true));
    expect(instance(id).conversation).toBeUndefined();
    expect(args(pty())).toEqual(['--continue']);
    await tabs.create(launchForCommand('codex', [], false));
    expect(args(pty())).toEqual([]);
  });

  it.each([
    ['claude', ['doctor']],
    ['claude', ['mcp', 'list']],
    ['pi', ['install', 'npm:x']],
    ['agent', ['login']]
  ])('adds nothing in front of a subcommand: %s %s', async (command, rest) => {
    installed.add('agent');
    try {
      const { tabs, pty, instance } = setup();
      const id = await tabs.create(launchForCommand(command, rest, true));
      expect(instance(id).conversation).toBeUndefined();
      expect(args(pty())).toEqual(rest);
    } finally {
      installed.delete('agent');
    }
  });

  it('adds nothing to a command that only mentions an agent', async () => {
    const { tabs, pty } = setup();
    await tabs.create(launchForCommand('tmux', ['new', '-s', 'claude'], true));
    expect(args(pty())).toEqual(['new', '-s', 'claude']);
  });

  it.each([
    ['npx', ['@openai/codex']],
    ['ssh', ['devbox', 'claude']]
  ])('starts %s %s without looking for the agent here', async (command, rest) => {
    installed.add(command);
    installed.delete('claude');
    try {
      const { tabs, pty } = setup();
      await tabs.create(launchForCommand(command, rest, false));
      expect(pty()?.file).toBe(command);
    } finally {
      installed.delete(command);
      installed.add('claude');
    }
  });

  it('adds the arguments after an agent behind a wrapper', async () => {
    const { tabs, pty, instance } = setup();
    const [profile] = resolveProfiles(
      [{ name: 'Pi', command: 'env A=1 pi --model x' }],
      false
    ).profiles;
    const id = await tabs.create(profile);
    const conversation = instance(id).conversation?.id;
    expect([pty().file, ...args(pty())]).toEqual([
      'env',
      'A=1',
      'pi',
      '--session-id',
      conversation,
      '--model',
      'x'
    ]);
  });
});

describe('asking before closing', () => {
  it('asks for typed but unsent input, not after it was deleted', async () => {
    const { tabs, instance } = setup();
    const id = await tabs.create();
    const risk = () => tabs.state.closeRisk(instance(id));
    expect(risk()).toBeUndefined();
    tabs.input(id, 'hi');
    expect(risk()).toBe('draft');
    tabs.input(id, '\x7f');
    tabs.input(id, '\x7f');
    expect(risk()).toBeUndefined();
  });

  it('counts a message as sent when the agent starts working, not on Enter', async () => {
    const { tabs, instance, pty } = setup();
    const id = await tabs.create();
    pty().emit(status('state=idle'));
    tabs.input(id, 'do it');
    tabs.input(id, '\r');
    expect(tabs.state.closeRisk(instance(id))).toBe('draft');
    pty().emit(status('state=working'));
    expect(tabs.state.closeRisk(instance(id))).toBe('working');
    pty().emit(status('state=done'));
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
  });

  it.each([
    ['with programStatus off', { programStatus: false }, 'claude'],
    ['for an agent that has not reported yet', {}, 'codex']
  ] as const)('counts Enter as sending %s', async (_case, overrides, command) => {
    const { tabs, instance } = setup(overrides);
    const id = await tabs.create(launchForCommand(command, [], false));
    tabs.input(id, 'go');
    tabs.input(id, '\r');
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
  });

  it('starts the conversation on Enter with programStatus off', async () => {
    const { tabs, instance, closed } = setup({ programStatus: false });
    const id = await tabs.create();
    tabs.input(id, 'go');
    tabs.input(id, '\r');
    expect(instance(id).conversation?.started).toBe(true);
    tabs.close(id);
    expect(closed.tabs).toHaveLength(1);
  });

  it('counts Enter as sending for agents without status', async () => {
    installed.add('gemini');
    const { tabs, instance } = setup();
    const id = await tabs.create(launchForCommand('gemini', [], false));
    installed.delete('gemini');
    tabs.input(id, 'go');
    tabs.input(id, '\r');
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
  });

  it('asks after editing it cannot follow, until the next message', async () => {
    const { tabs, instance, pty } = setup();
    const id = await tabs.create();
    tabs.input(id, 'hello');
    tabs.input(id, '\x17');
    expect(tabs.state.closeRisk(instance(id))).toBe('draft');
    pty().emit(status('state=working'));
    pty().emit(status('state=done'));
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
  });

  it('ignores mouse and focus reports and does not ask after an exit', async () => {
    const { tabs, instance, pty } = setup();
    const id = await tabs.create();
    tabs.input(id, '\x1b[I');
    tabs.input(id, '\x1b[<0;3;4M');
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
    tabs.input(id, 'x');
    pty().exit(1);
    expect(tabs.state.closeRisk(instance(id))).toBeUndefined();
  });
});

describe('restoring the tabs of the last window', () => {
  let tmux: FakeMultiplexer;
  beforeEach(() => {
    tmux = new FakeMultiplexer();
    setMultiplexer(tmux, 'tmux');
    setMultiplexer(noSessions, 'abduco');
  });
  afterEach(() => {
    setMultiplexer(undefined, 'tmux');
    setMultiplexer(undefined, 'abduco');
  });

  const working = status('state=working');
  const PI = launchForCommand('pi', [], true);

  it('keeps the open tabs in order, with the active one and started conversations', async () => {
    const { tabs, open, pty, instance } = setup();
    const first = await tabs.create();
    pty().emit(working);
    const second = await tabs.create(PI);
    tabs.switchTo(first);
    expect(open.tabs).toEqual([
      expect.objectContaining({
        launch: CLAUDE,
        conversation: instance(first).conversation?.id,
        active: true
      }),
      expect.objectContaining({ launch: PI, conversation: undefined, active: undefined })
    ]);
    tabs.close(second);
    expect(open.tabs).toHaveLength(1);
  });

  const profile = (command: string, env?: Record<string, string>) =>
    resolveProfiles([{ name: 'Mine', command, env }], true).profiles[0];

  it('keeps no environment variables, and takes them from the profile again', async () => {
    const { tabs, open, closed, setConfig } = setup({ multiplexer: 'tmux' });
    const id = await tabs.create(profile('claude', { API_KEY: 'old' }));
    await vi.runAllTimersAsync();
    tmux.tapData(working);
    expect(open.tabs[0].launch.env).toEqual({});
    expect([...tmux.sessions.values()][0].options.tag.launch.env).toEqual({});
    expect([...tmux.sessions.values()][0].options.env).toMatchObject({ API_KEY: 'old' });
    tabs.close(id);
    expect(closed.tabs[0].launch.env).toEqual({});

    setConfig({ profiles: [profile('claude --model x', { API_KEY: 'new' })] });
    tabs.reopenClosed();
    await vi.runAllTimersAsync();
    const [session] = [...tmux.sessions.values()];
    expect(session.options.env).toMatchObject({ API_KEY: 'new' });
    expect(session.options.args).toContain('--model');
  });

  it('runs a restored tab as its profile is now, or as stored when it is gone', async () => {
    const { tabs, open, setConfig } = setup({ multiplexer: 'none' });
    open.tabs = [{ launch: { ...profile('claude'), env: {} } }, { launch: profile('pi') }];
    setConfig({ profiles: [profile('claude --model x')] });
    await tabs.restore();
    expect(spawned).toHaveLength(2);
    expect(spawned[0].args).toContain('--model');
    expect(spawned[1].file).toBe('pi');
  });

  it('opens them again in the next window and continues their conversations', async () => {
    const previous = setup();
    const first = await previous.tabs.create();
    previous.pty().emit(working);
    const conversation = previous.instance(first).conversation?.id;
    await previous.tabs.create(PI);
    previous.tabs.switchTo(first);

    const { tabs, open, posted } = setup();
    open.tabs = previous.open.tabs;
    spawned.length = 0;
    await expect(tabs.restore()).resolves.toBe(2);
    const [claude, pi] = tabs.state.getAll();
    expect(spawned.map((pty) => [pty.file, ...pty.args])).toEqual([
      ['claude', '--resume', conversation],
      ['pi', '--session-id', pi.conversation?.id]
    ]);
    expect(pi.conversation?.started).toBe(false);
    expect(tabs.state.getActiveId()).toBe(claude.id);
    expect(posted.filter((m) => m.type === 'switchTab').pop()).toEqual({
      type: 'switchTab',
      id: claude.id
    });
    expect(open.tabs).toEqual(previous.open.tabs);
  });

  it('restores nothing with restoreTabs off', async () => {
    const { tabs, open } = setup({ restoreTabs: false });
    open.tabs = [{ launch: CLAUDE, active: true }];
    await expect(tabs.restore()).resolves.toBe(0);
    expect(spawned).toEqual([]);
  });

  it('does not forget the tabs when the view goes away', async () => {
    const { tabs, open, host } = setup();
    await tabs.create();
    await tabs.create(PI);
    host.attached = false;
    tabs.reset();
    tabs.close('none');
    expect(open.tabs).toHaveLength(2);
  });

  it('attaches to a running session in its place, and opens unknown sessions after', async () => {
    const { tabs, open } = setup();
    tmux.add('kept', { created: 5, launch: PI });
    tmux.add('other', { created: 1 });
    tmux.add('gone', { created: 2 }, { attached: true });
    open.tabs = [
      { launch: CLAUDE, conversation: 'abc' },
      { launch: PI, session: 'kept', active: true },
      { launch: CLAUDE, session: 'gone' }
    ];
    const restored = tabs.restore();
    await vi.runAllTimersAsync();
    await expect(restored).resolves.toBe(3);
    expect(
      tabs.state.getAll().map((tab) => [tab.launch.label, tab.session?.name, tab.isActive])
    ).toEqual([
      ['Claude Code', undefined, false],
      ['Pi', 'kept', true],
      ['Claude Code', 'other', false]
    ]);
  });
});

describe("pi's notice about a new session ID", () => {
  const PI = launchForCommand('pi', [], true);
  const notice = (id: string) =>
    `\x1b[33mWarning: No project session found with id '${id}'; creating a new session with that id.\x1b[39m\r\n`;

  it('hides the notice when a new pi tab starts its conversation', async () => {
    const { tabs, pty, instance, output } = setup();
    const id = await tabs.create(PI);
    const conversation = instance(id).conversation?.id ?? '';
    pty().emit(`${notice(conversation)}\x1b[?1049hscreen`);
    expect(output(id)).toBe('\x1b[?1049hscreen');
  });

  it('keeps other output, and the notice for another ID', async () => {
    const { tabs, pty, output } = setup();
    const id = await tabs.create(PI);
    pty().emit(`hello\r\n${notice('other')}`);
    expect(output(id)).toBe(`hello\r\n${notice('other')}`);
  });

  it('hides the notice when it arrives in pieces', async () => {
    const { tabs, pty, instance, output } = setup();
    const id = await tabs.create(PI);
    const text = notice(instance(id).conversation?.id ?? '');
    pty().emit(`before\r\n${text.slice(0, 12)}`);
    expect(output(id)).toBe('before\r\n');
    pty().emit(text.slice(12, 40));
    pty().emit(`${text.slice(40)}after`);
    expect(output(id)).toBe('before\r\nafter');
  });

  it('shows output that only looked like the start of the notice', async () => {
    const { tabs, pty, output } = setup();
    const id = await tabs.create(PI);
    pty().emit('Warning: low disk');
    vi.advanceTimersByTime(100);
    expect(output(id)).toBe('Warning: low disk');
    pty().emit('\r\nWarn');
    pty().emit('ing: other');
    expect(output(id)).toBe('Warning: low disk\r\nWarning: other');
  });

  it('stops looking once the program shows its screen', async () => {
    const { tabs, pty, instance, output } = setup();
    const id = await tabs.create(PI);
    const conversation = instance(id).conversation?.id ?? '';
    pty().emit('\x1b[?1049h');
    pty().emit(notice(conversation));
    expect(output(id)).toBe(`\x1b[?1049h${notice(conversation)}`);
  });
});
