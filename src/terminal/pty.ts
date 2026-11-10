import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import type { INodePty, IPty, LaunchSpec, TerminalConfig } from '../types';
import { shellClearCommand, shellQuote } from './shell';

/**
 * Callbacks for PTY events.
 */
export interface PtyEventCallbacks {
  onData: (terminalId: string, data: string) => void;
  /** Called only when the process ends on its own, not after `kill()` */
  onExit: (terminalId: string, exitCode: number, runtimeMs: number) => void;
  onError: (terminalId: string, error: string) => void;
}

/**
 * Result of selecting a working directory.
 */
export interface WorkingDirectorySelection {
  path: string;
  folderIndex: number | undefined;
}

/**
 * Manages PTY process lifecycle.
 */
export class PtyManager {
  private nodePty: INodePty | undefined;
  private readonly ptys = new Map<string, IPty>();

  constructor(private readonly callbacks: PtyEventCallbacks) {}

  /**
   * Spawns a new PTY process for the given terminal ID.
   * @param cwd Optional working directory. If not provided, uses default logic.
   * @param client A multiplexer client to run directly instead of the launch
   */
  spawn(
    terminalId: string,
    config: TerminalConfig,
    launch: LaunchSpec,
    cols: number,
    rows: number,
    cwd?: string,
    client?: { command: string; args: string[] }
  ): void {
    // Kill existing PTY for this terminal if any
    this.kill(terminalId);

    try {
      this.ensureNodePtyLoaded();
      const { shell, env, cwd: defaultCwd } = this.prepareSpawnOptions(config, launch);
      const workingDir = cwd ?? defaultCwd;
      const pty = client
        ? this.nodePty?.spawn(
            client.command,
            client.args,
            this.spawnOptions(cols, rows, workingDir, env)
          )
        : this.createPty(config, launch, shell, cols, rows, workingDir, env);
      if (!pty) throw new Error('node-pty not loaded');

      this.ptys.set(terminalId, pty);
      this.setupPtyEventHandlers(terminalId, pty);
      if (!client) this.handleAutoRun(pty, config, launch);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(terminalId, errorMessage);
    }
  }

  /**
   * Prompts the user to select a workspace folder if multiple are available.
   * Returns the selected folder path and its index for color mapping.
   */
  async selectWorkingDirectory(): Promise<WorkingDirectorySelection> {
    const folders = vscode.workspace.workspaceFolders;

    // If no folders or only one, use default behavior (no color indexing)
    if (!folders || folders.length <= 1) {
      return {
        path: this.getWorkingDirectory(),
        folderIndex: undefined
      };
    }

    // Multiple workspace folders - let user choose
    const items = folders.map((folder, index) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
      index
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select workspace folder for the terminal',
      title: 'Choose Working Directory'
    });

    if (selected) {
      return {
        path: selected.folder.uri.fsPath,
        folderIndex: selected.index
      };
    }

    // User cancelled - use first folder as default
    return {
      path: folders[0].uri.fsPath,
      folderIndex: 0
    };
  }

  private ensureNodePtyLoaded(): void {
    if (!this.nodePty) {
      this.nodePty = require('node-pty') as INodePty;
    }
  }

  private prepareSpawnOptions(
    config: TerminalConfig,
    launch: LaunchSpec
  ): {
    shell: string;
    env: Record<string, string>;
    cwd: string;
  } {
    const shell = config.shell || this.getDefaultShell();
    const cwd = this.getWorkingDirectory();
    const env = this.buildEnvironment({ ...config.env, ...launch.env });
    return { shell, env, cwd };
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private getWorkingDirectory(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = workspaceFolder || os.homedir();
    return fs.existsSync(cwd) ? cwd : os.homedir();
  }

  private buildEnvironment(configEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};

    // Copy process.env, filtering undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Add config env and terminal settings
    Object.assign(env, configEnv, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1'
    });

    // Remove CI flag so CLI agents don't think it's in CI
    delete env.CI;
    // A tab is not inside the tmux session VS Code may have started in
    delete env.TMUX;
    delete env.TMUX_PANE;

    return env;
  }

  private createPty(
    config: TerminalConfig,
    launch: LaunchSpec,
    shell: string,
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>
  ): IPty {
    if (!this.nodePty) {
      throw new Error('node-pty not loaded');
    }

    const spawnOptions = this.spawnOptions(cols, rows, cwd, env);
    if (config.directMode && launch.command) {
      return this.nodePty.spawn(launch.command, launch.args, spawnOptions);
    }
    return this.nodePty.spawn(shell, [], spawnOptions);
  }

  private spawnOptions(cols: number, rows: number, cwd: string, env: Record<string, string>) {
    return { name: 'xterm-256color', cols, rows, cwd, env };
  }

  /**
   * The environment variables a multiplexer session gets on top of its
   * server's: the configured ones and the terminal's color support.
   */
  sessionEnvironment(config: TerminalConfig, launch: LaunchSpec): Record<string, string> {
    return { COLORTERM: 'truecolor', FORCE_COLOR: '1', ...config.env, ...launch.env };
  }

  /** The working directory a tab starts in without its own */
  defaultWorkingDirectory(): string {
    return this.getWorkingDirectory();
  }

  private setupPtyEventHandlers(terminalId: string, pty: IPty): void {
    pty.onData((data: string) => {
      this.callbacks.onData(terminalId, data);
    });

    const startedAt = Date.now();
    pty.onExit(({ exitCode }) => {
      // A killed or replaced PTY was already removed from the map
      if (this.ptys.get(terminalId) !== pty) {
        return;
      }
      this.ptys.delete(terminalId);
      this.callbacks.onExit(terminalId, exitCode, Date.now() - startedAt);
    });
  }

  private handleAutoRun(pty: IPty, config: TerminalConfig, launch: LaunchSpec): void {
    if (!config.directMode && config.autoRun && launch.command) {
      const fullCommand = [launch.command, ...launch.args.map((arg) => shellQuote(arg))].join(' ');
      // Clear screen and run command
      pty.write(`${shellClearCommand()} && ${fullCommand}\r`);
    }
  }

  /**
   * The PATH a tab's process gets, for checking that its command exists.
   */
  getSearchPath(config: TerminalConfig, launch: LaunchSpec): string {
    const env: Partial<Record<string, string>> = this.buildEnvironment({
      ...config.env,
      ...launch.env
    });
    return env.PATH ?? '';
  }

  /**
   * Writes data to the PTY.
   */
  write(terminalId: string, data: string): void {
    this.ptys.get(terminalId)?.write(data);
  }

  /**
   * Resizes the PTY.
   */
  resize(terminalId: string, cols: number, rows: number): void {
    this.ptys.get(terminalId)?.resize(cols, rows);
  }

  /**
   * Kills a specific PTY.
   */
  kill(terminalId: string): void {
    const pty = this.ptys.get(terminalId);
    if (pty) {
      try {
        pty.kill();
      } catch {
        // Ignore errors when killing
      }
      this.ptys.delete(terminalId);
    }
  }

  /**
   * Kills all PTYs.
   */
  killAll(): void {
    for (const terminalId of this.ptys.keys()) {
      this.kill(terminalId);
    }
  }
}
