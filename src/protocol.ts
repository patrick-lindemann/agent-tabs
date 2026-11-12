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
  /** The tab its pane shows */
  isActive: boolean;
  accentColor?: string;
  status?: TabStatus;
  statusText?: string;
}

/** A pane of the view: a tab strip and the terminal of the tab it shows */
export interface PaneInfo {
  type: 'pane';
  id: string;
  /** Commands and new tabs go to the focused pane */
  focused: boolean;
  tabs: TabInfo[];
}

/**
 * Panes or further splits next to each other: side by side in a `row`, one
 * above the other in a `column`
 */
export interface SplitInfo {
  type: 'split';
  id: string;
  direction: SplitDirection;
  /** Each child's share of the split's width or height, in order */
  sizes: number[];
  children: LayoutInfo[];
}

/** The view's layout: one pane, or a split of panes */
export type LayoutInfo = PaneInfo | SplitInfo;

export type SplitDirection = 'row' | 'column';

/** Where a dragged tab dropped on a pane's terminal goes: a new pane on that side */
export type SplitSide = 'top' | 'bottom' | 'left' | 'right';

export type WebviewMessage =
  | { type: 'ready'; cols?: number; rows?: number }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  /** From a pane's + button, which opens the tab in that pane */
  | { type: 'newTab'; pane?: string }
  | { type: 'newTabWithProfile'; pane?: string }
  | { type: 'newTabWithCommand' }
  | { type: 'closeTab'; id: string }
  | { type: 'switchTab'; id: string }
  /** A tab was dragged to a 0-based position in a pane's tab strip, by default its own */
  | { type: 'moveTab'; id: string; index: number; pane?: string }
  /** A tab was dropped on the top or bottom of a pane's terminal */
  | { type: 'splitTab'; id: string; pane: string; side: SplitSide }
  /** The user clicked into a pane */
  | { type: 'focusPane'; pane: string }
  /** The user dragged an edge between the children of a split; their sizes in order */
  | { type: 'resizeSplit'; split: string; sizes: number[] }
  | { type: 'openFile'; id: string; path: string; line?: number; column?: number }
  | { type: 'openLink'; url: string }
  | { type: 'focus'; focused: boolean };

export type ExtensionMessage =
  | { type: 'output'; id: string; data: string }
  | { type: 'clear'; id: string }
  | { type: 'tabsUpdate'; layout: LayoutInfo; statusColors: boolean; monochromeIcons: boolean }
  | { type: 'createTab'; id: string }
  /** Focuses the tab's terminal, which the last `tabsUpdate` shows in its pane */
  | { type: 'switchTab'; id: string }
  | { type: 'removeTab'; id: string }
  /** The terminal font from `terminal.integrated.*`, or the editor's */
  | { type: 'appearance'; fontSize: number; fontFamily?: string; lineHeight: number };

export type WebviewIncomingMessage = ExtensionMessage;
export type WebviewOutgoingMessage = WebviewMessage;
