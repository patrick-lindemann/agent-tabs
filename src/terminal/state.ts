import { shortTitle, transformTitle } from '../profiles';
import type {
  LayoutInfo,
  SplitSide,
  TabInfo,
  TabStatus,
  TerminalConfig,
  TerminalInstance
} from '../types';
import { WORKSPACE_ACCENT_COLORS } from '../types';
import { type Pane, PaneLayout, type SavedLayout } from './layout';
import { childState } from './status';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.trunc(value), max));
}

/** The settings that decide a tab's label */
export type TitleOptions = Pick<
  TerminalConfig,
  'autoTabTitles' | 'tabTitleWords' | 'transformTabTitles'
>;

/** Why closing a tab would lose something */
export type CloseRisk = 'working' | 'waiting' | 'session';

const STATUS_LABELS: Record<TabStatus, string> = {
  working: 'Working',
  blocked: 'Needs input',
  done: 'Done',
  error: 'Failed'
};

/**
 * The open tabs, the panes they are in, which tab each pane shows and which
 * pane has focus, and how tabs are labeled and described. Panes are split
 * side by side or one above the other, and splits can be split again; see
 * `PaneLayout`. There is always at least one pane; only the last one left
 * may be empty.
 */
export class TerminalStateManager {
  private readonly terminals = new Map<string, TerminalInstance>();
  private layout = new PaneLayout();

  private get focusedPane(): Pane {
    return this.layout.focused;
  }

  /**
   * Generates a unique terminal ID.
   */
  generateId(): string {
    return `terminal-${String(Date.now())}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Gets a terminal instance by ID.
   */
  get(id: string): TerminalInstance | undefined {
    return this.terminals.get(id);
  }

  /**
   * Adds a tab at the end of a pane, by default the focused one. A pane
   * that showed no tab shows it.
   */
  set(id: string, instance: TerminalInstance, paneId?: string): void {
    if (this.terminals.has(id)) {
      this.terminals.set(id, instance);
      return;
    }
    const pane = (paneId && this.pane(paneId)) || this.focusedPane;
    this.terminals.set(id, instance);
    pane.tabs.push(id);
    if (!pane.active) this.show(pane, id);
  }

  /**
   * Removes a tab. Its pane shows its last tab instead, or closes when it
   * was its only tab, unless it is the last pane.
   */
  delete(id: string): boolean {
    if (!this.terminals.delete(id)) return false;
    const pane = this.paneOf(id);
    if (pane) this.takeOut(pane, id);
    return true;
  }

  /**
   * Moves a tab to a 0-based position in a pane's tabs, clamped to the first
   * and last position, by default in its own pane. In another pane it is
   * shown there and that pane gets focus. Returns whether anything changed.
   */
  move(id: string, index: number, paneId?: string): boolean {
    const from = this.paneOf(id);
    const to = paneId ? this.pane(paneId) : from;
    if (!from || !to) return false;
    if (from === to) {
      const tabs = from.tabs;
      const current = tabs.indexOf(id);
      const target = clamp(index, 0, tabs.length - 1);
      if (target === current) return false;
      tabs.splice(current, 1);
      tabs.splice(target, 0, id);
      return true;
    }
    this.takeOut(from, id);
    to.tabs.splice(clamp(index, 0, to.tabs.length), 0, id);
    this.setActive(id);
    return true;
  }

  /**
   * Moves a tab into a new pane on a side of a pane, which shows it and gets
   * focus; the two share the pane's space. A pane's only tab cannot split
   * from itself. Returns the new pane's ID.
   */
  split(id: string, paneId: string, side: SplitSide): string | undefined {
    const from = this.paneOf(id);
    const target = this.pane(paneId);
    if (!from || !target || (from === target && from.tabs.length === 1)) return undefined;
    const pane = this.addPane(paneId, side);
    if (!pane) return undefined;
    this.takeOut(from, id);
    pane.tabs.push(id);
    this.setActive(id);
    return pane.id;
  }

  /**
   * Adds an empty pane on a side of another, which shares its space with
   * it. It must get a tab before anything else happens.
   */
  addPane(paneId: string, side: SplitSide = 'bottom'): Pane | undefined {
    return this.layout.addPane(paneId, side);
  }

  /** Takes a tab out of its pane, which closes when it is left empty */
  private takeOut(pane: Pane, id: string): void {
    const index = pane.tabs.indexOf(id);
    if (index === -1) return;
    pane.tabs.splice(index, 1);
    if (pane.active === id) {
      pane.active = undefined;
      const next = pane.tabs[pane.tabs.length - 1];
      if (next) this.show(pane, next);
    }
    if (pane.tabs.length === 0) this.layout.removePane(pane);
  }

  /** Shows a tab in its pane, without giving the pane focus */
  private show(pane: Pane, id: string): void {
    const previous = pane.active && this.terminals.get(pane.active);
    if (previous) previous.isActive = false;
    const instance = this.terminals.get(id);
    if (instance) instance.isActive = true;
    pane.active = id;
  }

  /** Clears all terminal instances, used when the webview is recreated. */
  clear(): void {
    this.terminals.clear();
    this.layout = new PaneLayout();
  }

  // --- Panes ---

  private pane(id: string): Pane | undefined {
    return this.layout.pane(id);
  }

  private paneOf(id: string): Pane | undefined {
    return this.layout.paneOf(id);
  }

  /** The pane IDs in reading order: left to right, top to bottom */
  getPaneIds(): string[] {
    return this.layout.panes().map((pane) => pane.id);
  }

  getPaneId(tabId: string): string | undefined {
    return this.paneOf(tabId)?.id;
  }

  getFocusedPaneId(): string {
    return this.focusedPane.id;
  }

  /** The tabs of a pane in order, by default the focused one */
  getPaneTabs(paneId?: string): string[] {
    const pane = paneId ? this.pane(paneId) : this.focusedPane;
    return pane ? [...pane.tabs] : [];
  }

  /** The tab each pane shows, in reading order */
  getShownIds(): string[] {
    return this.layout.panes().flatMap((pane) => (pane.active ? [pane.active] : []));
  }

  /** The tab a pane shows */
  getShownIn(paneId: string): string | undefined {
    return this.pane(paneId)?.active;
  }

  /** Gives a pane focus; returns whether it changed */
  focusPane(paneId: string): boolean {
    const pane = this.pane(paneId);
    if (!pane || pane === this.focusedPane) return false;
    this.layout.focused = pane;
    return true;
  }

  /** Sets the sizes of a split's children; ignored unless there is one per child */
  resizeSplit(splitId: string, sizes: number[]): boolean {
    return this.layout.resize(splitId, sizes);
  }

  /** The splits of the layout for the next window; none with one pane */
  saveLayout(): SavedLayout | undefined {
    return this.layout.save();
  }

  /**
   * Before any tab opens, replaces the single pane with a saved layout of
   * `count` panes. Returns the panes' IDs by their saved position, or
   * undefined when the saved layout does not fit.
   */
  restoreLayout(saved: unknown, count: number): string[] | undefined {
    return this.layout.restore(saved, count)?.map((pane) => pane.id);
  }

  /** Removes panes that got no tab, e.g. after restoring sessions that ended */
  prunePanes(): void {
    this.layout.prune();
  }

  /**
   * Gets all terminal instances.
   */
  getAll(): TerminalInstance[] {
    return this.getAllIds().flatMap((id) => this.terminals.get(id) ?? []);
  }

  /** All tab IDs, pane by pane in reading order, each pane's in its order */
  getAllIds(): string[] {
    return this.layout.panes().flatMap((pane) => pane.tabs);
  }

  /**
   * Gets the count of terminals.
   */
  get count(): number {
    return this.terminals.size;
  }

  /** The tab the focused pane shows, which commands act on */
  getActiveId(): string | undefined {
    return this.focusedPane.active;
  }

  /**
   * Shows a tab in its pane and, unless `focus` is false, gives the pane
   * focus; an unknown ID changes nothing
   */
  setActive(id: string, focus = true): void {
    const pane = this.paneOf(id);
    if (!pane) return;
    this.show(pane, id);
    if (focus) this.layout.focused = pane;
  }

  /**
   * Sets the waiting for input state for a terminal.
   */
  setWaitingForInput(id: string, isWaiting: boolean): void {
    const instance = this.terminals.get(id);
    if (instance) {
      instance.isWaitingForInput = isWaiting;
    }
  }

  /** The layout with each pane's tabs, for the webview */
  getLayoutInfo(titles: TitleOptions): LayoutInfo {
    return this.layout.info((pane) => ({
      tabs: this.getTabsInfo(titles, pane.tabs)
    }));
  }

  get paneCount(): number {
    return this.layout.panes().length;
  }

  /** Describes tabs for the webview, by default all of them */
  getTabsInfo(titles: TitleOptions, ids = this.getAllIds()): TabInfo[] {
    const instances = ids.flatMap((id) => this.terminals.get(id) ?? []);
    return instances.map((t) => ({
      id: t.id,
      label: this.getLabel(t, titles),
      description: this.getFullLabel(t, { ...titles, autoTabTitles: true }),
      icon: t.launch.icon ?? t.launch.agent ?? 'sparkle',
      isActive: t.isActive,
      accentColor: this.getAccentColor(t.workspaceFolderIndex),
      status: this.getStatus(t),
      statusText: this.describeStatus(t)
    }));
  }

  /**
   * With automatic titles, the shortened terminal title, e.g. `Refactor API
   * client` from Claude Code's conversation summary or a named pi session,
   * and until the program sets one, the first message sent. Otherwise the
   * profile's name.
   */
  getLabel(instance: TerminalInstance, titles: TitleOptions): string {
    const title = this.getTitle(instance, titles);
    return (title && shortTitle(title, titles.tabTitleWords)) ?? instance.launch.label;
  }

  /** `pi / Refactor the API client`: agent and full title, e.g. for the tab picker */
  getFullLabel(instance: TerminalInstance, titles: TitleOptions): string {
    const title = this.getTitle(instance, titles);
    return title ? `${instance.launch.label} / ${title}` : instance.launch.label;
  }

  private getTitle(instance: TerminalInstance, titles: TitleOptions): string | undefined {
    const title = titles.autoTabTitles ? (instance.titleLabel ?? instance.messageLabel) : undefined;
    return title && titles.transformTabTitles
      ? transformTitle(title, instance.launch.agent)
      : title;
  }

  /** `Needs input: approve Bash`, or undefined when idle */
  describeStatus(instance: TerminalInstance): string | undefined {
    const status = this.getStatus(instance);
    if (!status) return undefined;
    const message = instance.statusMessage;
    return message ? `${STATUS_LABELS[status]}: ${message}` : STATUS_LABELS[status];
  }

  /**
   * Whether the agent is working or waiting for an answer, so closing the tab
   * would interrupt it. Unlike the status, this ignores the prompt detector's
   * guess for programs that do not report their state.
   */
  isBusy(instance: TerminalInstance): boolean {
    return (
      !instance.exited &&
      (instance.needsInput ||
        instance.programState === 'working' ||
        instance.programState === 'blocked' ||
        childState(instance) !== undefined)
    );
  }

  /**
   * Why closing a tab would lose something: its agent is working or waiting
   * for an answer, or its detached session still runs and would end;
   * undefined when nothing.
   */
  closeRisk(instance: TerminalInstance): CloseRisk | undefined {
    if (instance.detached) return 'session';
    if (this.isBusy(instance)) {
      return this.getStatus(instance) === 'blocked' ? 'waiting' : 'working';
    }
    return undefined;
  }

  /**
   * Whether a tab needs the user: blocked on input or finished while unseen.
   */
  needsAttention(instance: TerminalInstance): boolean {
    const status = this.getStatus(instance);
    return status === 'blocked' || status === 'done' || status === 'error';
  }

  /**
   * A question the agent did not report (bell) and reported states win over
   * the unseen marker. Without OSC 7501 reports, the pattern-based prompt
   * detector marks inactive tabs as blocked.
   */
  getStatus(instance: TerminalInstance): TabStatus | undefined {
    if (instance.missing) {
      return 'error';
    }
    if (instance.needsInput) {
      return 'blocked';
    }
    if (instance.programState === 'blocked') {
      return 'blocked';
    }
    // A child record, e.g. a background subagent, keeps the tab working
    // after the program's own turn is done
    const children = childState(instance);
    if (children === 'blocked' || instance.programState === 'working') {
      return children ?? 'working';
    }
    if (children === 'working') {
      return 'working';
    }
    if (instance.unseen) {
      return instance.unseen;
    }
    if (!instance.reportsStatus && instance.isWaitingForInput && !instance.isActive) {
      return 'blocked';
    }
    return undefined;
  }

  /**
   * Returns the accent color for a workspace folder index.
   * Returns undefined for single-folder workspaces (no color accent).
   */
  private getAccentColor(folderIndex: number | undefined): string | undefined {
    if (folderIndex === undefined) {
      return undefined;
    }
    return WORKSPACE_ACCENT_COLORS[folderIndex % WORKSPACE_ACCENT_COLORS.length];
  }
}
