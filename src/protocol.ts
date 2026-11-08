/** Protocol shared by the extension host and its webview. Keep this file free of platform APIs. */
export type AgentId =
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'gemini'
  | 'opencode'
  | 'pi'
  | 'cursor'
  | 'copilot'
  | 'grok'
  | 'hermes'
  | 'devin';

export type TabStatus = 'working' | 'blocked' | 'done' | 'error';

export interface TabInfo {
  id: string;
  label: string;
  description: string;
  agent?: AgentId;
  isActive: boolean;
  accentColor?: string;
  status?: TabStatus;
  statusText?: string;
}

export type WebviewMessage =
  | { type: 'ready'; cols?: number; rows?: number }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'newTab' }
  | { type: 'newTabWithProfile' }
  | { type: 'newTabWithCommand' }
  | { type: 'closeTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'openFile'; id: string; path: string; line?: number; column?: number }
  | { type: 'focus'; focused: boolean };

export type ExtensionMessage =
  | { type: 'output'; id: string; data: string }
  | { type: 'clear'; id: string }
  | { type: 'tabsUpdate'; tabs: TabInfo[]; statusColors: boolean; monochromeIcons: boolean }
  | { type: 'createTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'removeTab'; id: string };

export type WebviewIncomingMessage = ExtensionMessage;
export type WebviewOutgoingMessage = WebviewMessage;
