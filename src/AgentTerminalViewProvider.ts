import * as vscode from 'vscode';
import { CommandInputPicker } from './commandInputPicker';
import { ConfigManager } from './configManager';
import { dispatchMessage, type MessageHandlerContext } from './messageHandlers';
import { labelFromTitle, launchForCommand, missingCommand } from './profiles';
import { PromptDetector, type PromptDetectorConfig } from './promptDetector';
import { type PtyEventCallbacks, PtyManager } from './ptyManager';
import {
  isTerminalReport,
  PROGRAM_STATUS_REPLY,
  type ProgramStatusReport,
  TerminalSignalParser,
  type TerminalSignals
} from './terminalSignals';
import { TerminalStateManager } from './terminalStateManager';
import type { AgentId, ExtensionMessage, LaunchSpec, TerminalInstance } from './types';

/** Agents whose logo has brand colors; the others are drawn in the text color */
const BRAND_COLORED = new Set<AgentId>(['claude', 'antigravity', 'gemini', 'pi', 'devin']);

/** Exit code of a shell or wrapper that could not find a command */
const COMMAND_NOT_FOUND = 127;

/** How long a tab must stay in view before its result counts as seen */
const SEEN_DELAY_MS = 1000;

function isAbsoluteFilePath(filePath: string): boolean {
  return (
    filePath.startsWith('/') || filePath.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(filePath)
  );
}

export class AgentTerminalViewProvider
  implements vscode.WebviewViewProvider, MessageHandlerContext
{
  private view?: vscode.WebviewView;
  private disposed = false;
  private lastCols = 80;
  private lastRows = 24;

  private readonly configManager = new ConfigManager();
  private readonly stateManager = new TerminalStateManager();
  private readonly ptyManager: PtyManager;
  private readonly commandPicker = new CommandInputPicker();
  private readonly promptDetector: PromptDetector;
  private readonly signalParsers = new Map<string, TerminalSignalParser>();
  private seenTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    const callbacks: PtyEventCallbacks = {
      onData: this.handlePtyData.bind(this),
      onExit: this.handlePtyExit.bind(this),
      onError: this.handlePtyError.bind(this)
    };
    this.ptyManager = new PtyManager(callbacks);

    // Initialize prompt detector for input waiting notifications
    this.promptDetector = new PromptDetector(
      this.getPromptDetectorConfig(),
      this.handleNotificationChange.bind(this)
    );

    void this.configManager.migrateProfiles().catch((error: unknown) => {
      console.error('SideMates: could not convert agentTerminal.profiles', error);
    });

    // Pre-load help for the custom command picker (missing commands are handled gracefully)
    const profileCommands = this.configManager.getConfig().profiles.map((p) => p.command);
    this.commandPicker.preloadCommands([
      ...new Set([...profileCommands, 'gemini', 'aider', 'gh', 'interpreter', 'opencode'])
    ]);
  }

  // --- MessageHandlerContext Implementation ---

  handleReady(cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    void this.createTerminal();
  }

  handleInput(id: string, data: string): void {
    if (this.stateManager.get(id)?.exited) {
      if (data === '\r') {
        this.restartTerminal(id);
      } else if (data === '\x1b') {
        this.closeTerminal(id);
      }
      return;
    }
    this.ptyManager.write(id, data);
    // Focus and mouse reports from clicking into the terminal are not answers
    if (isTerminalReport(data)) return;

    this.promptDetector.onUserInput(id);
    // A question is answered with Enter or dismissed with Esc; arrow keys and
    // typing only move within it
    const instance = this.stateManager.get(id);
    if (instance?.needsInput && (data.includes('\r') || data === '\x1b')) {
      instance.needsInput = false;
      this.sendTabsUpdate();
    }
    this.markSeen(id);
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

  handleResize(id: string, cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    this.ptyManager.resize(id, cols, rows);
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
    this.switchToTerminal(id);
  }

  handleOpenFile(id: string, path: string, line?: number, column?: number): void {
    const instance = this.stateManager.get(id);
    const cwd = instance?.cwd;
    void this.openFileInEditor(path, cwd, line, column);
  }

  private async openFileInEditor(
    filePath: string,
    terminalCwd?: string,
    line?: number,
    column?: number
  ): Promise<void> {
    try {
      // Expand tilde to home directory
      let resolvedPath = filePath;
      if (resolvedPath.startsWith('~/')) {
        const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
        resolvedPath = resolvedPath.replace('~', homeDir);
      }

      // Resolve relative paths using terminal's cwd or workspace folder
      let uri: vscode.Uri;
      if (isAbsoluteFilePath(resolvedPath)) {
        // Absolute path
        uri = vscode.Uri.file(resolvedPath);
      } else if (terminalCwd) {
        // Relative path - resolve from terminal's working directory
        uri = vscode.Uri.file(`${terminalCwd}/${resolvedPath}`);
      } else {
        // Fallback to workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          uri = vscode.Uri.joinPath(workspaceFolders[0].uri, resolvedPath);
        } else {
          uri = vscode.Uri.file(resolvedPath);
        }
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      // Navigate to line/column if specified
      if (line !== undefined && line > 0) {
        const position = new vscode.Position(
          line - 1,
          column !== undefined && column > 0 ? column - 1 : 0
        );
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      // Log error for debugging but don't show disruptive notifications
      console.warn(`[SideMates] Failed to open file: ${filePath}`, error);
    }
  }

  // --- PTY Event Handlers ---

  private handlePtyData(terminalId: string, data: string): void {
    this.trackSignals(terminalId, data);
    if (!this.disposed && this.view) {
      this.postMessage({ type: 'output', id: terminalId, data });
      this.promptDetector.onData(terminalId, data);
    }
  }

  /**
   * `onExit: auto` closes the tab after a clean exit (e.g. `/exit`) and keeps
   * failed runs open so their output stays readable. `restart` falls back to
   * the prompt when the process dies right after starting, to avoid a loop.
   */
  private handlePtyExit(terminalId: string, exitCode: number, runtimeMs: number): void {
    const instance = this.stateManager.get(terminalId);
    if (this.disposed || !this.view || !instance) return;

    // A shell or wrapper that could not find the command, e.g. tmux or
    // directMode off; a long-running program may use 127 for its own reasons
    if (exitCode === COMMAND_NOT_FOUND && runtimeMs < 5000) {
      const { launch } = instance;
      this.showNotInstalled(instance, missingCommand(launch) ?? launch.command);
      return;
    }

    const { onExit } = this.configManager.getConfig();
    if (onExit === 'close' || (onExit === 'auto' && exitCode === 0)) {
      this.closeTerminal(terminalId);
      return;
    }
    if (onExit === 'restart' && runtimeMs >= 3000) {
      this.restartTerminal(terminalId);
      return;
    }

    instance.exited = true;
    instance.programState = undefined;
    instance.needsInput = false;
    if (exitCode !== 0 && !this.isInView(instance)) {
      instance.unseen = 'error';
    }
    this.promptDetector.removeTerminal(terminalId);
    this.sendTabsUpdate();
    this.postMessage({
      type: 'output',
      id: terminalId,
      data: `\r\n\x1b[2m[Process exited with code ${String(exitCode)}. Press Enter to restart or Esc to close.]\x1b[0m\r\n`
    });
  }

  /**
   * Reads status reports, titles, notifications and the bell from the
   * program's output and answers OSC 7501 support queries.
   */
  private trackSignals(terminalId: string, data: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;

    let parser = this.signalParsers.get(terminalId);
    if (!parser) {
      parser = new TerminalSignalParser();
      this.signalParsers.set(terminalId, parser);
    }
    const signals = parser.scan(data);

    let changed = false;
    if (signals.title !== undefined) {
      const label = labelFromTitle(signals.title, instance.launch);
      if (label !== instance.titleLabel) {
        instance.titleLabel = label;
        changed = true;
      }
    }
    if (this.configManager.getConfig().programStatus) {
      changed = this.applyStatusSignals(instance, signals) || changed;
    }
    if (changed) {
      this.sendTabsUpdate();
    }
  }

  /**
   * - OSC 7501 reports set the tab status. A finished run in a tab that is
   *   not in view stays marked until the tab is shown.
   * - A bell while working means a dialog asks something the agent did not
   *   report, e.g. pi's ask_user_question tool. It counts as blocked until
   *   the user types or the agent reports again.
   * - Codex reports `working` then `idle` instead of `done`. With the
   *   profile's options it writes an OSC 9 notification first when the turn
   *   completed, so idle after a notification is done, a bare idle is a
   *   cancel. A plan prompt notification asks for input instead.
   */
  private applyStatusSignals(instance: TerminalInstance, signals: TerminalSignals): boolean {
    for (let i = 0; i < signals.queries; i++) {
      this.ptyManager.write(instance.id, PROGRAM_STATUS_REPLY);
    }

    let changed = false;
    if (signals.notifications.length > 0) {
      instance.lastNotification = signals.notifications[signals.notifications.length - 1];
    }
    for (const report of signals.reports) {
      this.applyProgramStatus(instance, report);
      changed = true;
    }
    if (signals.bell && instance.programState === 'working' && !instance.needsInput) {
      instance.needsInput = true;
      changed = true;
    }
    return changed;
  }

  private applyProgramStatus(instance: TerminalInstance, report: ProgramStatusReport): void {
    const previous = instance.programState;
    const notification = instance.lastNotification;
    instance.reportsStatus = true;
    instance.needsInput = false;

    if (report.state === 'clear') {
      instance.programState = undefined;
      instance.statusMessage = undefined;
      return;
    }

    instance.programState = report.state;
    instance.statusMessage = report.message;

    if (report.state === 'working') {
      instance.unseen = undefined;
      instance.lastNotification = undefined;
      return;
    }
    if (report.state === 'blocked' && !report.message && notification) {
      instance.statusMessage = notification;
    }
    if (report.state === 'idle' && previous === 'working') {
      instance.lastNotification = undefined;
      if (notification?.startsWith('Plan mode prompt')) {
        instance.needsInput = true;
        instance.statusMessage = notification;
        return;
      }
      const finished = instance.launch.agent !== 'codex' || notification !== undefined;
      if (finished && !this.isInView(instance)) {
        instance.unseen = 'done';
      }
      return;
    }
    if ((report.state === 'done' || report.state === 'error') && !this.isInView(instance)) {
      instance.unseen = report.state;
    }
  }

  private isInView(instance: TerminalInstance): boolean {
    return instance.isActive && this.view?.visible === true;
  }

  /** Typing into a tab counts as having seen its result */
  private markSeen(terminalId: string): void {
    const instance = this.stateManager.get(terminalId);
    if (instance?.unseen && this.isInView(instance)) {
      instance.unseen = undefined;
      this.sendTabsUpdate();
    }
  }

  /**
   * A finished or failed run counts as seen once its tab has been in view for
   * a second, so flicking through tabs does not clear it.
   */
  private scheduleSeen(): void {
    clearTimeout(this.seenTimer);
    const activeId = this.stateManager.getActiveId();
    const instance = activeId ? this.stateManager.get(activeId) : undefined;
    if (!instance?.unseen || !this.isInView(instance)) return;

    this.seenTimer = setTimeout(() => {
      if (instance.unseen && this.isInView(instance)) {
        instance.unseen = undefined;
        this.sendTabsUpdate();
      }
    }, SEEN_DELAY_MS);
  }

  private handlePtyError(terminalId: string, error: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;
    // A failed spawn has no PTY to restart, but the tab must still enter the
    // same retryable state as a normal process exit.
    instance.exited = true;
    instance.statusMessage = 'Terminal failed to start';
    instance.missing = instance.launch.command || 'terminal';
    this.sendTabsUpdate();
    this.postMessage({
      type: 'output',
      id: terminalId,
      data: `\r\nError starting terminal: ${error}\r\n\x1b[2mPress Enter to retry or Esc to close.\x1b[0m\r\n`
    });
  }

  // --- WebviewViewProvider Implementation ---

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      dispatchMessage(message, this);
    });

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        this.handleFocus(false);
      }
      this.scheduleSeen();
    });

    webviewView.onDidDispose(() => {
      this.handleFocus(false);
      this.ptyManager.killAll();
      // PTYs are destroyed with the webview. Keep no stale tabs that refer to
      // those processes; the next webview sends `ready` and starts cleanly.
      this.promptDetector.dispose();
      this.signalParsers.clear();
      this.stateManager.clear();
      this.view = undefined;
    });
  }

  // --- Terminal Management (Public API) ---

  /**
   * Opens a tab. Without a launch it runs the first profile.
   */
  public async createTerminal(launch?: LaunchSpec): Promise<string> {
    const config = this.configManager.getConfig();
    const id = this.stateManager.generateId();

    // Select working directory first to get folder index
    const { path: cwd, folderIndex } = await this.ptyManager.selectWorkingDirectory();

    const instance: TerminalInstance = {
      id,
      isActive: false,
      workspaceFolderIndex: folderIndex,
      cwd,
      launch: launch ?? config.profiles[0]
    };

    // Add instance first, then activate (so setActive can find it)
    this.stateManager.set(id, instance);
    this.stateManager.setActive(id);

    this.postMessage({ type: 'createTab', id });
    this.sendTabsUpdate();

    this.startProcess(instance);

    // Switch to the new tab
    this.postMessage({ type: 'switchTab', id });

    return id;
  }

  /**
   * Use Profile…: the profiles in their configured order with their logos and
   * Custom Command, then Manage Profiles. VS Code's native view menus
   * cannot follow a setting's order or list user-defined profiles.
   */
  public async pickProfileAndCreateTerminal(): Promise<void> {
    const config = this.configManager.getConfig();
    const { profiles, monochromeIcons } = config;
    type Item = vscode.QuickPickItem & { profile?: LaunchSpec; action?: () => Promise<void> };
    const items: Item[] = [
      ...profiles.map((profile, index) => ({
        label: profile.label,
        description: [
          profile.commandLine,
          index === 0 ? '(default)' : undefined,
          missingCommand(profile, this.ptyManager.getSearchPath(config, profile))
            ? '· not installed'
            : undefined
        ]
          .filter(Boolean)
          .join(' '),
        iconPath: this.getProfileIcon(profile, monochromeIcons),
        profile
      })),
      {
        label: 'Custom Command',
        iconPath: new vscode.ThemeIcon('terminal'),
        action: () => this.promptAndCreateTerminal()
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: 'Manage Profiles', action: () => this.manageProfiles() }
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Open a new tab with',
      matchOnDescription: true
    });
    if (picked?.profile) {
      await this.createTerminal(picked.profile);
    } else {
      await picked?.action?.();
    }
  }

  /**
   * Opens `agentTerminal.profiles` in the Settings editor. Without own
   * profiles, the ones in use are written first, so there is something to
   * edit.
   */
  public async manageProfiles(): Promise<void> {
    const config = vscode.workspace.getConfiguration('agentTerminal');
    const inspected = config.inspect<Record<string, string>>('profiles');
    const isSet = [
      inspected?.globalValue,
      inspected?.workspaceValue,
      inspected?.workspaceFolderValue
    ].some((value) => value !== undefined && Object.keys(value).length > 0);
    if (!isSet) {
      const { profiles } = this.configManager.getConfig();
      await config.update(
        'profiles',
        Object.fromEntries(profiles.map((profile) => [profile.label, profile.commandLine])),
        vscode.ConfigurationTarget.Global
      );
    }
    await vscode.commands.executeCommand('workbench.action.openSettings', 'agentTerminal.profiles');
  }

  /**
   * The agent's logo; in its brand colors unless `agentTerminal.monochromeIcons`
   * is set. Logos without brand colors follow the theme.
   */
  private getProfileIcon(profile: LaunchSpec, monochrome: boolean): vscode.IconPath {
    if (!profile.agent) {
      return new vscode.ThemeIcon('sparkle-filled');
    }
    const icon = (name: string) =>
      vscode.Uri.joinPath(this.extensionUri, 'media', 'icons', `${name}.svg`);
    if (!monochrome && BRAND_COLORED.has(profile.agent)) {
      return icon(profile.agent);
    }
    return { light: icon(`${profile.agent}-light`), dark: icon(`${profile.agent}-dark`) };
  }

  public async promptAndCreateTerminal(): Promise<void> {
    const config = this.configManager.getConfig();
    const result = await this.commandPicker.promptForCommand(config.profiles[0].command);

    if (!result.cancelled && result.command) {
      await this.createTerminal(
        launchForCommand(result.command, result.args, config.programStatus)
      );
    }
  }

  /**
   * Quick pick over the open tabs with their status, for switching without
   * the tab strip.
   */
  public async pickTerminal(): Promise<void> {
    const { autoTabTitles } = this.configManager.getConfig();
    const items = this.stateManager.getAll().map((instance) => ({
      label: this.stateManager.getFullLabel(instance, autoTabTitles),
      description: instance.isActive ? 'active' : undefined,
      detail: this.stateManager.describeStatus(instance),
      id: instance.id
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Switch to terminal tab'
    });
    if (picked) {
      this.switchToTerminal(picked.id);
      await vscode.commands.executeCommand('agentTerminal.terminalView.focus');
    }
  }

  /**
   * Closes tabs the user asked to close. Closing ends the agent's process, so
   * tabs whose agent is working or waiting for an answer ask first, unless
   * `agentTerminal.confirmClose` is off.
   */
  public async requestClose(terminalIds: string[]): Promise<boolean> {
    const busy = terminalIds
      .map((id) => this.stateManager.get(id))
      .filter((instance) => instance && this.stateManager.isBusy(instance));
    const { confirmClose, autoTabTitles, tabTitleWords } = this.configManager.getConfig();

    if (busy.length > 0 && confirmClose) {
      const [first] = busy;
      const message =
        busy.length === 1 && first
          ? `Close "${this.stateManager.getLabel(first, autoTabTitles, tabTitleWords)}"?`
          : `Close ${String(busy.length)} tabs with running agents?`;
      const detail =
        busy.length === 1 && first
          ? `${first.launch.label} is ${this.stateManager.getStatus(first) === 'working' ? 'still working' : 'waiting for your input'}. Closing the tab ends its session.`
          : 'Their agents are working or waiting for input. Closing the tabs ends their sessions.';
      const close = busy.length === 1 ? 'Close' : 'Close All';
      const dontAsk = "Close and Don't Ask Again";

      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true, detail },
        close,
        dontAsk
      );
      if (!choice) {
        void this.focusView();
        return false;
      }
      if (choice === dontAsk) {
        await vscode.workspace
          .getConfiguration('agentTerminal')
          .update('confirmClose', false, vscode.ConfigurationTarget.Global);
      }
    }

    for (const id of terminalIds) {
      this.closeTerminal(id);
    }
    if (busy.length > 0 && confirmClose) {
      void this.focusView();
    }
    return true;
  }

  /** Returns focus to the terminal after a dialog; the webview focuses the active tab */
  private async focusView(): Promise<void> {
    await vscode.commands.executeCommand('agentTerminal.terminalView.focus');
  }

  public closeTerminal(terminalId: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;

    this.ptyManager.kill(terminalId);
    this.promptDetector.removeTerminal(terminalId);
    this.signalParsers.delete(terminalId);
    this.stateManager.delete(terminalId);
    this.postMessage({ type: 'removeTab', id: terminalId });

    // Handle active terminal closure
    if (this.stateManager.getActiveId() === terminalId) {
      this.handleActiveTerminalClosed();
      return;
    }

    this.sendTabsUpdate();
  }

  private handleActiveTerminalClosed(): void {
    const remaining = this.stateManager.getAll();
    if (remaining.length > 0) {
      const newActive = remaining[remaining.length - 1];
      this.switchToTerminal(newActive.id);
    } else {
      this.stateManager.clearActive();
      void this.createTerminal();
      return;
    }
    this.sendTabsUpdate();
  }

  public async closeOtherTerminals(terminalId: string): Promise<void> {
    const others = [...this.stateManager.getAllIds()].filter((id) => id !== terminalId);
    if (await this.requestClose(others)) {
      this.switchToTerminal(terminalId);
    }
  }

  public closeActiveTerminal(): void {
    const activeId = this.stateManager.getActiveId();
    if (activeId) {
      void this.requestClose([activeId]);
    }
  }

  public switchToTerminal(terminalId: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;

    this.stateManager.setActive(terminalId);
    this.scheduleSeen();
    this.postMessage({ type: 'switchTab', id: terminalId });
    this.sendTabsUpdate();
  }

  /** Switches to the tab at a 1-based position; 9 is always the last tab */
  public switchToTerminalAt(position: number): void {
    const ids = this.stateManager.getAllIds();
    const id = position >= 9 ? ids[ids.length - 1] : ids[position - 1];
    if (id) {
      this.switchToTerminal(id);
    }
  }

  public switchToNextTerminal(): void {
    const ids = this.stateManager.getAllIds();
    if (ids.length <= 1) return;

    const currentIndex = ids.indexOf(this.stateManager.getActiveId() ?? '');
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchToTerminal(ids[nextIndex]);
  }

  public switchToPreviousTerminal(): void {
    const ids = this.stateManager.getAllIds();
    if (ids.length <= 1) return;

    const currentIndex = ids.indexOf(this.stateManager.getActiveId() ?? '');
    const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
    this.switchToTerminal(ids[prevIndex]);
  }

  /**
   * Restarts a tab with its own command and working directory, after its
   * process exited (Enter, or `agentTerminal.onExit: restart`).
   */
  private restartTerminal(terminalId: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;

    instance.exited = false;
    instance.reportsStatus = false;
    instance.programState = undefined;
    instance.statusMessage = undefined;
    instance.needsInput = false;
    instance.lastNotification = undefined;
    instance.titleLabel = undefined;
    instance.unseen = undefined;
    instance.missing = undefined;
    this.signalParsers.delete(terminalId);
    this.sendTabsUpdate();
    this.postMessage({ type: 'clear', id: terminalId });
    this.startProcess(instance);
  }

  /**
   * Starts a tab's process, unless its command or the agent it wraps cannot
   * be found on the PATH the process would get. Then the tab explains that
   * instead of failing with a spawn error.
   */
  private startProcess(instance: TerminalInstance): void {
    const config = this.configManager.getConfig();
    const missing = missingCommand(
      instance.launch,
      this.ptyManager.getSearchPath(config, instance.launch)
    );
    if (missing) {
      this.showNotInstalled(instance, missing);
      return;
    }
    this.ptyManager.spawn(
      instance.id,
      config,
      instance.launch,
      this.lastCols,
      this.lastRows,
      instance.cwd
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
    this.sendTabsUpdate();

    const what = agent ? `${label} is not installed` : `"${label}" cannot start`;
    const message = `${what}: \`${command}\` was not found on the PATH.`;
    this.postMessage({
      type: 'output',
      id: instance.id,
      data: `\x1b[1m${message}\x1b[0m\r\n\x1b[2mPress Enter to try again or Esc to close.\x1b[0m\r\n`
    });
    void vscode.window.showErrorMessage(message);
  }

  public clear(): void {
    const activeId = this.stateManager.getActiveId();
    if (activeId) {
      this.postMessage({ type: 'clear', id: activeId });
    }
  }

  public updateConfig(): void {
    this.configManager.invalidateCache();
    this.promptDetector.updateConfig(this.getPromptDetectorConfig());
    this.sendTabsUpdate();
  }

  public dispose(): void {
    this.disposed = true;
    clearTimeout(this.seenTimer);
    this.ptyManager.killAll();
    this.promptDetector.dispose();
    this.configManager.dispose();
    this.commandPicker.dispose();
  }

  // --- Private Helpers ---

  private getPromptDetectorConfig(): PromptDetectorConfig {
    const vsConfig = vscode.workspace.getConfiguration('agentTerminal');
    return {
      enabled: vsConfig.get<boolean>('promptNotification', true),
      showDelay: vsConfig.get<number>('promptNotificationDelay', 300),
      customPatterns: vsConfig.get<string[]>('promptPatterns', [])
    };
  }

  private handleNotificationChange(terminalId: string, isWaiting: boolean): void {
    this.stateManager.setWaitingForInput(terminalId, isWaiting);
    this.sendTabsUpdate();
  }

  private postMessage(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Sends the tab list to the webview. The badge on the view's icon counts
   * tabs that need the user.
   */
  private sendTabsUpdate(): void {
    const { autoTabTitles, tabTitleWords, statusColors, monochromeIcons } =
      this.configManager.getConfig();
    const tabs = this.stateManager.getTabsInfo(autoTabTitles, tabTitleWords);
    this.postMessage({ type: 'tabsUpdate', tabs, statusColors, monochromeIcons });

    if (this.view) {
      const count = this.stateManager
        .getAll()
        .filter((t) => this.stateManager.needsAttention(t)).length;
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

  private getHtmlForWebview(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'xterm.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${xtermCssUri.toString()}" rel="stylesheet">
    <link href="${stylesUri.toString()}" rel="stylesheet">
</head>
<body>
    <div id="tab-bar">
        <button id="tab-scroll-left" class="tab-scroll" title="Scroll Left" aria-label="Scroll Left">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.928 7.976l4.357 4.357-.618.62L5 8.284v-.618L9.667 3l.618.619-4.357 4.357z"/></svg>
        </button>
        <div id="tab-list" role="tablist" aria-label="Terminal tabs"></div>
        <button id="tab-scroll-right" class="tab-scroll" title="Scroll Right" aria-label="Scroll Right">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>
        </button>
        <div id="new-tab" role="group" aria-label="New Tab">
            <button id="new-tab-default" title="New Tab" aria-label="New Tab">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
            </button>
            <button id="new-tab-profile" title="Use Profile…" aria-label="Use Profile…">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>
            </button>
        </div>
    </div>
    <div id="terminals-container"></div>
    <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
