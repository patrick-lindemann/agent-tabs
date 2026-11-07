import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { type ILink, type ILinkProvider, Terminal } from '@xterm/xterm';
import { extractFileLinks } from './links';
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
} from './keys';
import type {
  TabInfo,
  TerminalEntry,
  VSCodeAPI,
  WebviewIncomingMessage,
  WebviewOutgoingMessage,
  XTermTheme
} from './types';


const IS_MAC = navigator.platform.toUpperCase().includes('MAC');

import { FileLinkProvider } from './links';
import { TerminalState } from './state';
import { ThemeBuilder } from './theme';
import { ScrollManager } from './scroll';
import { AGENT_ICONS, STATUS_ICONS, IDLE_ICON, CLOSE_ICON } from './icons';
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


export { WebviewContext };
