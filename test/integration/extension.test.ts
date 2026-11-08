import * as assert from 'node:assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

const EXTENSION_ID = 'patrick-lindemann.agent-terminal';

suite('SideMates extension', () => {
  test('activates and contributes the terminal view', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'extension should be discovered');
    await extension.activate();
    assert.ok(extension.isActive);
    const views = extension.packageJSON.contributes.views.sideMatesContainer as Array<{
      id: string;
    }>;
    assert.ok(views.some((view) => view.id === 'sideMates.terminalView'));
  });

  test('registers every command it contributes', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const contributed = (
      extension.packageJSON.contributes.commands as Array<{ command: string }>
    ).map((item) => item.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((command) => !registered.has(command));
    assert.deepStrictEqual(missing, [], 'contributed commands without a handler');
  });

  // Switching itself is unit tested in tabs.test.ts; here no process starts,
  // so the commands must not fail without tabs or a resolved view
  test('runs tab navigation without tabs', async () => {
    for (const command of ['sideMates.nextTab', 'sideMates.previousTab', 'sideMates.closeTab']) {
      await vscode.commands.executeCommand(command);
    }
    await vscode.commands.executeCommand('sideMates.switchToTabAt', 1);
  });

  test('reads its configuration defaults', () => {
    const config = vscode.workspace.getConfiguration('sideMates');
    assert.strictEqual(config.get('autoRun'), true);
    assert.strictEqual(config.get('directMode'), true);
    assert.strictEqual(config.get('programStatus'), true);
    assert.strictEqual(config.get('onExit'), 'auto');
  });
});
