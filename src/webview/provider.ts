import * as vscode from 'vscode';
import { ConfigManager } from '../config';
import { confirmClose, discoverProfiles, manageProfiles, pickProfile, pickTab } from '../dialogs';
import { CommandInputPicker } from '../picker/picker';
import { launchForCommand } from '../profiles';
import { Tabs } from '../terminal/tabs';
import type {
  ClosedTab,
  ExtensionMessage,
  LaunchSpec,
  OpenTab,
  SplitSide,
  TerminalInstance
} from '../types';
import { openFile } from './files';
import { renderHtml } from './html';
import { dispatchMessage, type MessageHandlerContext } from './messages';

/** Workspace state key of the closed tabs that can be reopened */
const CLOSED_TABS_KEY = 'agentTabs.closedTabs';

/** Workspace state key of the open tabs, which the next window opens again */
const OPEN_TABS_KEY = 'agentTabs.openTabs';

/** Workspace state key of the splits of the open tabs' panes */
const LAYOUT_KEY = 'agentTabs.layout';

/**
 * Identifies the workspace in the tags of its multiplexer sessions: the
 * paths of its workspace file or folders on the machine the extension runs
 * on, which stay the same whichever computer connects to a remote.
 */
function workspaceKey(): string {
  const file = vscode.workspace.workspaceFile;
  if (file && file.scheme !== 'untitled') return file.fsPath;
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).join('\n');
}

/**
 * The terminal view in the secondary sidebar: connects the webview to the
 * tabs and implements the commands that need the user.
 */
export class ViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext {
  private view?: vscode.WebviewView;
  private disposed = false;
  /** There is more than one pane, as last told to the `agentTabs.split` context key */
  private split = false;

  private readonly config = new ConfigManager();
  private readonly picker = new CommandInputPicker();
  private readonly tabs: Tabs;

  constructor(
    private readonly extensionUri: vscode.Uri,
    workspaceState?: vscode.Memento,
    /** Keeps the user's choice not to be warned before Discover Profiles */
    private readonly globalState?: vscode.Memento
  ) {
    this.tabs = new Tabs(
      this.config,
      {
        post: (message) => this.post(message),
        refresh: () => this.refresh(),
        isVisible: () => this.view?.visible === true,
        isAttached: () => !this.disposed && this.view !== undefined,
        requestClose: (ids) => void this.requestClose(ids)
      },
      workspaceKey(),
      workspaceState && {
        get: () => workspaceState.get<ClosedTab[]>(CLOSED_TABS_KEY, []),
        set: (tabs) => void workspaceState.update(CLOSED_TABS_KEY, tabs)
      },
      workspaceState && {
        get: () => workspaceState.get<OpenTab[]>(OPEN_TABS_KEY, []),
        set: (tabs) => void workspaceState.update(OPEN_TABS_KEY, tabs),
        getLayout: () => workspaceState.get<unknown>(LAYOUT_KEY),
        setLayout: (layout) => void workspaceState.update(LAYOUT_KEY, layout)
      }
    );
  }

  // --- WebviewViewProvider ---

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = renderHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((message: unknown) => {
      dispatchMessage(message, this);
    });
    view.onDidChangeVisibility(() => {
      if (!view.visible) {
        this.handleFocus(false);
      }
      this.tabs.scheduleSeen();
    });
    view.onDidDispose(() => {
      this.handleFocus(false);
      // The processes go with the webview; keep no tabs that refer to them
      this.tabs.reset();
      this.view = undefined;
    });
  }

  // --- Messages from the webview ---

  /**
   * Restores the tabs of the last window or opens the first one; a webview
   * that loaded again gets the tabs that are open
   */
  handleReady(cols: number, rows: number): void {
    this.tabs.setSize(cols, rows);
    this.postAppearance();
    void this.tabs.attachView();
  }

  /** The terminal font of VS Code's own terminal, for the webview */
  private postAppearance(): void {
    const terminal = vscode.workspace.getConfiguration('terminal.integrated');
    const editor = vscode.workspace.getConfiguration('editor');
    const fontSize = terminal.get<number>('fontSize') || editor.get<number>('fontSize') || 12;
    const lineHeight = terminal.get<number>('lineHeight') || 1.2;
    this.post({
      type: 'appearance',
      fontSize,
      fontFamily: terminal.get<string>('fontFamily') || undefined,
      // VS Code reads values of 8 and more as pixels
      lineHeight: lineHeight >= 8 ? lineHeight / fontSize : lineHeight
    });
  }

  /** The terminal or editor font changed */
  updateAppearance(): void {
    this.postAppearance();
  }

  handleInput(id: string, data: string): void {
    this.tabs.input(id, data);
  }

  handleResize(id: string, cols: number, rows: number): void {
    this.tabs.resize(id, cols, rows);
  }

  /**
   * VS Code renders a webview view as an overlay outside the view's element,
   * so `focusedView` is not set while the terminal has focus. The webview
   * reports focus itself and the `agentTabs.focused` context key scopes
   * the tab keybindings, e.g. so Cmd+W closes a tab instead of the editor.
   */
  handleFocus(focused: boolean): void {
    void vscode.commands.executeCommand('setContext', 'agentTabs.focused', focused);
  }

  /** The + of a pane's tab strip, which opens the tab in that pane */
  handleNewTab(pane?: string): void {
    if (pane) this.tabs.focusPane(pane);
    void this.createTerminal();
  }

  handleNewTabWithProfile(pane?: string): void {
    if (pane) this.tabs.focusPane(pane);
    void this.pickProfileAndCreateTerminal();
  }

  handleNewTabWithCommand(): void {
    void this.promptAndCreateTerminal();
  }

  handleCloseTab(id: string): void {
    void this.requestClose([id]);
  }

  handleSwitchTab(id: string): void {
    this.tabs.switchTo(id);
  }

  handleMoveTab(id: string, index: number, pane?: string): void {
    this.tabs.move(id, index, pane);
  }

  handleSplitTab(id: string, pane: string, side: SplitSide): void {
    this.tabs.split(id, pane, side);
  }

  handleFocusPane(pane: string): void {
    this.tabs.focusPane(pane);
  }

  handleResizeSplit(split: string, sizes: number[]): void {
    this.tabs.resizeSplit(split, sizes);
  }

  handleOpenFile(id: string, path: string, line?: number, column?: number): void {
    void openFile(path, this.tabs.state.get(id)?.cwd, line, column);
  }

  /** A web link clicked in a terminal; webviews cannot open windows themselves */
  handleOpenLink(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  // --- Commands ---

  createTerminal(launch?: LaunchSpec): Promise<string | undefined> {
    return this.tabs.create(launch);
  }

  /**
   * Opens the first profile in a new pane below the focused one, like Split
   * Terminal does in a sidebar, or with `side` to its right
   */
  splitTerminal(side: 'bottom' | 'right' = 'bottom'): Promise<string | undefined> {
    return this.tabs.create(undefined, side);
  }

  /** Focuses the next (1) or previous (-1) pane */
  focusNextPane(step: 1 | -1): void {
    this.tabs.focusNextPane(step);
  }

  async pickProfileAndCreateTerminal(): Promise<void> {
    const config = this.config.getConfig();
    const choice = await pickProfile(
      config.profiles,
      config.defaultProfile,
      config.monochromeIcons,
      (profile) => this.tabs.pty.getSearchPath(config, profile),
      this.extensionUri
    );
    if (choice === 'custom') {
      await this.promptAndCreateTerminal();
    } else if (choice === 'manage') {
      await this.manageProfiles();
    } else if (choice === 'discover') {
      await this.discoverProfiles();
    } else if (choice) {
      await this.createTerminal(choice.profile);
    }
  }

  manageProfiles(): Promise<void> {
    return manageProfiles(this.config.getConfig().profiles);
  }

  /** Adds profiles for installed agents that have none, after a warning */
  async discoverProfiles(): Promise<void> {
    if (!this.globalState) return;
    const config = this.config.getConfig();
    await discoverProfiles(
      config.profiles,
      (profile) => this.tabs.pty.getSearchPath(config, profile),
      this.globalState
    );
  }

  async promptAndCreateTerminal(): Promise<void> {
    const config = this.config.getConfig();
    // The default profile's whole command line, e.g. `env A=1 pi`
    const result = await this.picker.promptForCommand(config.defaultProfile.commandLine);
    if (!result.cancelled && result.command) {
      await this.createTerminal(
        launchForCommand(result.command, result.args, config.programStatus)
      );
    }
  }

  /**
   * Quick pick over the open tabs with their status, most recently used
   * first, for switching without the tab strip. `step` 1 selects the
   * previously used tab, -1 the least recently used.
   */
  async pickTerminal(step: 1 | -1 = 1): Promise<void> {
    const { state } = this.tabs;
    const { autoTabTitles } = this.config.getConfig();
    const instances = this.tabs
      .recentlyUsed()
      .map((id) => state.get(id))
      .filter((instance): instance is TerminalInstance => instance !== undefined);
    const id = await pickTab(
      instances.map((instance) => ({
        id: instance.id,
        label: state.getFullLabel(instance, autoTabTitles),
        description: instance.isActive ? 'active' : undefined,
        detail: state.describeStatus(instance)
      })),
      step
    );
    if (id) {
      this.tabs.switchTo(id);
      await this.focusView();
    }
  }

  /**
   * Closes tabs the user asked to close. Closing ends the agent's process, so
   * tabs whose agent is working or waiting for an answer, or whose detached
   * session still runs, ask first, unless `agentTabs.confirmClose` is off.
   */
  async requestClose(ids: string[]): Promise<boolean> {
    const { state } = this.tabs;
    const { confirmClose: confirm, autoTabTitles, tabTitleWords } = this.config.getConfig();
    const busy = ids
      .map((id) => state.get(id))
      .filter((instance): instance is TerminalInstance => instance !== undefined)
      .map((instance) => ({ instance, reason: state.closeRisk(instance) }))
      .filter((entry) => entry.reason !== undefined);

    if (busy.length > 0 && confirm) {
      const confirmed = await confirmClose(
        busy.map(({ instance, reason }) => ({
          label: state.getLabel(instance, autoTabTitles, tabTitleWords),
          agent: instance.launch.label,
          reason: reason as NonNullable<typeof reason>
        }))
      );
      // The dialog took focus; the webview focuses the active tab again
      void this.focusView();
      if (!confirmed) return false;
    }
    for (const id of ids) {
      this.tabs.close(id);
    }
    return true;
  }

  /** Closes the other tabs of the tab's pane, like Close Others in an editor group */
  async closeOtherTerminals(id: string): Promise<void> {
    const { state } = this.tabs;
    const pane = state.getPaneId(id);
    if (!pane) return;
    const others = state.getPaneTabs(pane).filter((other) => other !== id);
    if (await this.requestClose(others)) {
      this.tabs.switchTo(id);
    }
  }

  /** Reopens the most recently closed tab with its conversation */
  reopenClosedTerminal(): void {
    if (!this.tabs.reopenClosed()) {
      void vscode.window.showInformationMessage(
        'Agent Tabs: no closed tab to reopen. Tabs of Claude Code, pi and Cursor can be reopened once a message was sent.'
      );
    }
  }

  closeActiveTerminal(): void {
    const activeId = this.tabs.state.getActiveId();
    if (activeId) {
      void this.requestClose([activeId]);
    }
  }

  switchToTerminalAt(position: number): void {
    this.tabs.switchToPosition(position);
  }

  /** Moves the active tab left or right, or to the start or end of the strip */
  moveActiveTerminal(to: 'left' | 'right' | 'first' | 'last'): void {
    this.tabs.moveActive(to);
  }

  switchToNextTerminal(): void {
    this.tabs.cycle(1);
  }

  switchToPreviousTerminal(): void {
    this.tabs.cycle(-1);
  }

  updateConfig(): void {
    this.config.invalidateCache();
    this.tabs.updateConfig();
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.tabs.dispose();
    this.config.dispose();
    this.picker.dispose();
  }

  // --- Helpers ---

  private async focusView(): Promise<void> {
    await vscode.commands.executeCommand('agentTabs.terminalView.focus');
  }

  private post(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message);
  }

  /**
   * Sends the tab list to the webview. The badge on the view's icon counts
   * tabs that need the user.
   */
  private refresh(): void {
    const { state } = this.tabs;
    const { autoTabTitles, tabTitleWords, statusColors, monochromeIcons } = this.config.getConfig();
    const layout = state.getLayoutInfo(autoTabTitles, tabTitleWords);
    this.post({ type: 'tabsUpdate', layout, statusColors, monochromeIcons });
    // Scopes the pane keybindings, like VS Code's terminal while it is split
    const split = state.paneCount > 1;
    if (split !== this.split) {
      this.split = split;
      void vscode.commands.executeCommand('setContext', 'agentTabs.split', split);
    }

    if (this.view) {
      const count = state.getAll().filter((tab) => state.needsAttention(tab)).length;
      this.view.badge =
        count > 0
          ? {
              value: count,
              tooltip:
                count === 1
                  ? '1 terminal needs attention'
                  : `${String(count)} terminals need attention`
            }
          : undefined;
    }
  }
}
