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

/**
 * The icon of a profile and its tabs: an agent's logo, the terminal icon,
 * or `sparkle` for any other program
 */
export type ProfileIcon = AgentId | 'terminal' | 'sparkle';

export const PROFILE_ICONS: readonly ProfileIcon[] = [
  'claude',
  'codex',
  'antigravity',
  'gemini',
  'opencode',
  'pi',
  'cursor',
  'copilot',
  'grok',
  'hermes',
  'devin',
  'terminal',
  'sparkle'
];

export type TabStatus = 'working' | 'blocked' | 'done' | 'error';

export interface TabInfo {
  id: string;
  label: string;
  description: string;
  icon: ProfileIcon;
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
  | { type: 'openLink'; url: string }
  | { type: 'focus'; focused: boolean };

export type ExtensionMessage =
  | { type: 'output'; id: string; data: string }
  | { type: 'clear'; id: string }
  | { type: 'tabsUpdate'; tabs: TabInfo[]; statusColors: boolean; monochromeIcons: boolean }
  | { type: 'createTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'removeTab'; id: string }
  /** The terminal font from `terminal.integrated.*`, or the editor's */
  | { type: 'appearance'; fontSize: number; fontFamily?: string; lineHeight: number };

export type WebviewIncomingMessage = ExtensionMessage;
export type WebviewOutgoingMessage = WebviewMessage;
