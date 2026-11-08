import * as vscode from 'vscode';
import { fromLegacyProfiles, resolveProfiles } from './profiles';
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
        if (e.affectsConfiguration('agentTerminal')) {
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

    const config = vscode.workspace.getConfiguration('agentTerminal');
    const programStatus = config.get<boolean>('programStatus', true);
    const { profiles, problems } = resolveProfiles(config.get('profiles'), programStatus);
    if (problems.length > 0) {
      void vscode.window.showWarningMessage(
        `SideMates: check agentTerminal.profiles: ${problems.join('; ')}.`
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
      profiles
    };

    return this.cachedConfig;
  }

  /**
   * Rewrites `agentTerminal.profiles` from 1.2, a list of objects, as the
   * table of names and command lines that the Settings editor can edit.
   */
  async migrateProfiles(): Promise<void> {
    const config = vscode.workspace.getConfiguration('agentTerminal');
    const inspected = config.inspect('profiles');
    const scopes = [
      [inspected?.globalValue, vscode.ConfigurationTarget.Global],
      [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace]
    ] as const;
    for (const [value, target] of scopes) {
      if (Array.isArray(value)) {
        await config.update('profiles', fromLegacyProfiles(value), target);
      }
    }
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
  const config = vscode.workspace.getConfiguration('agentTerminal');
  return {
    enabled: config.get<boolean>('promptNotification', true),
    showDelay: config.get<number>('promptNotificationDelay', 300),
    customPatterns: config.get<string[]>('promptPatterns', [])
  };
}
