import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal as XTermTerminal } from '@xterm/xterm';

// VS Code API types for webview
export interface VSCodeAPI {
  postMessage(message: WebviewOutgoingMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

// Global declarations for VSCode webview API
declare global {
  function acquireVsCodeApi(): VSCodeAPI;
}

// Tab information
export interface TabInfo {
  id: string;
  label: string;
  description: string;
  agent?:
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
  isActive: boolean;
  accentColor?: string;
  status?: 'working' | 'blocked' | 'done' | 'error';
  statusText?: string;
}

// Message types from extension to webview
export type WebviewIncomingMessage =
  | { type: 'output'; id: string; data: string }
  | { type: 'clear'; id: string }
  | { type: 'tabsUpdate'; tabs: TabInfo[]; statusColors: boolean; monochromeIcons: boolean }
  | { type: 'createTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'removeTab'; id: string };

// Message types from webview to extension
export type WebviewOutgoingMessage =
  | { type: 'ready'; cols: number; rows: number }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'newTab' }
  | { type: 'newTabWithProfile' }
  | { type: 'newTabWithCommand' }
  | { type: 'closeTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'openFile'; id: string; path: string; line?: number; column?: number }
  | { type: 'focus'; focused: boolean };

// Terminal entry in the map
export interface TerminalEntry {
  terminal: XTermTerminal;
  fitAddon: XTermFitAddon;
  element: HTMLDivElement;
  isAtBottom: boolean;
  lastScrollTop: number;
}

// xterm.js theme type (re-export for convenience)
export type XTermTheme = ITheme;
