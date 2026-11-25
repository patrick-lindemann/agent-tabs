import { describe, expect, it, vi } from 'vitest';
import type { Uri } from 'vscode';
import { EditorArea } from '../../src/terminal/editor';

const vscode = vi.hoisted(() => ({ createWebviewPanel: vi.fn() }));
vi.mock('vscode', () => ({
  window: vscode,
  ViewColumn: { Active: -1 },
  ThemeIcon: class {},
  Uri: { joinPath: () => ({ toString: () => 'asset' }) }
}));

function mockPanel() {
  let receive = (_message: unknown) => {};
  let close = () => {};
  const panel = {
    viewType: '',
    title: 'Pi',
    active: true,
    reveal: vi.fn(),
    dispose: () => close(),
    onDidDispose: (listener: () => void) => {
      close = listener;
    },
    onDidChangeViewState: () => ({ dispose: vi.fn() }),
    webview: {
      html: '',
      postMessage: vi.fn(),
      asWebviewUri: (uri: Uri) => uri,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: vi.fn() };
      }
    }
  };
  vscode.createWebviewPanel.mockImplementationOnce((viewType: string) => {
    panel.viewType = viewType;
    return panel;
  });
  return { panel, receive: (message: unknown) => receive(message) };
}

function openEditor() {
  const { panel, receive } = mockPanel();
  const host = { receive: vi.fn(), viewed: vi.fn(), closed: vi.fn() };
  const uri = {} as Uri;
  const editor = new EditorArea(uri, host);
  editor.move('tab', 'Pi', uri);
  return { editor, host, panel, receive };
}

describe('Agent Tabs editor', () => {
  it('waits for its renderer and only accepts input for its own tab', () => {
    const { editor, host, panel, receive } = openEditor();
    const output = { type: 'output', id: 'tab', data: 'hello' } as const;
    editor.post('tab', output);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    receive({ type: 'ready' });
    editor.post('tab', output);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(output);
    receive({ type: 'input', id: 'other', data: 'wrong tab' });
    receive({ type: 'input', id: 'tab', data: 'right tab' });
    expect(host.receive.mock.calls).toEqual([
      ['tab', { type: 'ready' }],
      ['tab', { type: 'input', id: 'tab', data: 'right tab' }]
    ]);
  });

  it('uses only the outer editor tab', () => {
    const { editor, panel } = openEditor();
    expect(panel.webview.html).toContain('id="editor-terminal"');
    expect(panel.webview.html).not.toContain('id="panes"');
    expect(editor.getActiveId()).toBe('tab');
    panel.active = false;
    expect(editor.getActiveId()).toBeUndefined();
  });

  it('returns the clicked editor, even when another editor with the same title is active', () => {
    const { editor, host, panel } = openEditor();
    const { panel: active } = mockPanel();
    editor.move('active', 'Pi', {} as Uri);
    panel.active = false;
    const path = `webview-panel/webview-${panel.viewType}-test`;
    expect(editor.closeFromMenu({ scheme: 'file', path } as Uri)).toBe(false);
    expect(
      editor.closeFromMenu({
        scheme: 'webview-panel',
        path: 'webview-panel/webview-other.editor'
      } as Uri)
    ).toBe(false);
    expect(editor.getIdFromMenu({ scheme: 'webview-panel', path } as Uri)).toBe('tab');
    expect(host.closed).not.toHaveBeenCalled();
    expect(editor.closeFromMenu({ scheme: 'webview-panel', path } as Uri)).toBe(true);
    expect(host.closed.mock.calls).toEqual([['tab']]);
    expect(editor.getActiveId()).toBe('active');
    expect(active.viewType).not.toBe(panel.viewType);
  });

  it('returns a closed panel to the sidebar, except during shutdown', () => {
    const { editor, host } = openEditor();
    editor.close('tab');
    expect(editor.has('tab')).toBe(false);
    expect(host.closed).toHaveBeenCalledWith('tab');

    const next = openEditor();
    next.editor.dispose();
    expect(next.host.closed).not.toHaveBeenCalled();
  });

  it('updates the editor tab name and icon, and keeps an unchanged icon', () => {
    const { editor, panel } = openEditor();
    const working = { light: uri('working-light.png'), dark: uri('working-dark.png') };
    let iconPath: unknown;
    let iconSets = 0;
    Object.defineProperty(panel, 'iconPath', {
      get: () => iconPath,
      set: (value) => {
        iconPath = value;
        iconSets++;
      }
    });
    editor.update('tab', 'Build log', working);
    expect(panel.title).toBe('Build log');
    expect(iconPath).toBe(working);
    // The same files again, e.g. on the next refresh, so the animation does not restart
    editor.update('tab', 'Build log', {
      light: uri('working-light.png'),
      dark: uri('working-dark.png')
    });
    expect(iconSets).toBe(1);
    editor.update('tab', 'Build log', uri('pi.png'));
    expect(iconSets).toBe(2);
  });
});

function uri(path: string): Uri {
  return { toString: () => path } as Uri;
}
