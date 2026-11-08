import * as vscode from 'vscode';
import { type ConfigManager, promptConfig } from '../config';
import { missingCommand } from '../profiles';
import type { ExtensionMessage, LaunchSpec, TerminalInstance } from '../types';
import { PromptDetector } from './prompt';
import { PtyManager } from './pty';
import { isTerminalReport } from './signals';
import { TerminalStateManager } from './state';
import { resetStatus, StatusTracker } from './status';

/** Exit code of a shell or wrapper that could not find a command */
const COMMAND_NOT_FOUND = 127;

/** How long a tab must stay in view before its result counts as seen */
const SEEN_DELAY_MS = 1000;

/** What the tabs need from the view that shows them */
export interface TabsHost {
  post(message: ExtensionMessage): void;
  /** Sends the tab list again after a tab's label or status changed */
  refresh(): void;
  /** Whether the view exists and is shown */
  isVisible(): boolean;
  /** Whether the view exists, so process output has somewhere to go */
  isAttached(): boolean;
}

/**
 * The open tabs and their processes: opening, closing, switching, restarting
 * and what happens when a process exits.
 */
export class Tabs {
  readonly state = new TerminalStateManager();
  readonly pty: PtyManager;
  private readonly prompt: PromptDetector;
  private readonly status = new StatusTracker();
  private seenTimer: ReturnType<typeof setTimeout> | undefined;
  private cols = 80;
  private rows = 24;

  constructor(
    private readonly config: ConfigManager,
    private readonly host: TabsHost
  ) {
    this.pty = new PtyManager({
      onData: (id, data) => this.handleData(id, data),
      onExit: (id, code, runtimeMs) => this.handleExit(id, code, runtimeMs),
      onError: (id, error) => this.handleError(id, error)
    });
    this.prompt = new PromptDetector(promptConfig(), (id, waiting) => {
      this.state.setWaitingForInput(id, waiting);
      this.host.refresh();
    });
  }

  /** Opens a tab. Without a launch it runs the first profile. */
  async create(launch?: LaunchSpec): Promise<string> {
    const id = this.state.generateId();
    const { path: cwd, folderIndex } = await this.pty.selectWorkingDirectory();
    const instance: TerminalInstance = {
      id,
      isActive: false,
      workspaceFolderIndex: folderIndex,
      cwd,
      launch: launch ?? this.config.getConfig().profiles[0]
    };

    // Add the instance first so setActive can find it
    this.state.set(id, instance);
    this.state.setActive(id);
    this.host.post({ type: 'createTab', id });
    this.host.refresh();
    this.start(instance);
    this.host.post({ type: 'switchTab', id });
    return id;
  }

  /** Closes a tab without asking; closing the last one opens a new one */
  close(id: string): void {
    if (!this.state.get(id)) return;

    this.pty.kill(id);
    this.prompt.removeTerminal(id);
    this.status.forget(id);
    this.state.delete(id);
    this.host.post({ type: 'removeTab', id });

    if (this.state.getActiveId() !== id) {
      this.host.refresh();
      return;
    }
    const remaining = this.state.getAllIds();
    if (remaining.length > 0) {
      this.switchTo(remaining[remaining.length - 1]);
    } else {
      this.state.clearActive();
      void this.create();
    }
  }

  switchTo(id: string): void {
    if (!this.state.get(id)) return;
    this.state.setActive(id);
    this.scheduleSeen();
    this.host.post({ type: 'switchTab', id });
    this.host.refresh();
  }

  /** Switches to the tab at a 1-based position; 9 is always the last tab */
  switchToPosition(position: number): void {
    const ids = this.state.getAllIds();
    const id = position >= 9 ? ids[ids.length - 1] : ids[position - 1];
    if (id) {
      this.switchTo(id);
    }
  }

  /** Switches to the next (1) or previous (-1) tab, wrapping around */
  cycle(step: 1 | -1): void {
    const ids = this.state.getAllIds();
    if (ids.length <= 1) return;
    const current = ids.indexOf(this.state.getActiveId() ?? '');
    this.switchTo(ids[(current + step + ids.length) % ids.length]);
  }

  /** Typed input. In an exited tab, Enter restarts and Esc closes. */
  input(id: string, data: string): void {
    const instance = this.state.get(id);
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

    this.prompt.onUserInput(id);
    // A question is answered with Enter or dismissed with Esc; arrow keys and
    // typing only move within it
    if (instance?.needsInput && (data.includes('\r') || data === '\x1b')) {
      instance.needsInput = false;
      this.host.refresh();
    }
    // Typing into a tab counts as having seen its result
    if (instance?.unseen && this.isInView(instance)) {
      instance.unseen = undefined;
      this.host.refresh();
    }
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
    const activeId = this.state.getActiveId();
    const instance = activeId ? this.state.get(activeId) : undefined;
    if (!instance?.unseen || !this.isInView(instance)) return;

    this.seenTimer = setTimeout(() => {
      if (instance.unseen && this.isInView(instance)) {
        instance.unseen = undefined;
        this.host.refresh();
      }
    }, SEEN_DELAY_MS);
  }

  updateConfig(): void {
    this.prompt.updateConfig(promptConfig());
  }

  /**
   * Ends all processes and forgets the tabs, e.g. when the webview is
   * destroyed; the next webview sends `ready` and starts cleanly.
   */
  reset(): void {
    this.pty.killAll();
    this.prompt.dispose();
    this.status.clear();
    this.state.clear();
  }

  dispose(): void {
    clearTimeout(this.seenTimer);
    this.pty.killAll();
    this.prompt.dispose();
  }

  private isInView(instance: TerminalInstance): boolean {
    return instance.isActive && this.host.isVisible();
  }

  /**
   * Restarts a tab with its own command and working directory, after its
   * process exited (Enter, or `agentTerminal.onExit: restart`).
   */
  private restart(id: string): void {
    const instance = this.state.get(id);
    if (!instance) return;
    resetStatus(instance);
    this.status.forget(id);
    this.host.refresh();
    this.host.post({ type: 'clear', id });
    this.start(instance);
  }

  /**
   * Starts a tab's process, unless its command or the agent it wraps cannot
   * be found on the PATH the process would get. Then the tab explains that
   * instead of failing with a spawn error.
   */
  private start(instance: TerminalInstance): void {
    const config = this.config.getConfig();
    const missing = missingCommand(
      instance.launch,
      this.pty.getSearchPath(config, instance.launch)
    );
    if (missing) {
      this.showNotInstalled(instance, missing);
      return;
    }
    this.pty.spawn(instance.id, config, instance.launch, this.cols, this.rows, instance.cwd);
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
    this.host.refresh();

    const what = agent ? `${label} is not installed` : `"${label}" cannot start`;
    const message = `${what}: \`${command}\` was not found on the PATH.`;
    this.write(
      instance.id,
      `\x1b[1m${message}\x1b[0m\r\n\x1b[2mPress Enter to try again or Esc to close.\x1b[0m\r\n`
    );
    void vscode.window.showErrorMessage(message);
  }

  private write(id: string, data: string): void {
    this.host.post({ type: 'output', id, data });
  }

  private handleData(id: string, data: string): void {
    this.trackSignals(id, data);
    if (this.host.isAttached()) {
      this.write(id, data);
      this.prompt.onData(id, data);
    }
  }

  private trackSignals(id: string, data: string): void {
    const instance = this.state.get(id);
    if (!instance) return;
    const changed = this.status.track(instance, data, {
      programStatus: this.config.getConfig().programStatus,
      inView: this.isInView(instance),
      reply: (reply) => this.pty.write(id, reply)
    });
    if (changed) {
      this.host.refresh();
    }
  }

  /**
   * `onExit: auto` closes the tab after a clean exit (e.g. `/exit`) and keeps
   * failed runs open so their output stays readable. `restart` falls back to
   * the prompt when the process dies right after starting, to avoid a loop.
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
    if (onExit === 'close' || (onExit === 'auto' && exitCode === 0)) {
      this.close(id);
      return;
    }
    if (onExit === 'restart' && runtimeMs >= 3000) {
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
    this.host.refresh();
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
    this.host.refresh();
    this.write(
      id,
      `\r\nError starting terminal: ${error}\r\n\x1b[2mPress Enter to retry or Esc to close.\x1b[0m\r\n`
    );
  }
}
