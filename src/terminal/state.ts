import { shortTitle } from '../profiles';
import type { TabInfo, TabStatus, TerminalInstance } from '../types';
import { WORKSPACE_ACCENT_COLORS } from '../types';
import { hasDraft } from './draft';

/** Why closing a tab would lose something */
export type CloseRisk = 'working' | 'waiting' | 'draft' | 'session';

const STATUS_LABELS: Record<TabStatus, string> = {
  working: 'Working',
  blocked: 'Needs input',
  done: 'Done',
  error: 'Failed'
};

/** The open tabs, which one is active, and how each is labeled and described */
export class TerminalStateManager {
  private readonly terminals = new Map<string, TerminalInstance>();
  private activeTerminalId: string | undefined;

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
   * Sets a terminal instance.
   */
  set(id: string, instance: TerminalInstance): void {
    this.terminals.set(id, instance);
  }

  /**
   * Deletes a terminal instance.
   */
  delete(id: string): boolean {
    return this.terminals.delete(id);
  }

  /** Clears all terminal instances, used when the webview is recreated. */
  clear(): void {
    this.terminals.clear();
    this.activeTerminalId = undefined;
  }

  /**
   * Gets all terminal instances.
   */
  getAll(): TerminalInstance[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Gets all terminal IDs.
   */
  getAllIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /**
   * Gets the count of terminals.
   */
  get count(): number {
    return this.terminals.size;
  }

  /**
   * Gets the active terminal ID.
   */
  getActiveId(): string | undefined {
    return this.activeTerminalId;
  }

  /** Makes a tab the active one; an unknown ID changes nothing */
  setActive(id: string): void {
    const instance = this.terminals.get(id);
    if (!instance) return;
    const previous = this.activeTerminalId && this.terminals.get(this.activeTerminalId);
    if (previous) previous.isActive = false;
    instance.isActive = true;
    this.activeTerminalId = id;
  }

  /**
   * Clears the active terminal (sets to undefined).
   */
  clearActive(): void {
    this.activeTerminalId = undefined;
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

  /**
   * Gets tab information for all terminals.
   */
  getTabsInfo(autoTitles: boolean, titleWords: number): TabInfo[] {
    return this.getAll().map((t) => ({
      id: t.id,
      label: this.getLabel(t, autoTitles, titleWords),
      description: this.getFullLabel(t, true),
      agent: t.launch.agent,
      isActive: t.isActive,
      accentColor: this.getAccentColor(t.workspaceFolderIndex),
      status: this.getStatus(t),
      statusText: this.describeStatus(t)
    }));
  }

  /**
   * With automatic titles, the shortened terminal title, e.g. `Refactor API
   * client` from Claude Code's conversation summary or a named pi session.
   * Otherwise, or until the program sets a title, the profile's name.
   */
  getLabel(instance: TerminalInstance, autoTitles: boolean, titleWords: number): string {
    const title = autoTitles ? instance.titleLabel : undefined;
    return (title && shortTitle(title, titleWords)) ?? instance.launch.label;
  }

  /** `pi / Refactor the API client`: agent and full title, e.g. for the tab picker */
  getFullLabel(instance: TerminalInstance, autoTitles: boolean): string {
    const title = autoTitles ? instance.titleLabel : undefined;
    return title ? `${instance.launch.label} / ${title}` : instance.launch.label;
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
        instance.programState === 'blocked')
    );
  }

  /**
   * Why closing a tab would lose something: its agent is working, waiting
   * for an answer, or has input that was not sent, or its detached session
   * still runs and would end; undefined when nothing.
   */
  closeRisk(instance: TerminalInstance): CloseRisk | undefined {
    if (instance.detached) return 'session';
    if (this.isBusy(instance)) {
      return instance.programState === 'working' && !instance.needsInput ? 'working' : 'waiting';
    }
    if (!instance.exited && hasDraft(instance.draft)) return 'draft';
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
    if (instance.programState === 'working' || instance.programState === 'blocked') {
      return instance.programState;
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
