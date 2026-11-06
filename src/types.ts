// Muted but distinct workspace accent colors
export const WORKSPACE_ACCENT_COLORS = [
  '#6b9ac4', // Muted blue
  '#82b366', // Muted green
  '#c4a46b', // Muted gold
  '#b36b82', // Muted rose
  '#9b82b3', // Muted purple
  '#6bc4b3', // Muted teal
  '#c47a6b', // Muted coral
  '#7a8c9e' // Muted steel
] as const;

// node-pty types
export interface IPty {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface INodePty {
  spawn: (
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string | undefined>;
    }
  ) => IPty;
}

// Configuration
export type OnExitAction = 'auto' | 'close' | 'restart' | 'keep';

/** Program Status Protocol (OSC 7501) states reported by agents such as pi */
export type ProgramState = 'idle' | 'working' | 'blocked' | 'done' | 'error';

/** Status shown on a tab */
export type TabStatus = 'working' | 'blocked' | 'done' | 'error';

/** Agents the extension knows: logo, title format and status options */
export type AgentId = 'pi' | 'claude' | 'codex';

/** An entry of `agentTerminal.profiles` as configured */
export interface ProfileConfig {
  id: string;
  label?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** What a tab runs; reused when the tab restarts */
export interface LaunchSpec {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Built-in agent, which selects the logo and how the terminal title is read */
  agent?: AgentId;
}

/** A validated profile; the first one opens with the + button */
export interface Profile extends LaunchSpec {
  id: string;
}

export interface TerminalConfig {
  autoRun: boolean;
  shell: string;
  env: Record<string, string>;
  directMode: boolean;
  onExit: OnExitAction;
  programStatus: boolean;
  autoTabTitles: boolean;
  monochromeIcons: boolean;
  statusColors: boolean;
  /** Never empty */
  profiles: Profile[];
}

// Terminal instance for multi-tab support
export interface TerminalInstance {
  id: string;
  pty: IPty | undefined;
  isActive: boolean;
  workspaceFolderIndex?: number;
  isWaitingForInput?: boolean;
  cwd?: string;
  launch: LaunchSpec;
  /** Short label from the terminal title, e.g. Claude Code's conversation summary */
  titleLabel?: string;
  /** The process ended and the tab waits for Enter (restart) or Esc (close) */
  exited?: boolean;
  /** The program reported its state through OSC 7501 */
  reportsStatus?: boolean;
  programState?: ProgramState;
  statusMessage?: string;
  /** Waiting for an answer the agent did not report, e.g. a dialog that rang the bell */
  needsInput?: boolean;
  /** Last OSC 9 notification since the current run started */
  lastNotification?: string;
  /** A run finished while the tab was not in view */
  unseen?: 'done' | 'error';
}

// Tab information for UI
export interface TabInfo {
  id: string;
  label: string;
  /** Built-in agent, shown as its logo before the label */
  agent?: AgentId;
  isActive: boolean;
  accentColor?: string;
  status?: TabStatus;
  /** `Needs input: approve Bash`, for the tooltip and screen readers */
  statusText?: string;
}

// Webview message types (from webview to extension)
export type WebviewMessage =
  | { type: 'ready'; cols?: number; rows?: number }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'newTab' }
  | { type: 'newTabWithCommand' }
  | { type: 'closeTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'openFile'; id: string; path: string; line?: number; column?: number }
  | { type: 'focus'; focused: boolean };

// Extension message types (from extension to webview)
export type ExtensionMessage =
  | { type: 'output'; id: string; data: string }
  | { type: 'clear'; id: string }
  | { type: 'tabsUpdate'; tabs: TabInfo[]; monochromeIcons: boolean; statusColors: boolean }
  | { type: 'createTab'; id: string }
  | { type: 'switchTab'; id: string }
  | { type: 'removeTab'; id: string };

// Command help parsing types
export interface CommandFlag {
  flag: string;
  shortFlag?: string;
  description: string;
  takesValue?: boolean;
  valueHint?: string;
  repeatable?: boolean;
}

export interface ParsedHelp {
  command: string;
  flags: CommandFlag[];
  subcommands?: string[];
  parseErrors?: string[];
}

// Path autocomplete types
export type PathFilterMode = 'all' | 'files' | 'directories';

export interface PathSuggestion {
  /** Display name (e.g., "package.json") */
  name: string;
  /** Full path to suggest (relative or absolute) */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
}

export interface PathContext {
  /** Whether we're in path completion mode */
  active: boolean;
  /** The partial path typed so far (e.g., "src/comp") */
  partialPath: string;
  /** Filter mode based on valueHint */
  filterMode: PathFilterMode;
  /** Whether to show absolute paths (user typed leading /) */
  isAbsolute: boolean;
  /** The flag being completed */
  flag: CommandFlag;
}
