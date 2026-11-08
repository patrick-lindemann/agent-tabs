import { TabBar } from './tabs';
import { Terminals } from './terminal';
import type { WebviewIncomingMessage, WebviewOutgoingMessage } from './types';

function start(): void {
  const vscode = acquireVsCodeApi();
  const post = (message: WebviewOutgoingMessage) => vscode.postMessage(message);
  const terminals = new Terminals(post);
  const tabs = new TabBar(post, () => terminals.focusActive());

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
        tabs.render(message.tabs, message.statusColors, message.monochromeIcons);
        break;
      case 'createTab':
        terminals.create(message.id);
        break;
      case 'switchTab':
        terminals.show(message.id);
        break;
      case 'removeTab':
        terminals.remove(message.id);
        break;
    }
  });

  // Reports focus for the `agentTabs.focused` context key. When the view
  // gains focus, e.g. after Switch Tab… or a tab shortcut, keyboard input
  // goes to the active terminal instead of the page.
  window.addEventListener('focus', () => {
    post({ type: 'focus', focused: true });
    terminals.focusActive();
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
