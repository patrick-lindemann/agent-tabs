import * as vscode from 'vscode';
import { AgentTerminalViewProvider } from './AgentTerminalViewProvider';

let terminalProvider: AgentTerminalViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  terminalProvider = new AgentTerminalViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentTerminal.terminalView', terminalProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.restart', () => {
      terminalProvider?.restart();
    })
  );

  // Multi-tab commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTerminal.newTab', () => {
      void terminalProvider?.createTerminal();
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
