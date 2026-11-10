import * as vscode from 'vscode';
import { defaultProfile, multiplexerSetting, resolveProfiles } from './profiles';
import type { PromptDetectorConfig } from './terminal/prompt';
import type { OnExitAction, TerminalConfig } from './types';

/**
 * Manages terminal configuration with caching.
 * Configuration is cached and invalidated when VS Code settings change.
 */
export class ConfigManager {
  private cachedConfig: TerminalConfig | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Listen for configuration changes and invalidate cache
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentTabs')) {
          this.invalidateCache();
        }
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
    const { profiles, problems } = resolveProfiles(config.get('profiles'), programStatus);
    const fallback = defaultProfile(profiles, config.get('defaultProfile'));
    if (fallback.problem) problems.push(fallback.problem);
    if (problems.length > 0) {
      void vscode.window.showWarningMessage(
        `Agent Tabs: check agentTabs.profiles: ${problems.join('; ')}.`
      );
    }

    this.cachedConfig = {
      autoRun: config.get<boolean>('autoRun', true),
      shell: config.get<string>('shell', ''),
      env: config.get<Record<string, string>>('env', {}),
      directMode: config.get<boolean>('directMode', true),
      onExit: config.get<OnExitAction>('onExit', 'auto'),
      programStatus,
      autoTabTitles: config.get<boolean>('autoTabTitles', true),
      tabTitleWords: Math.max(1, Math.floor(config.get<number>('tabTitleWords', 4))),
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

/** Settings of the pattern-based prompt detector, read fresh on each change */
export function promptConfig(): PromptDetectorConfig {
  const config = vscode.workspace.getConfiguration('agentTabs');
  return {
    enabled: config.get<boolean>('promptNotification', true),
    showDelay: config.get<number>('promptNotificationDelay', 300),
    customPatterns: config.get<string[]>('promptPatterns', [])
  };
}
