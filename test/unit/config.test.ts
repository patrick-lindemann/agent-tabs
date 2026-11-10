import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager, onExitSetting, titleWordsSetting } from '../../src/config';

const vscode = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  warnings: [] as string[]
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => vscode.settings[key] ?? fallback
    })
  },
  window: {
    onDidChangeWindowState: () => ({ dispose: () => {} }),
    showWarningMessage: (message: string) => {
      vscode.warnings.push(message);
      return Promise.resolve(undefined);
    }
  }
}));

beforeEach(() => {
  vscode.settings = {};
  vscode.warnings = [];
});

describe('settings', () => {
  it.each([
    ['close', 'close'],
    ['keep', 'keep'],
    ['sometimes', 'auto'],
    [undefined, 'auto'],
    [1, 'auto']
  ])('reads onExit %s as %s', (value, action) => {
    expect(onExitSetting(value)).toBe(action);
  });

  it.each([
    [3, 3],
    [2.7, 2],
    [0, 1],
    [Number.NaN, 4],
    ['5', 4],
    [undefined, 4]
  ])('reads tabTitleWords %s as %s', (value, words) => {
    expect(titleWordsSetting(value)).toBe(words);
  });

  it('warns about the same profile problems once', () => {
    vscode.settings.profiles = [{ command: 'claude' }];
    const config = new ConfigManager();
    config.getConfig();
    config.invalidateCache();
    config.getConfig();
    expect(vscode.warnings).toHaveLength(1);

    vscode.settings.profiles = [{ command: 'pi' }, { name: 'X' }];
    config.invalidateCache();
    config.getConfig();
    expect(vscode.warnings).toHaveLength(2);
  });
});
