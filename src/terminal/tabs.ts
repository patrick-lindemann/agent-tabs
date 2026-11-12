import * as vscode from 'vscode';
import { type ConfigManager, promptConfig } from '../config';
import {
  isInstalled,
  missingCommand,
  newConversation,
  reportsStatus,
  startNotice,
  withConversation
} from '../profiles';
import type {
  ClosedTab,
  ExtensionMessage,
  LaunchSpec,
  OpenTab,
  SessionRef,
  SplitSide,
  TerminalInstance
} from '../types';
import { typed } from './draft';
import type { SavedLayout } from './layout';
import {
  getMultiplexer,
  MULTIPLEXER_IDS,
  type Multiplexer,
  type MultiplexerId,
  type SessionEntry,
  type SessionTag,
  type Tap
} from './multiplexer';
import { NoticeFilter } from './notice';
import { PromptDetector } from './prompt';
import { PtyManager } from './pty';
import { isTerminalReport } from './signals';
import { TerminalStateManager } from './state';
import { resetStatus, StatusTracker } from './status';

/** Exit code of a shell or wrapper that could not find a command */
const COMMAND_NOT_FOUND = 127;

/** How long restoring waits for the clients of a previous view to detach */
const DETACH_WAIT_MS = 1000;

/**
 * How much of each tab's recent output is kept, in characters, to show it
 * again in a webview that loaded again, e.g. after Reload Webviews
 */
const HISTORY_CHARS = 512 * 1024;

/** How long output that may start a program's notice waits for the rest of it */
const NOTICE_FLUSH_MS = 100;

/** How long a tab must stay in view before its result counts as seen */
const SEEN_DELAY_MS = 1000;

/**
 * A process that exits sooner did not start properly, e.g. a wrong option;
 * its tab stays open with the exit code instead of closing or restarting,
 * which could loop
 */
const QUICK_EXIT_MS = 3000;

/** What the tabs need from the view that shows them */
export interface TabsHost {
  post(message: ExtensionMessage): void;
  /** Sends the tab list again after a tab's label or status changed */
  refresh(): void;
  /** Whether the view exists and is shown */
  isVisible(): boolean;
  /** Whether the view exists, so process output has somewhere to go */
  isAttached(): boolean;
  /** Closes tabs the user asked to close, asking first when they would lose something */
  requestClose(ids: string[]): void;
}

/** Where closed tabs are kept for reopening, e.g. the workspace state */
export interface ClosedTabStore {
  get(): ClosedTab[];
  set(tabs: ClosedTab[]): void;
}

/**
 * Where the open tabs and the panes they are in are kept for the next
 * window, e.g. the workspace state
 */
export interface OpenTabStore {
  get(): OpenTab[];
  set(tabs: OpenTab[]): void;
  /** The splits of the panes; none with one pane */
  getLayout(): unknown;
  setLayout(layout: SavedLayout | undefined): void;
}

/** How many closed tabs can be reopened */
const MAX_CLOSED_TABS = 10;

/**
 * The open tabs and their processes: opening, closing, switching, restarting
 * and what happens when a process exits.
 */
export class Tabs {
  readonly state = new TerminalStateManager();
  readonly pty: PtyManager;
  private readonly prompt: PromptDetector;
  private readonly status = new StatusTracker();
  /** Raw output of tabs whose multiplexer hides status signals from the client */
  private readonly taps = new Map<string, Tap>();
  /** Hide a notice a tab's program prints when it starts */
  private readonly notices = new Map<string, NoticeFilter>();
  private seenTimer: ReturnType<typeof setTimeout> | undefined;
  /** Each tab's recent output, as the webview showed it */
  private readonly history = new Map<string, string>();
  /** Shows output a notice filter held back, when no more came */
  private readonly noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Tab IDs, most recently shown first */
  private recent: string[] = [];
  /** The open tabs last kept, to write them only when they change */
  private savedOpen: string | undefined;
  /** Tabs are being restored; they are kept once all are open */
  private restoring = false;
  /** The first view's restore; later views of the same tabs only show them */
  private restored: Promise<void> | undefined;
  /**
   * Counts resets of the view, so work that started before one, e.g. a
   * session that is still starting, does not treat its tab as closed
   */
  private generation = 0;
  private cols = 80;
  private rows = 24;

  constructor(
    private readonly config: ConfigManager,
    private readonly host: TabsHost,
    /** Identifies the workspace in the tags of its sessions */
    private readonly workspace = '',
    private readonly closedTabs?: ClosedTabStore,
    private readonly openTabs?: OpenTabStore
  ) {
    this.pty = new PtyManager({
      onData: (id, data) => this.handleData(id, data),
      onExit: (id, code, runtimeMs) => void this.clientExited(id, code, runtimeMs),
      onError: (id, error) => this.handleError(id, error)
    });
    this.prompt = new PromptDetector(promptConfig(), (id, waiting) => {
      this.state.setWaitingForInput(id, waiting);
      this.refresh();
    });
  }

  /** Sends the tab list again and keeps the open tabs for the next window */
  private refresh(): void {
    this.saveOpen();
    this.host.refresh();
  }

  /**
   * Opens a tab in the focused pane, or with `split` in a new pane on that
   * side of it. Without a launch it runs the first profile. Returns
   * undefined when the user cancelled choosing its folder.
   */
  async create(launch?: LaunchSpec, split?: SplitSide): Promise<string | undefined> {
    const folder = await this.pty.selectWorkingDirectory();
    if (!folder) return undefined;
    const { path: cwd, folderIndex } = folder;
    // An empty pane (none is focused only while the view has no tab) takes the tab
    const focused = this.state.getFocusedPaneId();
    const pane =
      split && this.state.getPaneTabs(focused).length > 0
        ? this.state.addPane(focused, split)?.id
        : undefined;
    return this.open({
      launch: launch ?? this.config.getConfig().defaultProfile,
      cwd,
      workspaceFolderIndex: folderIndex,
      pane
    });
  }

  /**
   * The view is ready to show tabs. The first time, the tabs of the last
   * window open again, or the first profile when there are none. A view
   * that loads again while the tabs still run, e.g. after its webview was
   * reloaded, gets the open tabs instead.
   */
  async attachView(): Promise<void> {
    if (this.restored) {
      await this.restored;
      this.showAll();
      return;
    }
    const generation = this.generation;
    const restoring = this.restore().then(async () => {
      // A tab the user opened while restoring waited for sessions counts too
      if (this.generation === generation && this.state.count === 0) await this.create();
    });
    this.restored = restoring;
    try {
      await restoring;
    } catch (error) {
      if (this.restored === restoring) this.restored = undefined;
      throw error;
    }
  }

  /**
   * Sends all open tabs to a view that does not know them yet, with their
   * recent output, and asks their programs to draw their screen again
   */
  private showAll(): void {
    for (const id of this.state.getAllIds()) {
      this.host.post({ type: 'createTab', id });
      const history = this.history.get(id);
      if (history) this.host.post({ type: 'output', id, data: history });
      this.pty.redraw(id);
    }
    this.host.refresh();
    const active = this.state.getActiveId();
    if (active) this.host.post({ type: 'switchTab', id: active });
  }

  /**
   * Opens the tabs of the last window of this workspace again, in their
   * order and with the same tab active, and returns how many there are.
   * With `agentTabs.restoreTabs`, a tab continues its conversation where its
   * agent supports that, or starts its profile again in its folder.
   *
   * A tab whose multiplexer session still runs attaches to it, e.g. after
   * the window reloaded or reconnected to its remote. Sessions of this
   * workspace that no window shows and the last window did not list open
   * too, in the order they started. Sessions are found by the tag the
   * extension stores with them on the machine they run on, so other
   * sessions are never touched.
   *
   * Sessions of other workspaces whose program ended and that no window
   * shows are ended, so they do not pile up.
   *
   * A window without a folder belongs to no workspace: it adopts no
   * sessions, since every such window would share them, and only reopens
   * the sessions it listed itself.
   */
  async restore(): Promise<number> {
    const saved = this.config.getConfig().restoreTabs ? (this.openTabs?.get() ?? []) : [];
    const generation = this.generation;
    let entries = await this.listSessions();
    // Clients of the previous view may still be detaching, e.g. after the
    // window reconnected to its remote
    if (entries.some((entry) => this.isOwn(entry) && entry.attached)) {
      await new Promise((resolve) => setTimeout(resolve, DETACH_WAIT_MS));
      entries = await this.listSessions();
    }
    // The view went away meanwhile; the next one restores
    if (this.generation !== generation) return 0;
    for (const entry of entries) {
      if (!this.isOwn(entry) && entry.ended && !entry.attached) {
        void getMultiplexer(entry.multiplexer).kill(entry.name);
      }
    }

    const shown = new Set(this.state.getAll().map((instance) => instance.session?.name));
    const own = new Map(
      entries.filter((entry) => this.isOwn(entry)).map((entry) => [entry.name, entry])
    );
    const listed = new Set(saved.map((tab) => tab.session));
    const opened: string[] = [];
    /** The tabs their panes showed; the focused pane's last */
    const shownInPane: string[] = [];
    let focused: string | undefined;
    // The panes the saved tabs were in, by their position in reading order.
    // A saved layout that does not fit the tabs, e.g. from another version,
    // puts them all in one pane.
    const count = Math.max(0, ...saved.map((tab) => (tab.pane ?? 0) + 1));
    const panes =
      (this.state.count === 0 && count > 1
        ? this.state.restoreLayout(this.openTabs?.getLayout(), count)
        : undefined) ?? [];
    const paneFor = (tab: OpenTab): string | undefined => panes[tab.pane ?? 0];
    this.restoring = true;
    try {
      for (const tab of saved) {
        const entry = tab.session ? own.get(tab.session) : undefined;
        if (tab.session && (shown.has(tab.session) || entry?.attached)) continue;
        const pane = paneFor(tab);
        if (entry) {
          own.delete(entry.name);
          opened.push(this.openSession(entry, pane));
        } else {
          opened.push(
            this.open({
              launch: this.current(tab.launch),
              cwd: tab.cwd,
              workspaceFolderIndex: tab.workspaceFolderIndex,
              conversation: tab.conversation ? { id: tab.conversation, started: true } : undefined,
              pane
            })
          );
        }
        const id = opened[opened.length - 1];
        if (tab.active) shownInPane.push(id);
        // Saved with one pane, the active tab had focus
        if (tab.focused || (tab.active && tab.pane === undefined)) focused = id;
      }
      // Sessions the last window did not list open in the pane that had focus
      if (focused) this.state.setActive(focused);
      const sessions = [...own.values()]
        .filter((entry) => this.workspace !== '' || listed.has(entry.name))
        .filter((entry) => !entry.attached && !shown.has(entry.name))
        .sort((a, b) => a.tag.created - b.tag.created);
      for (const entry of sessions) {
        opened.push(this.openSession(entry));
      }
    } finally {
      this.restoring = false;
      // Panes whose tabs show elsewhere now, e.g. in another window, close
      this.state.prunePanes();
    }
    for (const id of shownInPane) this.state.setActive(id, false);
    if (focused) this.switchTo(focused);
    else if (opened.length > 0) this.refresh();
    this.saveOpen();
    return opened.length;
  }

  /** Opens a tab that attaches to a session of this workspace */
  private openSession(
    { name, multiplexer, tag }: SessionEntry & { multiplexer: MultiplexerId },
    pane?: string
  ): string {
    return this.open({
      pane,
      launch: this.current(tag.launch),
      cwd: tag.cwd,
      workspaceFolderIndex: tag.workspaceFolderIndex,
      session: { multiplexer, name, created: tag.created, started: tag.conversation?.started },
      // Tags of older versions do not say whether a message was sent
      conversation: tag.conversation && {
        id: tag.conversation.id,
        started: tag.conversation.started ?? true
      }
    });
  }

  /**
   * Keeps the open tabs for the next window of the workspace, unless the
   * view is gone: its tabs ended with it but should open again.
   */
  private saveOpen(): void {
    if (!this.openTabs || this.restoring || !this.host.isAttached()) return;
    const activeId = this.state.getActiveId();
    const panes = this.state.getPaneIds();
    const split = panes.length > 1;
    const layout = this.state.saveLayout();
    const tabs: OpenTab[] = panes.flatMap((pane, index) =>
      this.state.getPaneTabs(pane).flatMap((id) => {
        const instance = this.state.get(id);
        if (!instance) return [];
        const tab: OpenTab = {
          launch: stored(instance.launch),
          cwd: instance.cwd,
          workspaceFolderIndex: instance.workspaceFolderIndex,
          conversation: instance.conversation?.started ? instance.conversation.id : undefined,
          session: instance.session?.name
        };
        if (!split) {
          tab.active = id === activeId || undefined;
          return [tab];
        }
        tab.active = instance.isActive || undefined;
        tab.focused = id === activeId || undefined;
        tab.pane = index;
        return [tab];
      })
    );
    const json = JSON.stringify([tabs, layout]);
    if (json === this.savedOpen) return;
    this.savedOpen = json;
    // The layout first, so tabs never refer to panes it does not have
    this.openTabs.setLayout(layout);
    this.openTabs.set(tabs);
  }

  /**
   * The sessions the extension started, of every installed multiplexer,
   * also when none is configured now, as sessions may remain from before
   */
  private async listSessions(): Promise<Array<SessionEntry & { multiplexer: MultiplexerId }>> {
    const lists = await Promise.all(
      MULTIPLEXER_IDS.map(async (id) => {
        const multiplexer = getMultiplexer(id);
        if (!isInstalled(multiplexer.command)) return [];
        const sessions = await multiplexer.list().catch(() => []);
        return sessions.map((entry) => ({ ...entry, multiplexer: id }));
      })
    );
    return lists.flat();
  }

  private isOwn(entry: SessionEntry): boolean {
    return entry.tag.workspace === this.workspace;
  }

  /**
   * Reopens the most recently closed tab that had a conversation, and
   * continues it. Returns whether there was one.
   */
  reopenClosed(): boolean {
    const closed = this.closedTabs?.get() ?? [];
    const [tab, ...rest] = closed;
    if (!tab) return false;
    this.closedTabs?.set(rest);
    this.open({
      launch: this.current(tab.launch),
      cwd: tab.cwd,
      workspaceFolderIndex: tab.workspaceFolderIndex,
      conversation: { id: tab.conversation, started: true }
    });
    return true;
  }

  /**
   * A stored launch as its profile is now, e.g. after the profile's
   * command or environment changed. As stored when the profile is gone, it
   * was a custom command, or the profile now runs another agent, which
   * could not continue the conversation. A stored launch has no environment.
   */
  private current(launch: LaunchSpec): LaunchSpec {
    if (!launch.profile) return launch;
    const { profiles } = this.config.getConfig();
    const profile = profiles.find((other) => other.label === launch.profile);
    return profile && profile.agent === launch.agent ? profile : launch;
  }

  /** Keeps a closed tab whose conversation can be continued */
  private rememberClosed(instance: TerminalInstance): void {
    if (!this.closedTabs || !instance.conversation?.started) return;
    const tab: ClosedTab = {
      launch: stored(instance.launch),
      conversation: instance.conversation.id,
      cwd: instance.cwd,
      workspaceFolderIndex: instance.workspaceFolderIndex
    };
    const others = this.closedTabs.get().filter((other) => other.conversation !== tab.conversation);
    this.closedTabs.set([tab, ...others].slice(0, MAX_CLOSED_TABS));
  }

  /** Opens a tab in a pane, by default the focused one, and shows it there */
  private open({
    pane,
    ...tab
  }: {
    launch: LaunchSpec;
    cwd?: string;
    workspaceFolderIndex?: number;
    session?: SessionRef;
    conversation?: TerminalInstance['conversation'];
    pane?: string;
  }): string {
    const id = this.state.generateId();
    const instance: TerminalInstance = { id, isActive: false, ...tab };

    // Add the instance first so setActive can find it
    this.state.set(id, instance, pane);
    this.recent = [id, ...this.recent];
    this.state.setActive(id);
    this.host.post({ type: 'createTab', id });
    this.refresh();
    this.start(instance);
    this.host.post({ type: 'switchTab', id });
    return id;
  }

  /** Closes a tab without asking; closing the last one opens a new one */
  close(id: string): void {
    const instance = this.state.get(id);
    if (!instance) return;

    this.rememberClosed(instance);
    this.pty.kill(id);
    this.endSession(instance);
    this.prompt.removeTerminal(id);
    this.status.forget(id);
    this.notices.delete(id);
    this.history.delete(id);
    const wasActive = this.state.getActiveId() === id;
    this.state.delete(id);
    this.recent = this.recent.filter((other) => other !== id);
    this.host.post({ type: 'removeTab', id });
    // Before a new tab may ask for its folder
    this.saveOpen();

    // Its pane shows its last tab now, or closed and gave its neighbor focus
    const active = this.state.getActiveId();
    if (this.state.count === 0) {
      void this.create();
    } else if (wasActive && active) {
      this.switchTo(active);
    } else {
      this.scheduleSeen();
      this.refresh();
    }
  }

  switchTo(id: string): void {
    if (!this.state.get(id)) return;
    this.recent = [id, ...this.recent.filter((other) => other !== id)];
    this.state.setActive(id);
    this.scheduleSeen();
    // The layout first, so the webview knows the pane it focuses
    this.refresh();
    this.host.post({ type: 'switchTab', id });
  }

  /** Switches to the tab at a 1-based position in the focused pane; 0 is its last tab */
  switchToPosition(position: number): void {
    const ids = this.state.getPaneTabs();
    const id = position === 0 ? ids[ids.length - 1] : ids[position - 1];
    if (id) {
      this.switchTo(id);
    }
  }

  /**
   * Moves a tab to a 0-based position, e.g. after it was dragged, in its own
   * pane or another; the position is clamped to the tab strip
   */
  move(id: string, index: number, pane?: string): void {
    const from = this.state.getPaneId(id);
    if (!this.state.move(id, index, pane)) return;
    if (pane && pane !== from) this.switchTo(id);
    else this.refresh();
  }

  /**
   * Moves a tab into a new pane above or below a pane, e.g. after it was
   * dropped on the top or bottom of its terminal
   */
  split(id: string, pane: string, side: SplitSide): void {
    if (this.state.split(id, pane, side)) this.switchTo(id);
  }

  /** Gives a pane focus, e.g. after the user clicked into it */
  focusPane(pane: string): void {
    if (this.state.focusPane(pane)) {
      const id = this.state.getActiveId();
      if (id) this.recent = [id, ...this.recent.filter((other) => other !== id)];
      this.refresh();
    }
  }

  /**
   * Focuses the next (1) or previous (-1) pane in reading order, wrapping
   * around, like VS Code's split terminal
   */
  focusNextPane(step: 1 | -1): void {
    const panes = this.state.getPaneIds();
    if (panes.length <= 1) return;
    const index = panes.indexOf(this.state.getFocusedPaneId());
    const pane = panes[(index + step + panes.length) % panes.length];
    const id = this.state.getShownIn(pane);
    if (id) this.switchTo(id);
  }

  /** The sizes of a split's children after the user dragged an edge between them */
  resizeSplit(split: string, sizes: number[]): void {
    if (this.state.resizeSplit(split, sizes)) this.saveOpen();
  }

  /**
   * Moves the active tab one position left or right, or to the start or
   * end, like VS Code's Move Editor Left/Right; it does not wrap around
   */
  moveActive(to: 'left' | 'right' | 'first' | 'last'): void {
    const id = this.state.getActiveId();
    if (!id) return;
    const ids = this.state.getPaneTabs();
    const index = ids.indexOf(id);
    const target = { left: index - 1, right: index + 1, first: 0, last: ids.length - 1 }[to];
    this.move(id, target);
  }

  /** Tab IDs, most recently shown first */
  recentlyUsed(): string[] {
    return [...this.recent];
  }

  /** Switches to the next (1) or previous (-1) tab of the focused pane, wrapping around */
  cycle(step: 1 | -1): void {
    const ids = this.state.getPaneTabs();
    if (ids.length <= 1) return;
    const current = ids.indexOf(this.state.getActiveId() ?? '');
    this.switchTo(ids[(current + step + ids.length) % ids.length]);
  }

  /**
   * Typed input. In an exited tab, Enter restarts and Esc closes. In a
   * detached one, Enter attaches again and Esc closes it and ends its
   * session, after asking, since the program may still be working.
   */
  input(id: string, data: string): void {
    const instance = this.state.get(id);
    if (instance?.detached) {
      if (data === '\r') {
        this.attachAgain(instance);
      } else if (data === '\x1b') {
        this.host.requestClose([id]);
      }
      return;
    }
    if (instance?.exited) {
      if (data === '\r') {
        this.restart(id);
      } else if (data === '\x1b') {
        this.close(id);
      }
      return;
    }
    this.pty.write(id, data);
    // Focus and mouse reports from clicking into the terminal are not answers
    if (isTerminalReport(data)) return;
    if (instance) this.trackDraft(instance, data);

    this.prompt.onUserInput(id);
    // A question is answered with Enter or dismissed with Esc; arrow keys and
    // typing only move within it
    if (instance?.needsInput && (data.includes('\r') || data === '\x1b')) {
      instance.needsInput = false;
      this.refresh();
    }
    // Typing into a tab counts as having seen its result
    if (instance?.unseen && this.isInView(instance)) {
      instance.unseen = undefined;
      this.refresh();
    }
  }

  /**
   * Counts unsent input. Once the agent reported its status, a message
   * counts as sent when it starts working, since Enter may only answer a
   * question or pick an entry. Before that, and with `programStatus` off,
   * Enter sends it. An agent that should report but has not yet, e.g. an
   * older version, gets its conversation marked only by a report, since
   * Enter may answer a dialog before the first message.
   */
  private trackDraft(instance: TerminalInstance, data: string): void {
    if (data !== '\r') {
      instance.draft = typed(instance.draft ?? 0, data);
      return;
    }
    const { programStatus } = this.config.getConfig();
    if (programStatus && instance.reportsStatus) return;
    instance.draft = 0;
    if (programStatus && reportsStatus(instance.launch.agent)) return;
    if (instance.conversation && !instance.conversation.started) {
      instance.conversation.started = true;
      this.conversationStarted(instance);
      this.saveOpen();
    }
  }

  /**
   * Stores in the tab's session that its conversation started, so a window
   * that attaches to it later continues the conversation
   */
  private conversationStarted(instance: TerminalInstance): void {
    const { session, conversation } = instance;
    if (!session || !conversation?.started || session.started) return;
    session.started = true;
    void getMultiplexer(session.multiplexer)
      .updateTag(session.name, this.sessionTag(instance, session))
      .catch(() => {
        session.started = undefined;
      });
  }

  /** What a session stores about its tab */
  private sessionTag(instance: TerminalInstance, session: SessionRef): SessionTag {
    return {
      workspace: this.workspace,
      launch: stored(instance.launch),
      conversation: instance.conversation && { ...instance.conversation },
      cwd: instance.cwd,
      workspaceFolderIndex: instance.workspaceFolderIndex,
      created: session.created
    };
  }

  resize(id: string, cols: number, rows: number): void {
    this.setSize(cols, rows);
    this.pty.resize(id, cols, rows);
  }

  /** The size new processes start with, until the webview reports their own */
  setSize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * A finished or failed run counts as seen once its tab has been in view for
   * a second, so flicking through tabs does not clear it.
   */
  scheduleSeen(): void {
    clearTimeout(this.seenTimer);
    // Every pane's tab is in view, not only the focused pane's
    const instances = this.state
      .getShownIds()
      .flatMap((id) => this.state.get(id) ?? [])
      .filter((instance) => instance.unseen && this.isInView(instance));
    if (instances.length === 0) return;

    this.seenTimer = setTimeout(() => {
      let changed = false;
      for (const instance of instances) {
        if (instance.unseen && this.isInView(instance)) {
          instance.unseen = undefined;
          changed = true;
        }
      }
      if (changed) this.refresh();
    }, SEEN_DELAY_MS);
  }

  updateConfig(): void {
    this.prompt.updateConfig(promptConfig());
  }

  /**
   * Ends all processes and forgets the tabs, e.g. when the webview is
   * destroyed; the next webview sends `ready` and starts cleanly. Sessions
   * keep running, and the next webview attaches to them again.
   */
  reset(): void {
    this.generation++;
    this.restored = undefined;
    clearTimeout(this.seenTimer);
    this.pty.killAll();
    this.disposeTaps();
    this.prompt.dispose();
    this.status.clear();
    this.notices.clear();
    this.history.clear();
    this.clearNoticeTimers();
    this.state.clear();
    this.recent = [];
    this.savedOpen = undefined;
  }

  dispose(): void {
    clearTimeout(this.seenTimer);
    this.clearNoticeTimers();
    this.pty.killAll();
    this.disposeTaps();
    this.prompt.dispose();
  }

  private clearNoticeTimers(): void {
    for (const timer of this.noticeTimers.values()) clearTimeout(timer);
    this.noticeTimers.clear();
  }

  private disposeTaps(): void {
    for (const tap of this.taps.values()) tap.dispose();
    this.taps.clear();
  }

  private isInView(instance: TerminalInstance): boolean {
    return instance.isActive && this.host.isVisible();
  }

  /**
   * Restarts a tab with its own command and working directory, after its
   * process exited (Enter, or `agentTabs.onExit: restart`).
   */
  private restart(id: string): void {
    const instance = this.state.get(id);
    if (!instance) return;
    this.endSession(instance);
    resetStatus(instance);
    // A restart is a new conversation; the previous one can still be reopened
    this.rememberClosed(instance);
    instance.conversation = undefined;
    this.status.forget(id);
    this.refresh();
    this.clear(id);
    this.start(instance);
  }

  /**
   * Starts a tab's process, unless its command or the agent it wraps cannot
   * be found on the PATH the process would get. Then the tab explains that
   * instead of failing with a spawn error.
   */
  private start(instance: TerminalInstance): void {
    const config = this.config.getConfig();
    if (!instance.session && !instance.conversation) {
      const id = newConversation(instance.launch);
      if (id) instance.conversation = { id, started: false };
    }
    this.notices.delete(instance.id);
    const { conversation } = instance;
    const notice = conversation?.started
      ? undefined
      : conversation && startNotice(instance.launch, conversation.id);
    if (notice) this.notices.set(instance.id, new NoticeFilter(notice));
    const searchPath = this.pty.getSearchPath(config, instance.launch);
    const multiplexer = this.multiplexerFor(instance);
    if (multiplexer && !isInstalled(multiplexer.command, searchPath)) {
      this.showNotInstalled(instance, multiplexer.command);
      return;
    }
    // A running session's program was found when it started
    const missing = instance.session ? undefined : missingCommand(instance.launch, searchPath);
    if (missing) {
      this.showNotInstalled(instance, missing);
      return;
    }
    if (multiplexer) {
      void this.startInSession(instance, multiplexer);
      return;
    }
    this.pty.spawn(instance.id, config, runLaunch(instance), this.cols, this.rows, instance.cwd);
  }

  /**
   * The multiplexer a tab runs in: its session's, or for a new run the
   * profile's own or `agentTabs.multiplexer`.
   */
  private multiplexerFor(instance: TerminalInstance): Multiplexer | undefined {
    if (instance.session) return getMultiplexer(instance.session.multiplexer);
    const id = instance.launch.multiplexer ?? this.config.getConfig().multiplexer;
    return id && id !== 'none' ? getMultiplexer(id) : undefined;
  }

  /**
   * Starts the tab's session, or attaches to it when it runs already, and
   * runs the multiplexer's client in the tab.
   */
  private async startInSession(
    instance: TerminalInstance,
    multiplexer: Multiplexer
  ): Promise<void> {
    const config = this.config.getConfig();
    const { id } = instance;
    const launch = runLaunch(instance);
    // A tab that attaches to a session never starts a new one in its place,
    // e.g. when another window ended it meanwhile, which would run the
    // program again
    const attaching = instance.session;
    if (attaching && !(await multiplexer.exists(attaching.name).catch(() => false))) {
      if (this.state.get(id) === instance && instance.session === attaching) {
        this.showSessionGone(instance);
      }
      return;
    }
    instance.session ??= {
      multiplexer: multiplexer.id as MultiplexerId,
      name: sessionName(),
      created: Date.now()
    };
    const session = instance.session;
    const generation = this.generation;
    const tag = this.sessionTag(instance, session);
    // The next window attaches to the session instead of starting a new one
    this.saveOpen();

    let result: Awaited<ReturnType<Multiplexer['open']>>;
    try {
      result = await multiplexer.open(
        {
          session: session.name,
          command: launch.command,
          args: launch.args,
          env: this.pty.sessionEnvironment(config, launch),
          cwd: instance.cwd ?? this.pty.defaultWorkingDirectory(),
          cols: this.cols,
          rows: this.rows,
          tag
        },
        (data) => this.handleTapData(id, data)
      );
    } catch (error) {
      instance.session = undefined;
      this.handleError(id, error instanceof Error ? error.message : String(error));
      return;
    }

    // The tab closed or restarted while the session started. When the
    // view went away instead, the session runs on for the next view.
    if (this.state.get(id) !== instance || instance.session !== session) {
      if ('tap' in result) result.tap?.dispose();
      if (this.state.get(id) !== instance && this.generation === generation) {
        void multiplexer.kill(session.name);
      }
      return;
    }
    if ('exitCode' in result) {
      void this.sessionEnded(instance, result.exitCode, 0);
      return;
    }
    if (result.tap) this.taps.set(id, result.tap);
    // A new session's tag says what the conversation was when it started;
    // a message may have been sent since
    if (result.created && tag.conversation?.started) session.started = true;
    this.conversationStarted(instance);
    this.pty.spawn(id, config, launch, this.cols, this.rows, instance.cwd, result.client);
  }

  /** After a tab's session was detached, Enter attaches the tab again */
  private attachAgain(instance: TerminalInstance): void {
    instance.detached = false;
    this.refresh();
    this.clear(instance.id);
    this.start(instance);
  }

  /** Ends the tab's session and its tap, e.g. when the tab closes */
  private endSession(instance: TerminalInstance): void {
    this.taps.get(instance.id)?.dispose();
    this.taps.delete(instance.id);
    instance.detached = false;
    const { session } = instance;
    if (!session) return;
    instance.session = undefined;
    void getMultiplexer(session.multiplexer).kill(session.name);
  }

  /**
   * A multiplexer client exited: the session's program ended, or the client
   * was only detached, e.g. with tmux's prefix + d, and the program runs on.
   */
  private async clientExited(id: string, exitCode: number, runtimeMs: number): Promise<void> {
    const instance = this.state.get(id);
    const session = instance?.session;
    if (!instance || !session) {
      this.handleExit(id, exitCode, runtimeMs);
      return;
    }
    this.taps.get(id)?.dispose();
    this.taps.delete(id);
    const ended = await getMultiplexer(session.multiplexer)
      .ended(session.name, exitCode)
      .catch(() => exitCode);
    if (this.state.get(id) !== instance || instance.session !== session) return;
    if (ended === undefined) {
      this.showDetached(instance);
      return;
    }
    await this.sessionEnded(instance, ended, runtimeMs);
  }

  private async sessionEnded(
    instance: TerminalInstance,
    exitCode: number,
    runtimeMs: number
  ): Promise<void> {
    this.endSession(instance);
    this.handleExit(instance.id, exitCode, runtimeMs);
  }

  private showDetached(instance: TerminalInstance): void {
    instance.detached = true;
    instance.programState = undefined;
    instance.statusMessage = 'Detached';
    instance.needsInput = false;
    this.prompt.removeTerminal(instance.id);
    this.refresh();
    this.write(
      instance.id,
      `\r\n\x1b[2m[Detached; the session runs on. Press Enter to attach again or Esc to end it and close the tab.]\x1b[0m\r\n`
    );
  }

  /** The tab's session ended elsewhere, e.g. in another window */
  private showSessionGone(instance: TerminalInstance): void {
    this.endSession(instance);
    instance.exited = true;
    instance.programState = undefined;
    instance.statusMessage = undefined;
    instance.needsInput = false;
    this.prompt.removeTerminal(instance.id);
    this.refresh();
    this.write(
      instance.id,
      `\r\n\x1b[2m[The session ended elsewhere. Press Enter to start the profile again or Esc to close.]\x1b[0m\r\n`
    );
  }

  /**
   * Shows in the tab that a command was not found, with the failed status.
   * Enter tries again and Esc closes, like after any exit.
   */
  private showNotInstalled(instance: TerminalInstance, command: string): void {
    const { agent, label } = instance.launch;
    instance.exited = true;
    instance.missing = command;
    instance.statusMessage = `${command} not found`;
    this.refresh();

    const what = agent ? `${label} is not installed` : `"${label}" cannot start`;
    const message = `${what}: \`${command}\` was not found on the PATH.`;
    this.write(
      instance.id,
      `\x1b[1m${message}\x1b[0m\r\n\x1b[2mPress Enter to try again or Esc to close.\x1b[0m\r\n`
    );
    void vscode.window.showErrorMessage(message);
  }

  private write(id: string, data: string): void {
    this.remember(id, data);
    this.host.post({ type: 'output', id, data });
  }

  private clear(id: string): void {
    this.history.delete(id);
    this.host.post({ type: 'clear', id });
  }

  /**
   * Keeps a tab's recent output, cut at a line start so it does not begin
   * inside an escape sequence
   */
  private remember(id: string, data: string): void {
    let history = (this.history.get(id) ?? '') + data;
    if (history.length > HISTORY_CHARS) {
      const kept = history.slice(-HISTORY_CHARS);
      const line = kept.indexOf('\n');
      history = line >= 0 ? kept.slice(line + 1) : kept;
    }
    this.history.set(id, history);
  }

  private handleData(id: string, received: string): void {
    const notice = this.notices.get(id);
    const data = notice ? notice.filter(received) : received;
    if (notice) {
      clearTimeout(this.noticeTimers.get(id));
      if (notice.finished) {
        this.notices.delete(id);
      } else {
        this.noticeTimers.set(
          id,
          setTimeout(() => {
            this.noticeTimers.delete(id);
            if (this.notices.get(id) !== notice) return;
            const held = notice.flush();
            if (held) this.showData(id, held);
          }, NOTICE_FLUSH_MS)
        );
      }
    }
    if (data) this.showData(id, data);
  }

  /** Output that reaches the tab: its signals are read and the view shows it */
  private showData(id: string, data: string): void {
    // With a tap, the client's output is the multiplexer's drawing
    if (!this.taps.has(id)) {
      this.trackSignals(id, data);
    }
    if (this.host.isAttached()) {
      this.write(id, data);
      this.prompt.onData(id, data);
    }
  }

  private handleTapData(id: string, data: string): void {
    this.trackSignals(id, data);
  }

  private trackSignals(id: string, data: string): void {
    const instance = this.state.get(id);
    if (!instance) return;
    const changed = this.status.track(instance, data, {
      programStatus: this.config.getConfig().programStatus,
      inView: this.isInView(instance),
      reply: (reply) => {
        const tap = this.taps.get(id);
        if (tap) tap.reply(reply);
        else this.pty.write(id, reply);
      }
    });
    if (changed) {
      this.conversationStarted(instance);
      this.refresh();
    }
  }

  /**
   * `onExit: auto` closes the tab after a clean exit (e.g. `/exit`) and keeps
   * failed runs open so their output stays readable. A process that dies
   * right after starting keeps its tab with every setting: closing the last
   * tab opens a new one and `restart` starts it again, which would loop.
   */
  private handleExit(id: string, exitCode: number, runtimeMs: number): void {
    const instance = this.state.get(id);
    if (!this.host.isAttached() || !instance) return;

    // A shell or wrapper that could not find the command, e.g. tmux or
    // directMode off; a long-running program may use 127 for its own reasons
    if (exitCode === COMMAND_NOT_FOUND && runtimeMs < 5000) {
      const { launch } = instance;
      this.showNotInstalled(instance, missingCommand(launch) ?? launch.command);
      return;
    }

    const { onExit } = this.config.getConfig();
    const quick = runtimeMs < QUICK_EXIT_MS;
    if (!quick && (onExit === 'close' || (onExit === 'auto' && exitCode === 0))) {
      this.close(id);
      return;
    }
    if (!quick && onExit === 'restart') {
      this.restart(id);
      return;
    }

    instance.exited = true;
    instance.programState = undefined;
    instance.statusMessage = undefined;
    instance.needsInput = false;
    if (exitCode !== 0 && !this.isInView(instance)) {
      instance.unseen = 'error';
    }
    this.prompt.removeTerminal(id);
    this.refresh();
    this.write(
      id,
      `\r\n\x1b[2m[Process exited with code ${String(exitCode)}. Press Enter to restart or Esc to close.]\x1b[0m\r\n`
    );
  }

  /** A failed spawn enters the same retryable state as a normal exit */
  private handleError(id: string, error: string): void {
    const instance = this.state.get(id);
    if (!instance) return;
    instance.exited = true;
    instance.statusMessage = 'Terminal failed to start';
    instance.missing = instance.launch.command || 'terminal';
    this.refresh();
    this.write(
      id,
      `\r\nError starting terminal: ${error}\r\n\x1b[2mPress Enter to retry or Esc to close.\x1b[0m\r\n`
    );
  }
}

/**
 * A launch as it is stored for later, in the workspace state or a session's
 * tag: without its environment, where secrets such as API keys go. The
 * profile it came from gives it again.
 */
function stored(launch: LaunchSpec): LaunchSpec {
  return { ...launch, env: {} };
}

/** A session name that tmux and abduco accept and that is unique per tab */
function sessionName(): string {
  return `agent-tabs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * What a tab runs: its profile, with the arguments that start or continue
 * its conversation
 */
function runLaunch(instance: TerminalInstance): LaunchSpec {
  const { conversation, launch } = instance;
  return conversation ? withConversation(launch, conversation.id, conversation.started) : launch;
}
