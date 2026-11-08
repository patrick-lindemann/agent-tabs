import * as vscode from 'vscode';
import { ConfigManager } from '../config';
import { confirmClose, manageProfiles, pickProfile, pickTab } from '../dialogs';
import { CommandInputPicker } from '../picker/picker';
import { launchForCommand } from '../profiles';
import { Tabs } from '../terminal/tabs';
import type { ExtensionMessage, LaunchSpec, TerminalInstance } from '../types';
import { openFile } from './files';
import { renderHtml } from './html';
import { dispatchMessage, type MessageHandlerContext } from './messages';

/**
 * The terminal view in the secondary sidebar: connects the webview to the
 * tabs and implements the commands that need the user.
 */
export class ViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext {
  private view?: vscode.WebviewView;
  private disposed = false;

  private readonly config = new ConfigManager();
  private readonly picker = new CommandInputPicker();
  private readonly tabs: Tabs;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.tabs = new Tabs(this.config, {
      post: (message) => this.post(message),
      refresh: () => this.refresh(),
      isVisible: () => this.view?.visible === true,
      isAttached: () => !this.disposed && this.view !== undefined
    });

    void this.config.migrateProfiles().catch((error: unknown) => {
      console.error('SideMates: could not convert agentTerminal.profiles', error);
    });

    // Pre-load help for the custom command picker (missing commands are handled gracefully)
    const profileCommands = this.config.getConfig().profiles.map((p) => p.command);
    this.picker.preloadCommands([
      ...new Set([...profileCommands, 'gemini', 'aider', 'gh', 'interpreter', 'opencode'])
    ]);
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

  handleReady(cols: number, rows: number): void {
    this.tabs.setSize(cols, rows);
    void this.createTerminal();
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
   * reports focus itself and the `agentTerminal.focused` context key scopes
   * the tab keybindings, e.g. so Cmd+W closes a tab instead of the editor.
   */
  handleFocus(focused: boolean): void {
    void vscode.commands.executeCommand('setContext', 'agentTerminal.focused', focused);
  }

  handleNewTab(): void {
    void this.createTerminal();
  }

  handleNewTabWithProfile(): void {
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

  handleOpenFile(id: string, path: string, line?: number, column?: number): void {
    void openFile(path, this.tabs.state.get(id)?.cwd, line, column);
  }

  // --- Commands ---

  createTerminal(launch?: LaunchSpec): Promise<string> {
    return this.tabs.create(launch);
  }

  async pickProfileAndCreateTerminal(): Promise<void> {
    const config = this.config.getConfig();
    const choice = await pickProfile(
      config.profiles,
      config.monochromeIcons,
      (profile) => this.tabs.pty.getSearchPath(config, profile),
      this.extensionUri
    );
    if (choice === 'custom') {
      await this.promptAndCreateTerminal();
    } else if (choice === 'manage') {
      await this.manageProfiles();
    } else if (choice) {
      await this.createTerminal(choice.profile);
    }
  }

  manageProfiles(): Promise<void> {
    return manageProfiles(this.config.getConfig().profiles);
  }

  async promptAndCreateTerminal(): Promise<void> {
    const config = this.config.getConfig();
    const result = await this.picker.promptForCommand(config.profiles[0].command);
    if (!result.cancelled && result.command) {
      await this.createTerminal(
        launchForCommand(result.command, result.args, config.programStatus)
      );
    }
  }

  /** Quick pick over the open tabs with their status, for switching without the tab strip */
  async pickTerminal(): Promise<void> {
    const { state } = this.tabs;
    const { autoTabTitles } = this.config.getConfig();
    const id = await pickTab(
      state.getAll().map((instance) => ({
        id: instance.id,
        label: state.getFullLabel(instance, autoTabTitles),
        description: instance.isActive ? 'active' : undefined,
        detail: state.describeStatus(instance)
      }))
    );
    if (id) {
      this.tabs.switchTo(id);
      await this.focusView();
    }
  }

  /**
   * Closes tabs the user asked to close. Closing ends the agent's process, so
   * tabs whose agent is working or waiting for an answer ask first, unless
   * `agentTerminal.confirmClose` is off.
   */
  async requestClose(ids: string[]): Promise<boolean> {
    const { state } = this.tabs;
    const { confirmClose: confirm, autoTabTitles, tabTitleWords } = this.config.getConfig();
    const busy = ids
      .map((id) => state.get(id))
      .filter(
        (instance): instance is TerminalInstance => instance !== undefined && state.isBusy(instance)
      );

    if (busy.length > 0 && confirm) {
      const confirmed = await confirmClose(
        busy.map((instance) => ({
          label: state.getLabel(instance, autoTabTitles, tabTitleWords),
          agent: instance.launch.label,
          working: state.getStatus(instance) === 'working'
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

  async closeOtherTerminals(id: string): Promise<void> {
    const others = this.tabs.state.getAllIds().filter((other) => other !== id);
    if (await this.requestClose(others)) {
      this.tabs.switchTo(id);
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
    await vscode.commands.executeCommand('agentTerminal.terminalView.focus');
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
    const tabs = state.getTabsInfo(autoTabTitles, tabTitleWords);
    this.post({ type: 'tabsUpdate', tabs, statusColors, monochromeIcons });

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
