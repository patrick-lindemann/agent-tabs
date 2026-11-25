import { Panes } from './panes';
import { Terminals } from './terminal';
import type { WebviewIncomingMessage, WebviewOutgoingMessage } from './types';

function start(): void {
  const vscode = acquireVsCodeApi();
  const post = (message: WebviewOutgoingMessage) => vscode.postMessage(message);
  const editor = document.getElementById('editor-terminal');
  let panes: Panes | undefined;
  const terminals = new Terminals(post, () => (panes?.count ?? 0) > 1);
  if (!editor) {
    panes = new Panes(post, terminals);
  }

  window.addEventListener('message', (event: MessageEvent<WebviewIncomingMessage>) => {
    const message = event.data;
    switch (message.type) {
      case 'output':
        terminals.write(message.id, message.data);
        break;
      case 'clear':
        terminals.clear(message.id);
        break;
      case 'tabsUpdate':
        panes?.render(message.layout, message.statusColors, message.monochromeIcons);
        break;
      case 'editTabName':
        panes?.editTabName(message.id);
        break;
      case 'createTab':
        terminals.create(message.id, message.history);
        if (editor) {
          terminals.place(message.id, editor);
        }
        break;
      case 'switchTab':
        terminals.show(message.id);
        break;
      case 'removeTab':
        terminals.remove(message.id);
        break;
      case 'appearance':
        terminals.setFont(message);
        break;
    }
  });

  // Reports focus for the `agentTabs.focused` context key. When the view
  // gains focus, e.g. after Switch Tab… or a tab shortcut, keyboard input
  // goes to the active terminal instead of the page.
  window.addEventListener('focus', () => {
    post({ type: 'focus', focused: true });
    if (!document.activeElement?.matches('.tab-name-input')) {
      terminals.focusActive();
    }
  });
  window.addEventListener('blur', () => post({ type: 'focus', focused: false }));
  if (document.hasFocus()) {
    post({ type: 'focus', focused: true });
  }

  window.addEventListener('unload', () => terminals.dispose());
  post({ type: 'ready', ...terminals.measure() });
}

try {
  start();
} catch (error) {
  console.error('Failed to initialize webview:', error);
}
