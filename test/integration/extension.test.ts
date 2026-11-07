import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';

suite('SideMates extension', () => {
  test('activates and contributes the terminal view and commands', async () => {
    const extension = vscode.extensions.getExtension('patrick-lindemann.agent-terminal');
    assert.ok(extension, 'extension should be discovered');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('agentTerminal.newTab'));
    assert.ok(commands.includes('agentTerminal.closeTab'));
    const view = vscode.extensions.all
      .flatMap((item) => item.packageJSON?.contributes?.views?.agentTerminalContainer ?? [])
      .find((item: { id?: string }) => item.id === 'agentTerminal.terminalView');
    assert.ok(view);
  });

  test('reads configuration defaults and executes navigation commands', async () => {
    const config = vscode.workspace.getConfiguration('agentTerminal');
    assert.strictEqual(config.get('autoRun'), true);
    assert.strictEqual(config.get('directMode'), true);
    await vscode.commands.executeCommand('agentTerminal.nextTab');
    await vscode.commands.executeCommand('agentTerminal.previousTab');
  });
});
