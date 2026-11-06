import * as vscode from 'vscode';
import { AgentTerminalViewProvider } from './AgentTerminalViewProvider';

let terminalProvider: AgentTerminalViewProvider | undefined;

interface TabContext {
  terminalId: string;
}

export function activate(context: vscode.ExtensionContext) {
  terminalProvider = new AgentTerminalViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentTerminal.terminalView', terminalProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Multi-tab commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.newTab', () => {
      void terminalProvider?.createTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.newTabWithCommand', () => {
      void terminalProvider?.promptAndCreateTerminal();
    }),
    vscode.commands.registerCommand('agentTerminal.newTabWithProfile', () => {
      void terminalProvider?.pickProfileAndCreateTerminal();
    }),
    vscode.commands.registerCommand('agentTerminal.switchTab', () => {
      void terminalProvider?.pickTerminal();
    }),
    vscode.commands.registerCommand('agentTerminal.switchToTabAt', (position: number) => {
      terminalProvider?.switchToTerminalAt(position);
    })
  );

  // Tab context menu; VS Code passes the tab's data-vscode-context
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.closeTabFromMenu', (tab: TabContext) => {
      terminalProvider?.closeTerminal(tab.terminalId);
    }),
    vscode.commands.registerCommand('agentTerminal.closeOtherTabs', (tab: TabContext) => {
      terminalProvider?.closeOtherTerminals(tab.terminalId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.closeTab', () => {
      terminalProvider?.closeActiveTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.nextTab', () => {
      terminalProvider?.switchToNextTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.previousTab', () => {
      terminalProvider?.switchToPreviousTerminal();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentTerminal')) {
        terminalProvider?.updateConfig();
      }
    })
  );
}

export function deactivate() {
  terminalProvider?.dispose();
}
