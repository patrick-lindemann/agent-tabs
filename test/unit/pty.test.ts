import { describe, expect, it, vi } from 'vitest';
import { hostEnvironment } from '../../src/terminal/pty';

vi.mock('vscode', () => ({ workspace: {}, window: {} }));

describe('the environment of a tab', () => {
  it('leaves out what only concerns the extension host', () => {
    expect(
      hostEnvironment({
        PATH: '/bin',
        HOME: '/home/me',
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_IPC_HOOK: 'x',
        VSCODE_PORTABLE: '/p',
        SNAP: '/snap',
        SNAPSHOT: 'kept',
        EMPTY: undefined
      })
    ).toEqual({ PATH: '/bin', HOME: '/home/me', VSCODE_PORTABLE: '/p', SNAPSHOT: 'kept' });
  });
});
