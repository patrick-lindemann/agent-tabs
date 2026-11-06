import { Terminal, type ILinkProvider, type ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type {
  VSCodeAPI,
  WebviewIncomingMessage,
  WebviewOutgoingMessage,
  TabInfo,
  TerminalEntry,
  XTermTheme
} from './types';

// File path link provider for terminal
class FileLinkProvider implements ILinkProvider {
  // Regex to match file paths with optional :line:column
  // Matches: /path/file.ts, ./file.ts, src/file.ts:10:5, ~/file.ts
  // Also matches extensionless files: Makefile, Dockerfile, src/Makefile
  private static readonly FILE_PATH_REGEX =
    /(?:^|[\s"'`([{])([.~]?\/[\w./-]+(?:\.[a-zA-Z0-9]+)?|[\w.-]+\/[\w./-]+(?:\.[a-zA-Z0-9]+)?)(?::(\d+))?(?::(\d+))?/g;

  // Common extensionless files that should be recognized
  private static readonly EXTENSIONLESS_FILES = new Set([
    'Makefile',
    'Dockerfile',
    'Containerfile',
    'Vagrantfile',
    'Procfile',
    'Gemfile',
    'Rakefile',
    'Brewfile',
    'Justfile',
    'Taskfile',
    'Earthfile',
    'CMakeLists',
    'GNUmakefile',
    'BSDmakefile'
  ]);

  constructor(
    private readonly terminal: Terminal,
    private readonly terminalId: string,
    private readonly postMessage: (msg: WebviewOutgoingMessage) => void
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const lineText = line.translateToString();
    const links: ILink[] = [];

    // Reset regex state
    FileLinkProvider.FILE_PATH_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = FileLinkProvider.FILE_PATH_REGEX.exec(lineText)) !== null) {
      const fullMatch = match[0];
      const path = match[1];
      const lineNum = match[2] ? parseInt(match[2], 10) : undefined;
      const column = match[3] ? parseInt(match[3], 10) : undefined;

      // Skip paths without extensions unless they're known extensionless files
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
      if (!hasExtension) {
        const filename = path.split('/').pop() ?? '';
        if (!FileLinkProvider.EXTENSIONLESS_FILES.has(filename)) {
          continue;
        }
      }

      // Calculate the start position (skip leading whitespace/quotes captured)
      const pathStart = match.index + fullMatch.indexOf(path);
      const pathEnd =
        pathStart +
        path.length +
        (match[2] ? `:${match[2]}`.length : 0) +
        (match[3] ? `:${match[3]}`.length : 0);

      links.push({
        range: {
          start: { x: pathStart + 1, y: bufferLineNumber },
          end: { x: pathEnd + 1, y: bufferLineNumber }
        },
        text: path,
        activate: () => {
          this.postMessage({
            type: 'openFile',
            id: this.terminalId,
            path,
            line: lineNum,
            column
          });
        }
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}

// State management class replacing closure variables
class TerminalState {
  private readonly terminals = new Map<string, TerminalEntry>();
  private activeTerminalId: string | null = null;

  get(id: string): TerminalEntry | undefined {
    return this.terminals.get(id);
  }

  set(id: string, entry: TerminalEntry): void {
    this.terminals.set(id, entry);
  }

  delete(id: string): boolean {
    return this.terminals.delete(id);
  }

  forEach(callback: (entry: TerminalEntry, id: string) => void): void {
    this.terminals.forEach(callback);
  }

  getActiveId(): string | null {
    return this.activeTerminalId;
  }

  setActiveId(id: string | null): void {
    this.activeTerminalId = id;
  }
}

// Theme and font builder with caching
class ThemeBuilder {
  private cachedTheme: XTermTheme | null = null;
  private cachedFontFamily: string | null = null;

  private static readonly DEFAULT_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

  private getCssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  getFontFamily(): string {
    if (this.cachedFontFamily) {
      return this.cachedFontFamily;
    }

    // Read VSCode's editor font family from CSS variable
    const editorFont = this.getCssVar('--vscode-editor-font-family', '');
    this.cachedFontFamily = editorFont || ThemeBuilder.DEFAULT_FONT_FAMILY;

    return this.cachedFontFamily;
  }

  getTheme(): XTermTheme {
    if (this.cachedTheme) {
      return this.cachedTheme;
    }

    this.cachedTheme = {
      background: this.getCssVar(
        '--vscode-terminal-background',
        this.getCssVar('--vscode-editor-background', '#1e1e1e')
      ),
      foreground: this.getCssVar(
        '--vscode-terminal-foreground',
        this.getCssVar('--vscode-editor-foreground', '#d4d4d4')
      ),
      cursor: this.getCssVar('--vscode-terminalCursor-foreground', '#d4d4d4'),
      cursorAccent: this.getCssVar('--vscode-terminalCursor-background', '#1e1e1e'),
      selectionBackground: this.getCssVar('--vscode-terminal-selectionBackground', '#264f78'),
      black: this.getCssVar('--vscode-terminal-ansiBlack', '#000000'),
      red: this.getCssVar('--vscode-terminal-ansiRed', '#cd3131'),
      green: this.getCssVar('--vscode-terminal-ansiGreen', '#0dbc79'),
      yellow: this.getCssVar('--vscode-terminal-ansiYellow', '#e5e510'),
      blue: this.getCssVar('--vscode-terminal-ansiBlue', '#2472c8'),
      magenta: this.getCssVar('--vscode-terminal-ansiMagenta', '#bc3fbc'),
      cyan: this.getCssVar('--vscode-terminal-ansiCyan', '#11a8cd'),
      white: this.getCssVar('--vscode-terminal-ansiWhite', '#e5e5e5'),
      brightBlack: this.getCssVar('--vscode-terminal-ansiBrightBlack', '#666666'),
      brightRed: this.getCssVar('--vscode-terminal-ansiBrightRed', '#f14c4c'),
      brightGreen: this.getCssVar('--vscode-terminal-ansiBrightGreen', '#23d18b'),
      brightYellow: this.getCssVar('--vscode-terminal-ansiBrightYellow', '#f5f543'),
      brightBlue: this.getCssVar('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
      brightMagenta: this.getCssVar('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
      brightCyan: this.getCssVar('--vscode-terminal-ansiBrightCyan', '#29b8db'),
      brightWhite: this.getCssVar('--vscode-terminal-ansiBrightWhite', '#ffffff')
    };

    return this.cachedTheme;
  }

  invalidateCache(): void {
    this.cachedTheme = null;
    this.cachedFontFamily = null;
  }
}

// Scroll management for terminal viewport
class ScrollManager {
  static isAtBottom(terminal: InstanceType<typeof Terminal>): boolean {
    const buffer = terminal.buffer.active;
    return buffer.viewportY >= buffer.baseY - 1;
  }

  static setupScrollTracking(entry: TerminalEntry): void {
    entry.terminal.onScroll(() => {
      entry.isAtBottom = this.isAtBottom(entry.terminal);
    });

    const viewport = entry.element.querySelector('.xterm-viewport') as HTMLElement;
    if (viewport) {
      viewport.addEventListener(
        'scroll',
        () => {
          entry.lastScrollTop = viewport.scrollTop;
          entry.isAtBottom = this.isAtBottom(entry.terminal);
        },
        { passive: true }
      );
    }
  }
}

// Handler registry pattern for message handling
type MessageHandler<T extends WebviewIncomingMessage> = (message: T, ctx: WebviewContext) => void;

interface MessageHandlers {
  output: MessageHandler<Extract<WebviewIncomingMessage, { type: 'output' }>>;
  clear: MessageHandler<Extract<WebviewIncomingMessage, { type: 'clear' }>>;
  tabsUpdate: MessageHandler<Extract<WebviewIncomingMessage, { type: 'tabsUpdate' }>>;
  createTab: MessageHandler<Extract<WebviewIncomingMessage, { type: 'createTab' }>>;
  switchTab: MessageHandler<Extract<WebviewIncomingMessage, { type: 'switchTab' }>>;
  removeTab: MessageHandler<Extract<WebviewIncomingMessage, { type: 'removeTab' }>>;
}

const messageHandlers: MessageHandlers = {
  output: (message, ctx) => {
    const t = ctx.state.get(message.id);
    if (t) {
      const wasAtBottom = ScrollManager.isAtBottom(t.terminal);
      t.terminal.write(message.data);
      if (wasAtBottom) {
        requestAnimationFrame(() => t.terminal.scrollToBottom());
      }
    }
  },
  clear: (message, ctx) => {
    const t = ctx.state.get(message.id);
    if (t) {
      t.terminal.clear();
      t.isAtBottom = true;
      t.lastScrollTop = 0;
    }
  },
  tabsUpdate: (message, ctx) => {
    ctx.renderTabBar(message.tabs, message.statusColors);
  },
  createTab: (message, ctx) => {
    ctx.createTerminalElement(message.id);
  },
  switchTab: (message, ctx) => {
    ctx.switchToTerminal(message.id);
  },
  removeTab: (message, ctx) => {
    ctx.removeTerminal(message.id);
  }
};

const IS_MAC = navigator.platform.toUpperCase().includes('MAC');

/**
 * Sequences for keys that xterm.js does not encode the way shells and agents
 * expect. Except for Shift/Option+Enter, these are VS Code's built-in
 * `workbench.action.terminal.sendSequence` keybindings (VS Code 1.144, without
 * the shell-specific ones). VS Code applies them only to its own terminal, so
 * the webview applies them itself. Keys read `[Ctrl+][Alt+][Shift+][Meta+]code`.
 */
const KEY_SEQUENCES: Record<string, string> = {
  'Shift+Enter': '\x1b[13;2u',
  'Alt+Enter': '\x1b\r',
  'Alt+ArrowUp': '\x1b[1;5A',
  'Alt+ArrowDown': '\x1b[1;5B',
  'Ctrl+Alt+KeyG': '\x07',
  'Ctrl+Shift+Digit2': '\x00',
  'Ctrl+Shift+Digit6': '\x1e',
  ...(IS_MAC
    ? {
        'Ctrl+KeyC': '\x03',
        'Meta+ArrowLeft': '\x01',
        'Meta+ArrowRight': '\x05',
        'Meta+Backspace': '\x15',
        'Alt+Backspace': '\x17',
        'Alt+Delete': '\x1bd'
      }
    : {
        'Meta+KeyC': '\x03',
        'Ctrl+Backspace': '\x17',
        'Ctrl+Delete': '\x1bd'
      })
};

/**
 * Status icons, readable by shape without color or motion. Except for the
 * working dots, they are VS Code's Codicons (CC BY 4.0,
 * https://github.com/microsoft/vscode-codicons), so they match the warning
 * and error icons elsewhere in VS Code.
 */
const STATUS_ICONS: Record<NonNullable<TabInfo['status']>, string> = {
  working:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle fill="currentColor" cx="3.5" cy="8" r="1.5"/><circle fill="currentColor" cx="8" cy="8" r="1.5"/><circle fill="currentColor" cx="12.5" cy="8" r="1.5"/></svg>',
  // codicon `warning`
  blocked:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M14.831 11.965L9.206 1.714C8.965 1.274 8.503 1 8 1C7.497 1 7.035 1.274 6.794 1.714L1.169 11.965C1.059 12.167 1 12.395 1 12.625C1 13.383 1.617 14 2.375 14H13.625C14.383 14 15 13.383 15 12.625C15 12.395 14.941 12.167 14.831 11.965ZM13.625 13H2.375C2.168 13 2 12.832 2 12.625C2 12.561 2.016 12.5 2.046 12.445L7.671 2.195C7.736 2.075 7.863 2 8 2C8.137 2 8.264 2.075 8.329 2.195L13.954 12.445C13.984 12.501 14 12.561 14 12.625C14 12.832 13.832 13 13.625 13ZM8.75 11.25C8.75 11.664 8.414 12 8 12C7.586 12 7.25 11.664 7.25 11.25C7.25 10.836 7.586 10.5 8 10.5C8.414 10.5 8.75 10.836 8.75 11.25ZM7.5 9V5.5C7.5 5.224 7.724 5 8 5C8.276 5 8.5 5.224 8.5 5.5V9C8.5 9.276 8.276 9.5 8 9.5C7.724 9.5 7.5 9.276 7.5 9Z"/></svg>',
  // codicon `check`
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/></svg>',
  // codicon `error`
  error:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1C4.14 1 1 4.14 1 8C1 11.86 4.14 15 8 15C11.86 15 15 11.86 15 8C15 4.14 11.86 1 8 1ZM8 14C4.691 14 2 11.309 2 8C2 4.691 4.691 2 8 2C11.309 2 14 4.691 14 8C14 11.309 11.309 14 8 14ZM10.854 5.854L8.708 8L10.854 10.146C11.049 10.341 11.049 10.658 10.854 10.853C10.756 10.951 10.628 10.999 10.5 10.999C10.372 10.999 10.244 10.95 10.146 10.853L8 8.707L5.854 10.853C5.756 10.951 5.628 10.999 5.5 10.999C5.372 10.999 5.244 10.95 5.146 10.853C4.951 10.658 4.951 10.341 5.146 10.146L7.292 8L5.146 5.854C4.951 5.659 4.951 5.342 5.146 5.147C5.341 4.952 5.658 4.952 5.853 5.147L7.999 7.293L10.145 5.147C10.34 4.952 10.657 4.952 10.852 5.147C11.047 5.342 11.047 5.659 10.852 5.854H10.854Z"/></svg>'
};

/** Idle: the dimmed codicon `sparkle`, so labels line up with tabs that show a status */
const IDLE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM4.00746 6.26448L3.15246 5.99948L4.01646 5.71848C4.41071 5.58184 4.76826 5.35637 5.06146 5.05948C5.35281 4.76039 5.57294 4.39943 5.70546 4.00348L5.97046 3.14448L6.25046 4.00648C6.38349 4.40638 6.60809 4.76969 6.90636 5.06744C7.20463 5.36519 7.56833 5.58915 7.96846 5.72148L8.84846 5.99048L7.98746 6.27048C7.58707 6.40272 7.22321 6.62691 6.92505 6.92507C6.62689 7.22324 6.4027 7.58709 6.27046 7.98748L6.00546 8.84448L5.72646 7.98548C5.63026 7.69329 5.48483 7.41968 5.29646 7.17648C5.22699 7.08766 5.15254 7.00286 5.07346 6.92248C4.7738 6.62366 4.4089 6.39842 4.00746 6.26448ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515ZM9.62035 11.0585L9.44235 10.9995L9.62635 10.9355C9.92811 10.8305 10.2018 10.6578 10.4264 10.4305C10.6528 10.2015 10.8238 9.92374 10.9264 9.61848L10.9844 9.44048L11.0434 9.62148C11.1453 9.92819 11.3175 10.2069 11.5461 10.4353C11.7748 10.6638 12.0536 10.8357 12.3604 10.9375L12.5554 11.0005L12.3754 11.0595C12.068 11.1617 11.7888 11.3344 11.5601 11.5637C11.3314 11.7931 11.1596 12.0728 11.0584 12.3805L10.9994 12.5615L10.9414 12.3805C10.84 12.0721 10.6676 11.7919 10.4382 11.5623C10.2088 11.3326 9.92863 11.1601 9.62035 11.0585Z"/></svg>';

const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>';

/**
 * Keys bound to Agent Terminal commands (package.json `keybindings`, scoped to
 * the focused view). xterm.js ignores them so they only switch, open or close
 * tabs and are not also typed into the program.
 */
function isTabShortcut(event: KeyboardEvent): boolean {
  const { key, code, ctrlKey, metaKey, altKey, shiftKey } = event;
  const digit = /^Digit[1-9]$/.test(code);
  if (ctrlKey && !metaKey && !altKey && key === 'Tab') return true;
  if (IS_MAC) {
    return (
      (metaKey &&
        !ctrlKey &&
        !altKey &&
        !shiftKey &&
        (digit || code === 'KeyT' || code === 'KeyW')) ||
      (metaKey && altKey && !ctrlKey && !shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
    );
  }
  return (
    (altKey && !ctrlKey && !metaKey && !shiftKey && digit) ||
    (ctrlKey && !altKey && !metaKey && !shiftKey && (key === 'PageUp' || key === 'PageDown')) ||
    (ctrlKey && shiftKey && !altKey && !metaKey && (code === 'KeyT' || code === 'KeyW'))
  );
}

// Main webview context class
class WebviewContext {
  readonly state = new TerminalState();
  private readonly themeBuilder = new ThemeBuilder();
  private readonly vscode: VSCodeAPI;
  private readonly tabBar: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly scrollLeftButton: HTMLButtonElement;
  private readonly scrollRightButton: HTMLButtonElement;
  private readonly terminalsContainer: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private renderedActiveId: string | undefined;

  constructor() {
    this.vscode = acquireVsCodeApi();

    const tabBar = document.getElementById('tab-bar');
    const tabList = document.getElementById('tab-list');
    const scrollLeftButton = document.getElementById('tab-scroll-left');
    const scrollRightButton = document.getElementById('tab-scroll-right');
    const terminalsContainer = document.getElementById('terminals-container');

    if (!tabBar || !tabList || !scrollLeftButton || !scrollRightButton || !terminalsContainer) {
      throw new Error('Required DOM elements not found');
    }

    this.tabBar = tabBar;
    this.tabList = tabList;
    this.scrollLeftButton = scrollLeftButton as HTMLButtonElement;
    this.scrollRightButton = scrollRightButton as HTMLButtonElement;
    this.terminalsContainer = terminalsContainer;
  }

  initialize(): void {
    this.setupFocusTracking();
    this.setupTabScrolling();
    this.setupResizeObserver();
    this.setupMessageHandler();
    this.setupCleanup();
    this.signalReady();
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      const activeId = this.state.getActiveId();
      if (activeId) {
        const active = this.state.get(activeId);
        if (active) {
          const wasAtBottom = ScrollManager.isAtBottom(active.terminal);
          const viewport = active.element.querySelector('.xterm-viewport') as HTMLElement;
          const savedScrollTop = viewport?.scrollTop ?? 0;

          active.fitAddon.fit();

          requestAnimationFrame(() => {
            if (wasAtBottom) {
              active.terminal.scrollToBottom();
            } else if (viewport && savedScrollTop > 0) {
              viewport.scrollTop = savedScrollTop;
            }
            active.isAtBottom = wasAtBottom;
          });

          this.postMessage({
            type: 'resize',
            id: activeId,
            cols: active.terminal.cols,
            rows: active.terminal.rows
          });
        }
      }
    });
    this.resizeObserver.observe(this.terminalsContainer);
  }

  private setupMessageHandler(): void {
    window.addEventListener('message', (event: MessageEvent<WebviewIncomingMessage>) => {
      const message = event.data;
      const handler = messageHandlers[message.type] as MessageHandler<typeof message> | undefined;
      if (handler) {
        handler(message, this);
      }
    });
  }

  /**
   * Reports focus for the `agentTerminal.focused` context key. When the view
   * gains focus, e.g. after Switch Tab… or a tab shortcut, keyboard input
   * goes to the active terminal instead of the page.
   */
  private setupFocusTracking(): void {
    window.addEventListener('focus', () => {
      this.postMessage({ type: 'focus', focused: true });
      this.focusActiveTerminal();
    });
    window.addEventListener('blur', () => this.postMessage({ type: 'focus', focused: false }));
    if (document.hasFocus()) {
      this.postMessage({ type: 'focus', focused: true });
    }
  }

  private focusActiveTerminal(): void {
    const activeId = this.state.getActiveId();
    const active = activeId ? this.state.get(activeId) : undefined;
    if (active && !active.element.contains(document.activeElement)) {
      active.terminal.focus();
    }
  }

  private setupCleanup(): void {
    window.addEventListener('unload', () => {
      this.resizeObserver?.disconnect();
      this.state.forEach((t) => {
        t.terminal.dispose();
      });
    });
  }

  private signalReady(): void {
    const { cols, rows } = this.measureInitialDimensions();
    this.postMessage({ type: 'ready', cols, rows });
  }

  private measureInitialDimensions(): { cols: number; rows: number } {
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText =
      'position: absolute; visibility: hidden; width: calc(100% - 20px); height: calc(100% - 37px);';
    document.body.appendChild(tempContainer);

    const tempTerminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: this.themeBuilder.getFontFamily(),
      lineHeight: 1.2
    });
    const tempFitAddon = new FitAddon();
    tempTerminal.loadAddon(tempFitAddon);
    tempTerminal.open(tempContainer);
    tempFitAddon.fit();

    const cols = tempTerminal.cols;
    const rows = tempTerminal.rows;

    tempTerminal.dispose();
    tempContainer.remove();

    return { cols, rows };
  }

  postMessage(message: WebviewOutgoingMessage): void {
    this.vscode.postMessage(message);
  }

  /**
   * Browser-style tab strip above the terminal. Tabs share its width and
   * scroll sideways once they reach their minimum width.
   */
  renderTabBar(tabsList: TabInfo[], statusColors: boolean): void {
    this.tabList.replaceChildren(...tabsList.map((tab) => this.createTabElement(tab)));
    this.tabBar.classList.toggle('status-colors', statusColors);

    const activeId = tabsList.find((tab) => tab.isActive)?.id;
    const activeChanged = activeId !== this.renderedActiveId;
    this.renderedActiveId = activeId;

    requestAnimationFrame(() => {
      if (activeChanged) {
        this.tabList
          .querySelector('.tab.active')
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.updateScrollButtons();
    });
  }

  private createTabElement(tab: TabInfo): HTMLDivElement {
    const tabElement = document.createElement('div');
    tabElement.className = `tab ${tab.isActive ? 'active' : ''}`;
    tabElement.dataset.id = tab.id;
    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', String(tab.isActive));
    tabElement.setAttribute(
      'aria-label',
      tab.statusText ? `${tab.label}, ${tab.statusText}` : tab.label
    );
    // The full title and the status, since the label is a short key
    tabElement.title = [tab.description, tab.statusText].filter(Boolean).join('\n');
    if (tab.status) {
      tabElement.dataset.status = tab.status;
    }
    if (tab.accentColor) {
      tabElement.style.setProperty('--tab-accent', tab.accentColor);
    }
    // Read by VS Code for the `webview/context` menu (Close, Close Others)
    tabElement.dataset.vscodeContext = JSON.stringify({
      webviewSection: 'tab',
      terminalId: tab.id,
      preventDefaultContextMenuItems: true
    });

    const status = document.createElement('span');
    status.className = 'tab-status';
    status.innerHTML = tab.status ? STATUS_ICONS[tab.status] : IDLE_ICON;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label;

    const closeButton = document.createElement('button');
    closeButton.className = 'tab-close';
    closeButton.title = 'Close';
    closeButton.innerHTML = CLOSE_ICON;
    closeButton.onmousedown = (e) => {
      // Keep focus in the terminal instead of the button
      e.preventDefault();
    };
    closeButton.onclick = (e) => {
      e.stopPropagation();
      this.postMessage({ type: 'closeTab', id: tab.id });
    };

    tabElement.onclick = () => {
      if (tab.isActive) {
        this.focusActiveTerminal();
      } else {
        this.postMessage({ type: 'switchTab', id: tab.id });
      }
    };

    // Middle-click closes, like editor tabs
    tabElement.onauxclick = (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.postMessage({ type: 'closeTab', id: tab.id });
      }
    };

    tabElement.append(status, label, closeButton);
    return tabElement;
  }

  /**
   * The strip scrolls sideways with the mouse wheel or trackpad and with the
   * arrow buttons, which only appear while tabs overflow.
   */
  private setupTabScrolling(): void {
    this.tabList.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          this.tabList.scrollLeft += event.deltaY;
        }
      },
      { passive: false }
    );
    this.tabList.addEventListener('scroll', () => this.updateScrollButtons(), { passive: true });
    new ResizeObserver(() => this.updateScrollButtons()).observe(this.tabList);

    const scrollByTab = (direction: number) => {
      const tabWidth = this.tabList.querySelector('.tab')?.clientWidth ?? 100;
      this.tabList.scrollBy({ left: direction * tabWidth, behavior: 'smooth' });
    };
    this.scrollLeftButton.onclick = () => scrollByTab(-1);
    this.scrollRightButton.onclick = () => scrollByTab(1);
  }

  /** Shows the scroll buttons while tabs overflow */
  private updateScrollButtons(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.tabList;
    const overflowing = scrollWidth > clientWidth + 1;
    this.tabBar.classList.toggle('overflowing', overflowing);
    this.scrollLeftButton.disabled = scrollLeft <= 0;
    this.scrollRightButton.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
  }

  createTerminalElement(id: string): TerminalEntry {
    const container = document.createElement('div');
    container.className = 'terminal-wrapper';
    container.id = `terminal-${id}`;
    container.style.display = 'none';
    this.terminalsContainer.appendChild(container);

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: this.themeBuilder.getFontFamily(),
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: this.themeBuilder.getTheme(),
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    // Register file path link provider
    const fileLinkProvider = new FileLinkProvider(terminal, id, this.postMessage.bind(this));
    terminal.registerLinkProvider(fileLinkProvider);

    const entry: TerminalEntry = {
      terminal,
      fitAddon,
      element: container,
      isAtBottom: true,
      lastScrollTop: 0
    };

    terminal.attachCustomKeyEventHandler((event) => this.handleKeyEvent(terminal, id, event));

    terminal.onData((data) => {
      entry.isAtBottom = true;
      this.postMessage({ type: 'input', id, data });
    });

    ScrollManager.setupScrollTracking(entry);
    this.state.set(id, entry);

    return entry;
  }

  /**
   * Handles keys that xterm.js cannot encode for CLI agents or that VS Code's
   * webview host intercepts before they reach the terminal.
   *
   * - Keys in `KEY_SEQUENCES` send their sequence, e.g. Cmd+Left `Ctrl+A`
   *   like VS Code's terminal, and Shift+Enter the CSI-u sequence
   *   `ESC [13;2u`, so agents such as pi can tell it apart from Enter.
   * - Cmd+C / Cmd+V use the clipboard directly. The VS Code webview host
   *   cancels the native copy/paste events on desktop, so without this they
   *   silently do nothing in the terminal.
   *
   * Handled events stop propagating so VS Code does not run a second action
   * for the same keystroke.
   */
  private handleKeyEvent(terminal: Terminal, id: string, event: KeyboardEvent): boolean {
    // Let the event reach VS Code's keybindings without typing it
    if (isTabShortcut(event)) {
      return false;
    }

    const sequence = this.getKeySequence(event);
    const isClipboardKey =
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (event.code === 'KeyC' || event.code === 'KeyV');

    if (sequence === undefined && !isClipboardKey) {
      return true;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'keydown') {
      return false;
    }

    if (sequence !== undefined) {
      this.postMessage({ type: 'input', id, data: sequence });
    } else if (event.code === 'KeyC') {
      if (terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection());
      }
    } else {
      void navigator.clipboard.readText().then((text) => {
        if (text) {
          terminal.paste(text);
        }
      });
    }
    return false;
  }

  private getKeySequence(event: KeyboardEvent): string | undefined {
    const { ctrlKey, altKey, shiftKey, metaKey, code } = event;
    return KEY_SEQUENCES[
      `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}${code}`
    ];
  }

  switchToTerminal(id: string): void {
    this.state.forEach((t, tid) => {
      t.element.style.display = tid === id ? 'block' : 'none';
    });

    this.state.setActiveId(id);

    const active = this.state.get(id);
    if (active) {
      const wasAtBottom = active.isAtBottom;
      const savedScrollTop = active.lastScrollTop;

      // Double RAF ensures browser has completed layout after display change
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          active.fitAddon.fit();
          active.terminal.focus();

          requestAnimationFrame(() => {
            if (wasAtBottom) {
              active.terminal.scrollToBottom();
            } else {
              const viewport = active.element.querySelector('.xterm-viewport') as HTMLElement;
              if (viewport && savedScrollTop > 0) {
                viewport.scrollTop = savedScrollTop;
              }
            }
          });

          this.postMessage({
            type: 'resize',
            id,
            cols: active.terminal.cols,
            rows: active.terminal.rows
          });
        });
      });
    }
  }

  removeTerminal(id: string): void {
    const t = this.state.get(id);
    if (t) {
      t.terminal.dispose();
      t.element.remove();
      this.state.delete(id);
    }
  }
}

// Entry point
(function () {
  try {
    const ctx = new WebviewContext();
    ctx.initialize();
  } catch (error) {
    console.error('Failed to initialize webview:', error);
  }
})();
