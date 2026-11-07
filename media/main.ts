import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { type ILink, type ILinkProvider, Terminal } from '@xterm/xterm';
import antigravityIcon from './icons/antigravity.svg';
import antigravityMonoIcon from './icons/antigravity-mono.svg';
import claudeIcon from './icons/claude.svg';
import claudeMonoIcon from './icons/claude-mono.svg';
import codexIcon from './icons/codex.svg';
import copilotIcon from './icons/copilot.svg';
import cursorIcon from './icons/cursor.svg';
import devinIcon from './icons/devin.svg';
import devinMonoIcon from './icons/devin-mono.svg';
import geminiIcon from './icons/gemini.svg';
import geminiMonoIcon from './icons/gemini-mono.svg';
import grokIcon from './icons/grok.svg';
import hermesIcon from './icons/hermes.svg';
import opencodeIcon from './icons/opencode.svg';
import piIcon from './icons/pi.svg';
import piMonoIcon from './icons/pi-mono.svg';
import {
  isTabShortcut as isTabShortcutForPlatform,
  keySequence as keySequenceForPlatform
} from './keybindings';
import type {
  TabInfo,
  TerminalEntry,
  VSCodeAPI,
  WebviewIncomingMessage,
  WebviewOutgoingMessage,
  XTermTheme
} from './types';

// File path link provider for terminal
class FileLinkProvider implements ILinkProvider {
  // Regex to match file paths with optional :line:column
  // Matches: /path/file.ts, ./file.ts, src/file.ts:10:5, ~/file.ts
  // Also matches extensionless files: Makefile, Dockerfile, src/Makefile
  private static readonly FILE_PATH_REGEX =
    /(?:^|[\s"'`([{])((?:[.~]?\/[\w./-]+|[a-zA-Z]:[\\/][\w.\\/-]+|\\\\[^\s"'`]+|[\w.-]+\/[\w./-]+)(?:\.[a-zA-Z0-9]+)?)(?::(\d+))?(?::(\d+))?/g;

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

    let match = FileLinkProvider.FILE_PATH_REGEX.exec(lineText);
    while (match !== null) {
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
      match = FileLinkProvider.FILE_PATH_REGEX.exec(lineText);
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

// biome-ignore lint/complexity/noStaticOnlyClass: Static grouping keeps scroll helpers namespaced.
class ScrollManager {
  static isAtBottom(terminal: InstanceType<typeof Terminal>): boolean {
    const buffer = terminal.buffer.active;
    return buffer.viewportY >= buffer.baseY - 1;
  }

  static setupScrollTracking(entry: TerminalEntry): void {
    entry.terminal.onScroll(() => {
      entry.isAtBottom = ScrollManager.isAtBottom(entry.terminal);
    });

    const viewport = entry.element.querySelector('.xterm-viewport') as HTMLElement;
    if (viewport) {
      viewport.addEventListener(
        'scroll',
        () => {
          entry.lastScrollTop = viewport.scrollTop;
          entry.isAtBottom = ScrollManager.isAtBottom(entry.terminal);
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
    ctx.renderTabBar(message.tabs, message.statusColors, message.monochromeIcons);
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
 * Agent logos (media/icons), from Lobe Icons (MIT,
 * https://github.com/lobehub/lobe-icons) except pi's (https://pi.dev). Each
 * has a version in its brand colors and one in the text color; logos without
 * brand colors only have the latter.
 */
const AGENT_ICONS: Record<NonNullable<TabInfo['agent']>, { color: string; mono: string }> = {
  claude: { color: claudeIcon, mono: claudeMonoIcon },
  codex: { color: codexIcon, mono: codexIcon },
  antigravity: { color: antigravityIcon, mono: antigravityMonoIcon },
  gemini: { color: geminiIcon, mono: geminiMonoIcon },
  opencode: { color: opencodeIcon, mono: opencodeIcon },
  pi: { color: piIcon, mono: piMonoIcon },
  cursor: { color: cursorIcon, mono: cursorIcon },
  copilot: { color: copilotIcon, mono: copilotIcon },
  grok: { color: grokIcon, mono: grokIcon },
  hermes: { color: hermesIcon, mono: hermesIcon },
  devin: { color: devinIcon, mono: devinMonoIcon }
};

/**
 * Sequences for keys that xterm.js does not encode the way shells and agents
 * expect. Except for Shift/Option+Enter, these are VS Code's built-in
 * `workbench.action.terminal.sendSequence` keybindings (VS Code 1.144, without
 * the shell-specific ones). VS Code applies them only to its own terminal, so
 * the webview applies them itself. Keys read `[Ctrl+][Alt+][Shift+][Meta+]code`.
 */
const _KEY_SEQUENCES: Record<string, string> = {
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
 * Status icons, readable by shape without color or motion. The check is VS
 * Code's Codicon (CC BY 4.0, https://github.com/microsoft/vscode-codicons).
 */
const STATUS_ICONS: Record<NonNullable<TabInfo['status']>, string> = {
  working:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle fill="currentColor" cx="3.5" cy="8" r="1.5"/><circle fill="currentColor" cx="8" cy="8" r="1.5"/><circle fill="currentColor" cx="12.5" cy="8" r="1.5"/></svg>',
  // `!` alone, without the triangle around it
  blocked:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.1 2.5h1.8l-.3 7.5H7.4l-.3-7.5zM8 11.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>',
  // codicon `check`
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/></svg>',
  // A bold `×`, heavier than the close button's
  error:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
};

/** Idle profiles without a known agent: the codicon `sparkle-filled` */
const IDLE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515Z"/></svg>';

const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>';

/**
 * Keys bound to SideMates commands (package.json `keybindings`, scoped to
 * the focused view). xterm.js ignores them so they only switch, open or close
 * tabs and are not also typed into the program.
 */
function _isTabShortcut(event: KeyboardEvent): boolean {
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
  renderTabBar(tabsList: TabInfo[], statusColors: boolean, monochromeIcons: boolean): void {
    this.tabList.replaceChildren(
      ...tabsList.map((tab) => this.createTabElement(tab, monochromeIcons))
    );
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

  private createTabElement(tab: TabInfo, monochromeIcons: boolean): HTMLDivElement {
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

    // The agent's logo, replaced by the status icon while there is a status
    const status = document.createElement('span');
    status.className = 'tab-status';
    if (tab.status) {
      status.innerHTML = STATUS_ICONS[tab.status];
    } else if (tab.agent) {
      status.classList.add('tab-logo');
      status.innerHTML = AGENT_ICONS[tab.agent][monochromeIcons ? 'mono' : 'color'];
    } else {
      status.innerHTML = IDLE_ICON;
    }

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

    // Split button like VS Code's terminal: + opens the first profile, ⌄ lists them
    const newTab = document.getElementById('new-tab-default');
    const newTabWithProfile = document.getElementById('new-tab-profile');
    for (const button of [newTab, newTabWithProfile]) {
      button?.addEventListener('mousedown', (event) => {
        // Keep focus in the terminal instead of the button
        event.preventDefault();
      });
    }
    newTab?.addEventListener('click', () => {
      this.postMessage({ type: 'newTab' });
    });
    newTabWithProfile?.addEventListener('click', () => {
      this.postMessage({ type: 'newTabWithProfile' });
    });
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
    if (isTabShortcutForPlatform(event, IS_MAC)) {
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
    return keySequenceForPlatform(event, IS_MAC);
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
(() => {
  try {
    const ctx = new WebviewContext();
    ctx.initialize();
  } catch (error) {
    console.error('Failed to initialize webview:', error);
  }
})();
