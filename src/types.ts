import type { AgentId, ProfileIcon } from './protocol';
import type { Draft } from './terminal/draft';
import type { MultiplexerId } from './terminal/multiplexer';

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
/** Ends a listener */
export interface IDisposable {
  dispose(): void;
}

export interface IPty {
  onData: (callback: (data: string) => void) => IDisposable;
  onExit: (callback: (exitCode: { exitCode: number; signal?: number }) => void) => IDisposable;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface INodePty {
  spawn: (
    file: string,
    /** On Windows also a ready command line, which node-pty passes on unchanged */
    args: string[] | string,
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

/** What a tab runs; reused when the tab restarts */
export interface LaunchSpec {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Built-in agent, which selects the logo and how the terminal title is read */
  agent?: AgentId;
  /** The profile's command line as configured, for menus */
  commandLine: string;
  /** The profile's own `multiplexer`, over `agentTabs.multiplexer` */
  multiplexer?: MultiplexerId | 'none';
  /**
   * The icon of the profile and its tabs: the profile's `icon`, or the
   * agent's logo, the terminal icon for a shell, else the sparkle
   */
  icon: ProfileIcon;
  /**
   * The name of the profile in `agentTabs.profiles` it comes from, so a
   * restored tab runs the profile as it is now; none for a custom command
   */
  profile?: string;
}

export interface TerminalConfig {
  autoRun: boolean;
  shell: string;
  env: Record<string, string>;
  directMode: boolean;
  onExit: OnExitAction;
  programStatus: boolean;
  autoTabTitles: boolean;
  tabTitleWords: number;
  statusColors: boolean;
  confirmClose: boolean;
  monochromeIcons: boolean;
  /** Reopen the tabs of the last window when the view opens */
  restoreTabs: boolean;
  /** Validated `agentTabs.profiles`, in menu order; never empty */
  profiles: LaunchSpec[];
  /** The profile + opens, from `agentTabs.defaultProfile`; one of `profiles` */
  defaultProfile: LaunchSpec;
  /** Multiplexer for profiles without their own */
  multiplexer: MultiplexerId | 'none';
}

// Terminal instance for multi-tab support
export interface TerminalInstance {
  id: string;
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
  /** The command that could not be found, while the tab shows the hint */
  missing?: string;
  /** The multiplexer session the tab shows, while one runs */
  session?: SessionRef;
  /** The client exited but the session runs on; Enter attaches again */
  detached?: boolean;
  /**
   * The agent's conversation, with an ID the extension chose, and whether a
   * message was sent in it, so the tab can be reopened after it closes
   */
  conversation?: { id: string; started: boolean };
  /** Characters typed since the last message; see `terminal/draft.ts` */
  draft?: Draft;
}

/** A closed tab that can be reopened with its conversation */
export interface ClosedTab {
  launch: LaunchSpec;
  conversation: string;
  cwd?: string;
  workspaceFolderIndex?: number;
}

/** An open tab, kept so the next window of the workspace opens it again */
export interface OpenTab {
  launch: LaunchSpec;
  cwd?: string;
  workspaceFolderIndex?: number;
  /** The conversation to continue, once a message was sent in it */
  conversation?: string;
  /** The multiplexer session the tab showed, to attach to it again */
  session?: string;
  /** The tab was the active one */
  active?: boolean;
}

/** A multiplexer session that runs a tab's program */
export interface SessionRef {
  multiplexer: MultiplexerId;
  name: string;
  /** When the session started, stored in its tag */
  created: number;
  /** The session's tag says that the conversation started */
  started?: boolean;
}

// Host/webview protocol is defined once in the platform-neutral shared module.
export type {
  AgentId,
  ExtensionMessage,
  ProfileIcon,
  TabInfo,
  TabStatus,
  WebviewMessage
} from './protocol';

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
