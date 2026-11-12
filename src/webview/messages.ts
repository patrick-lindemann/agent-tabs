import type { SplitSide, WebviewMessage } from '../types';
import { isWebviewMessage } from '../validate';

/**
 * Context interface that message handlers use to perform actions.
 * Implemented by ViewProvider.
 */
export interface MessageHandlerContext {
  handleReady(cols: number, rows: number): void;
  handleInput(id: string, data: string): void;
  handleResize(id: string, cols: number, rows: number): void;
  handleNewTab(pane?: string): void;
  handleNewTabWithProfile(pane?: string): void;
  handleNewTabWithCommand(): void;
  handleCloseTab(id: string): void;
  handleSwitchTab(id: string): void;
  handleMoveTab(id: string, index: number, pane?: string): void;
  handleSplitTab(id: string, pane: string, side: SplitSide): void;
  handleFocusPane(pane: string): void;
  handleResizeSplit(split: string, sizes: number[]): void;
  handleOpenFile(id: string, path: string, line?: number, column?: number): void;
  handleOpenLink(url: string): void;
  handleFocus(focused: boolean): void;
}

type MessageHandler<T extends WebviewMessage> = (message: T, ctx: MessageHandlerContext) => void;

type MessageHandlerMap = {
  [K in WebviewMessage['type']]: MessageHandler<Extract<WebviewMessage, { type: K }>>;
};

/** The handler of each message type the webview sends */
const messageHandlers: MessageHandlerMap = {
  ready: (message, ctx) => {
    ctx.handleReady(message.cols ?? 80, message.rows ?? 24);
  },
  input: (message, ctx) => {
    ctx.handleInput(message.id, message.data);
  },
  resize: (message, ctx) => {
    ctx.handleResize(message.id, message.cols, message.rows);
  },
  newTab: (message, ctx) => {
    ctx.handleNewTab(message.pane);
  },
  newTabWithProfile: (message, ctx) => {
    ctx.handleNewTabWithProfile(message.pane);
  },
  newTabWithCommand: (_message, ctx) => {
    ctx.handleNewTabWithCommand();
  },
  closeTab: (message, ctx) => {
    ctx.handleCloseTab(message.id);
  },
  switchTab: (message, ctx) => {
    ctx.handleSwitchTab(message.id);
  },
  moveTab: (message, ctx) => {
    ctx.handleMoveTab(message.id, message.index, message.pane);
  },
  splitTab: (message, ctx) => {
    ctx.handleSplitTab(message.id, message.pane, message.side);
  },
  focusPane: (message, ctx) => {
    ctx.handleFocusPane(message.pane);
  },
  resizeSplit: (message, ctx) => {
    ctx.handleResizeSplit(message.split, message.sizes);
  },
  openFile: (message, ctx) => {
    ctx.handleOpenFile(message.id, message.path, message.line, message.column);
  },
  openLink: (message, ctx) => {
    ctx.handleOpenLink(message.url);
  },
  focus: (message, ctx) => {
    ctx.handleFocus(message.focused);
  }
};

/**
 * Dispatches a message to its appropriate handler.
 */
export function dispatchMessage(message: unknown, ctx: MessageHandlerContext): void {
  if (!isWebviewMessage(message)) return;
  const handler = messageHandlers[message.type] as MessageHandler<typeof message> | undefined;
  handler?.(message, ctx);
}
