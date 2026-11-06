import { Terminal, type ILinkProvider, type ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import piIcon from './icons/pi.svg';
import claudeIcon from './icons/claude.svg';
import codexIcon from './icons/codex.svg';
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
    ctx.renderTabBar(message.tabs, message.monochromeIcons, message.statusColors);
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
 * Agent logos shown before tab labels (media/icons):
 * - pi: https://pi.dev/logo-auto.svg
 * - Claude: Simple Icons (CC0-1.0), in Claude's brand color
 * - Codex: Lobe Icons (MIT), drawn in the tab's text color
 */
const AGENT_ICONS: Record<NonNullable<TabInfo['agent']>, string> = {
  pi: piIcon,
  claude: claudeIcon,
  codex: codexIcon
};

// Generic terminal icon for commands without a built-in agent profile
const TERMINAL_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11l.5-.5zM2 13h12V3H2v10zm2.15-7.15L6.29 8 4.15 10.15l.7.7 2.5-2.5v-.7l-2.5-2.5-.7.7zM8 10h4v1H8v-1z"/></svg>';

/** Status icons, readable by shape without color or motion */
const STATUS_ICONS: Record<NonNullable<TabInfo['status']>, string> = {
  working:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle fill="currentColor" cx="3.5" cy="8" r="1.5"/><circle fill="currentColor" cx="8" cy="8" r="1.5"/><circle fill="currentColor" cx="12.5" cy="8" r="1.5"/></svg>',
  blocked:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.1 2.5h1.8l-.3 7.5H7.4l-.3-7.5zM8 11.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>',
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 3.9l1.1 1.1-8 8L2 8.5l1.1-1.1 3.4 3.4z"/></svg>',
  error:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4zM5.9 5l2.1 2.1L10.1 5l.9.9L8.9 8l2.1 2.1-.9.9L8 8.9 5.9 11l-.9-.9L7.1 8 5 5.9z"/></svg>'
};

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
  renderTabBar(tabsList: TabInfo[], monochromeIcons: boolean, statusColors: boolean): void {
    this.tabList.replaceChildren(...tabsList.map((tab) => this.createTabElement(tab)));
    this.tabBar.classList.toggle('monochrome-icons', monochromeIcons);
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
      this.updateTabOverflow();
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
    if (tab.statusText) {
      tabElement.dataset.statusText = tab.statusText;
    }
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

    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = tab.agent ? AGENT_ICONS[tab.agent] : TERMINAL_ICON;

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

    // Status and close share a slot; hovering shows the close button
    const slot = document.createElement('span');
    slot.className = 'tab-slot';
    if (tab.status) {
      const status = document.createElement('span');
      status.className = 'tab-status';
      status.innerHTML = STATUS_ICONS[tab.status];
      slot.append(status);
    }
    slot.append(closeButton);

    tabElement.append(icon, label, slot);
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
    new ResizeObserver(() => this.updateTabOverflow()).observe(this.tabList);

    const scrollByTab = (direction: number) => {
      const tabWidth = this.tabList.querySelector('.tab')?.clientWidth ?? 100;
      this.tabList.scrollBy({ left: direction * tabWidth, behavior: 'smooth' });
    };
    this.scrollLeftButton.onclick = () => scrollByTab(-1);
    this.scrollRightButton.onclick = () => scrollByTab(1);
  }

  /**
   * Shows the scroll buttons while tabs overflow. A tab's tooltip shows its
   * full label when it is cut off and its status, since hovering replaces
   * the status icon with the close button.
   */
  private updateTabOverflow(): void {
    for (const label of this.tabList.querySelectorAll<HTMLElement>('.tab-label')) {
      const tab = label.parentElement;
      if (!tab) continue;
      const truncated = label.scrollWidth > label.clientWidth;
      const tooltip = [truncated ? label.textContent : undefined, tab.dataset.statusText]
        .filter(Boolean)
        .join('\n');
      if (tooltip) {
        tab.title = tooltip;
      } else {
        tab.removeAttribute('title');
      }
    }
    this.updateScrollButtons();
  }

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
   * - Shift+Enter sends the CSI-u sequence `ESC [13;2u`, so agents such as pi
   *   can tell it apart from Enter (xterm.js sends `\r` for both).
   * - Option+Enter sends `ESC \r` (Alt+Enter).
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
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) {
      return undefined;
    }
    if (event.shiftKey && !event.altKey) {
      return '\x1b[13;2u';
    }
    if (event.altKey && !event.shiftKey) {
      return '\x1b\r';
    }
    return undefined;
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
