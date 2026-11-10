import * as vscode from 'vscode';
import { defaultProfile, multiplexerSetting, resolveProfiles, terminalLaunch } from './profiles';
import type { PromptDetectorConfig } from './terminal/prompt';
import type { OnExitAction, TerminalConfig } from './types';

/**
 * Manages terminal configuration with caching.
 * Configuration is cached and invalidated when VS Code settings change.
 */
export class ConfigManager {
  private cachedConfig: TerminalConfig | undefined;
  /** The problems last shown, so the same warning is not shown again */
  private shownProblems = '';
  private readonly disposables: vscode.Disposable[] = [];

  /** The owner calls `invalidateCache` when `agentTabs.*` settings change */
  constructor() {
    // Agents installed meanwhile get a profile when none is configured
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.invalidateCache();
      })
    );
  }

  /**
   * Gets the current terminal configuration (cached).
   */
  getConfig(): TerminalConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const config = vscode.workspace.getConfiguration('agentTabs');
    const programStatus = config.get<boolean>('programStatus', true);
    const { profiles, problems } = resolveProfiles(
      config.get('profiles'),
      programStatus,
      terminalLaunch(defaultShell())
    );
    const fallback = defaultProfile(profiles, config.get('defaultProfile'));
    if (fallback.problem) problems.push(fallback.problem);
    const shown = problems.join('; ');
    if (shown && shown !== this.shownProblems) {
      void vscode.window.showWarningMessage(`Agent Tabs: check agentTabs.profiles: ${shown}.`);
    }
    this.shownProblems = shown;

    this.cachedConfig = {
      autoRun: config.get<boolean>('autoRun', true),
      shell: config.get<string>('shell', ''),
      env: config.get<Record<string, string>>('env', {}),
      directMode: config.get<boolean>('directMode', true),
      onExit: onExitSetting(config.get('onExit')),
      programStatus,
      autoTabTitles: config.get<boolean>('autoTabTitles', true),
      tabTitleWords: titleWordsSetting(config.get('tabTitleWords')),
      statusColors: config.get<boolean>('statusColors', true),
      confirmClose: config.get<boolean>('confirmClose', true),
      monochromeIcons: config.get<boolean>('monochromeIcons', false),
      restoreTabs: config.get<boolean>('restoreTabs', true),
      profiles,
      defaultProfile: fallback.profile,
      multiplexer: multiplexerSetting(config.get('multiplexer'))
    };

    return this.cachedConfig;
  }

  /**
   * Invalidates the cached configuration.
   */
  invalidateCache(): void {
    this.cachedConfig = undefined;
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.disposables.forEach((d) => {
      d.dispose();
    });
    this.disposables.length = 0;
  }
}

/** The shell of VS Code's own terminal, or the user's */
function defaultShell(): string {
  if (vscode.env.shell) return vscode.env.shell;
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/sh';
}

const ON_EXIT_ACTIONS: readonly OnExitAction[] = ['auto', 'close', 'restart', 'keep'];

/** `agentTabs.onExit`, or `auto` for anything else */
export function onExitSetting(value: unknown): OnExitAction {
  return ON_EXIT_ACTIONS.includes(value as OnExitAction) ? (value as OnExitAction) : 'auto';
}

/** `agentTabs.tabTitleWords` as a whole number of at least 1; 4 when it is not a number */
export function titleWordsSetting(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 4;
}

/** Settings of the pattern-based prompt detector, read fresh on each change */
export function promptConfig(): PromptDetectorConfig {
  const config = vscode.workspace.getConfiguration('agentTabs');
  return {
    enabled: config.get<boolean>('promptNotification', true),
    showDelay: config.get<number>('promptNotificationDelay', 300),
    customPatterns: config.get<string[]>('promptPatterns', [])
  };
}
