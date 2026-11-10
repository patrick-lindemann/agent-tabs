import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal as XTermTerminal } from '@xterm/xterm';
import type { WebviewOutgoingMessage } from '../src/protocol';

export type {
  AgentId,
  TabInfo,
  WebviewIncomingMessage,
  WebviewOutgoingMessage
} from '../src/protocol';

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

// Terminal entry in the map
export interface TerminalEntry {
  terminal: XTermTerminal;
  fitAddon: XTermFitAddon;
  element: HTMLDivElement;
  isAtBottom: boolean;
  lastScrollTop: number;
  /** The program asked to be told when the color scheme changes (DECSET 2031) */
  colorSchemeReports: boolean;
}

// xterm.js theme type (re-export for convenience)
export type XTermTheme = ITheme;
