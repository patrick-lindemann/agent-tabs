import * as vscode from 'vscode';
import { migrateProfileSettings } from './dialogs';
import { ViewProvider } from './webview/provider';

let terminalProvider: ViewProvider | undefined;

interface TabContext {
  terminalId: string;
}

export function activate(context: vscode.ExtensionContext) {
  void migrateProfileSettings();
  terminalProvider = new ViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentTabs.terminalView', terminalProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Multi-tab commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newTab', () => {
      void terminalProvider?.createTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newTabWithCommand', () => {
      void terminalProvider?.promptAndCreateTerminal();
    }),
    vscode.commands.registerCommand('agentTabs.newTabWithProfile', () => {
      void terminalProvider?.pickProfileAndCreateTerminal();
    }),
    vscode.commands.registerCommand('agentTabs.manageProfiles', () => {
      void terminalProvider?.manageProfiles();
    }),
    vscode.commands.registerCommand('agentTabs.switchTab', () => {
      void terminalProvider?.pickTerminal();
    }),
    vscode.commands.registerCommand('agentTabs.switchToTabAt', (position: number) => {
      terminalProvider?.switchToTerminalAt(position);
    })
  );

  // Tab context menu; VS Code passes the tab's data-vscode-context
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.closeTabFromMenu', (tab: TabContext) => {
      void terminalProvider?.requestClose([tab.terminalId]);
    }),
    vscode.commands.registerCommand('agentTabs.closeOtherTabs', (tab: TabContext) => {
      void terminalProvider?.closeOtherTerminals(tab.terminalId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.closeTab', () => {
      terminalProvider?.closeActiveTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.nextTab', () => {
      terminalProvider?.switchToNextTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.previousTab', () => {
      terminalProvider?.switchToPreviousTerminal();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentTabs')) {
        terminalProvider?.updateConfig();
      }
    })
  );
}

export function deactivate() {
  terminalProvider?.dispose();
}
