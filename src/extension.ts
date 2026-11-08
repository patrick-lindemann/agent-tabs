import * as vscode from 'vscode';
import { ViewProvider } from './webview/provider';

let terminalProvider: ViewProvider | undefined;

interface TabContext {
  terminalId: string;
}

export function activate(context: vscode.ExtensionContext) {
  terminalProvider = new ViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sideMates.terminalView', terminalProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Multi-tab commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.newTab', () => {
      void terminalProvider?.createTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.newTabWithCommand', () => {
      void terminalProvider?.promptAndCreateTerminal();
    }),
    vscode.commands.registerCommand('sideMates.newTabWithProfile', () => {
      void terminalProvider?.pickProfileAndCreateTerminal();
    }),
    vscode.commands.registerCommand('sideMates.manageProfiles', () => {
      void terminalProvider?.manageProfiles();
    }),
    vscode.commands.registerCommand('sideMates.switchTab', () => {
      void terminalProvider?.pickTerminal();
    }),
    vscode.commands.registerCommand('sideMates.switchToTabAt', (position: number) => {
      terminalProvider?.switchToTerminalAt(position);
    })
  );

  // Tab context menu; VS Code passes the tab's data-vscode-context
  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.closeTabFromMenu', (tab: TabContext) => {
      void terminalProvider?.requestClose([tab.terminalId]);
    }),
    vscode.commands.registerCommand('sideMates.closeOtherTabs', (tab: TabContext) => {
      void terminalProvider?.closeOtherTerminals(tab.terminalId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.closeTab', () => {
      terminalProvider?.closeActiveTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.nextTab', () => {
      terminalProvider?.switchToNextTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideMates.previousTab', () => {
      terminalProvider?.switchToPreviousTerminal();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sideMates')) {
        terminalProvider?.updateConfig();
      }
    })
  );
}

export function deactivate() {
  terminalProvider?.dispose();
}
