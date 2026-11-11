import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { isTabShortcut, keySequence } from './keys';
import { FileLinkProvider, parseFileTarget } from './links';
import { isAtBottom, trackScroll, viewportOf } from './scroll';
import { ThemeBuilder } from './theme';
import type { TerminalEntry, WebviewOutgoingMessage } from './types';

const IS_MAC = /Mac/i.test(
  (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ??
    navigator.userAgent
);

/** The xterm.js terminals, one per tab, of which only the active one is shown */
export class Terminals {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly theme = new ThemeBuilder();
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly stopWatchingTheme: () => void;
  private activeId: string | undefined;
  private font: { fontSize: number; fontFamily?: string; lineHeight: number } = {
    fontSize: 12,
    lineHeight: 1.2
  };

  constructor(private readonly post: (message: WebviewOutgoingMessage) => void) {
    const container = document.getElementById('terminals-container');
    if (!container) {
      throw new Error('Terminal container not found');
    }
    this.container = container;
    this.resizeObserver = new ResizeObserver(() => this.fitActive());
    this.resizeObserver.observe(container);
    this.stopWatchingTheme = this.theme.watch(() => this.applyAppearance());
  }

  /** Uses the terminal font VS Code is configured with */
  setFont(font: { fontSize: number; fontFamily?: string; lineHeight: number }): void {
    this.font = font;
    this.applyAppearance();
  }

  /**
   * Applies the current colors and font to every terminal, and tells the
   * programs that asked for it whether the scheme is light or dark now
   */
  private applyAppearance(): void {
    const theme = this.theme.getTheme();
    const options = this.options();
    const report = this.colorSchemeReport();
    for (const [id, entry] of this.entries) {
      const { terminal } = entry;
      const changed = terminal.options.theme?.background !== theme.background;
      terminal.options.theme = theme;
      terminal.options.fontSize = options.fontSize;
      terminal.options.fontFamily = options.fontFamily;
      terminal.options.lineHeight = options.lineHeight;
      if (changed && entry.colorSchemeReports) this.post({ type: 'input', id, data: report });
    }
    this.fitActive();
  }

  /** The answer to DSR 996: `CSI ? 997 ; 1 n` for dark, `2` for light */
  private colorSchemeReport(): string {
    return `\x1b[?997;${this.theme.isLight() ? 2 : 1}n`;
  }

  create(id: string): void {
    // A view that loaded again is sent the open tabs, which it may know already
    if (this.entries.has(id)) return;
    const element = document.createElement('div');
    element.className = 'terminal-wrapper';
    element.id = `terminal-${id}`;
    element.style.display = 'none';
    this.container.appendChild(element);

    // Webviews cannot open windows, so the extension opens links, like
    // VS Code's terminal does: URLs in the output and OSC 8 hyperlinks
    const openLink = (_event: MouseEvent, url: string) => {
      if (/^https?:\/\//i.test(url)) this.post({ type: 'openLink', url });
    };
    // OSC 8 hyperlinks may also point to files, e.g. pi's Markdown links to
    // `/path/file.ts#L10`; those open in the editor, like in VS Code's terminal
    const openHyperlink = (event: MouseEvent, url: string) => {
      if (/^https?:\/\//i.test(url)) return openLink(event, url);
      const file = parseFileTarget(url);
      if (file) this.post({ type: 'openFile', id, ...file });
    };
    const terminal = new Terminal({
      ...this.options(),
      letterSpacing: 0,
      theme: this.theme.getTheme(),
      linkHandler: { activate: openHyperlink, allowNonHttpProtocols: true }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon(openLink));
    terminal.open(element);
    terminal.registerLinkProvider(new FileLinkProvider(terminal, id, this.post));
    // Programs ask to be told when the color scheme changes (DECSET 2031),
    // e.g. pi to switch its own theme; xterm.js does not support it
    const toggleSchemeReports = (enabled: boolean) => (params: (number | number[])[]) => {
      if (!params.includes(2031)) return false;
      entry.colorSchemeReports = enabled;
      // Other modes in the same sequence still apply
      return params.length === 1;
    };
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, toggleSchemeReports(true));
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, toggleSchemeReports(false));
    // And query it (DSR 996), answered like a terminal that supports it
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) => {
      if (params[0] !== 996) return false;
      this.post({ type: 'input', id, data: this.colorSchemeReport() });
      return true;
    });

    const entry: TerminalEntry = {
      terminal,
      fitAddon,
      element,
      isAtBottom: true,
      lastScrollTop: 0,
      colorSchemeReports: false
    };
    terminal.attachCustomKeyEventHandler((event) => this.handleKey(terminal, id, event));
    terminal.onData((data) => {
      entry.isAtBottom = true;
      this.post({ type: 'input', id, data });
    });
    trackScroll(entry);
    this.entries.set(id, entry);
  }

  /** Writes output and keeps following it if the terminal was at the bottom */
  write(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const follow = isAtBottom(entry.terminal);
    entry.terminal.write(data);
    if (follow) {
      requestAnimationFrame(() => entry.terminal.scrollToBottom());
    }
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.terminal.clear();
    entry.isAtBottom = true;
    entry.lastScrollTop = 0;
  }

  show(id: string): void {
    for (const [entryId, entry] of this.entries) {
      entry.element.style.display = entryId === id ? 'block' : 'none';
    }
    this.activeId = id;

    const active = this.entries.get(id);
    if (!active) return;
    const { isAtBottom: follow, lastScrollTop } = active;
    // Double RAF ensures the browser has completed layout after the display change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        active.fitAddon.fit();
        active.terminal.focus();
        requestAnimationFrame(() => restoreScroll(active, follow, lastScrollTop));
        this.reportSize(id, active);
      });
    });
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.terminal.dispose();
    entry.element.remove();
    this.entries.delete(id);
  }

  /** Moves keyboard focus to the active terminal unless it already has it */
  focusActive(): void {
    const active = this.activeId ? this.entries.get(this.activeId) : undefined;
    if (active && !active.element.contains(document.activeElement)) {
      active.terminal.focus();
    }
  }

  /** The size a terminal gets in the view, before any tab exists */
  measure(): { cols: number; rows: number } {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position: absolute; visibility: hidden; width: calc(100% - 20px); height: calc(100% - 37px);';
    document.body.appendChild(probe);
    const terminal = new Terminal(this.options());
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(probe);
    fitAddon.fit();
    const { cols, rows } = terminal;
    terminal.dispose();
    probe.remove();
    return { cols, rows };
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.stopWatchingTheme();
    for (const entry of this.entries.values()) {
      entry.terminal.dispose();
    }
  }

  private options() {
    return {
      cursorBlink: true,
      fontSize: this.font.fontSize,
      fontFamily: this.font.fontFamily || this.theme.getFontFamily(),
      lineHeight: this.font.lineHeight
    };
  }

  private fitActive(): void {
    const id = this.activeId;
    const active = id ? this.entries.get(id) : undefined;
    if (!id || !active) return;
    const follow = isAtBottom(active.terminal);
    const scrollTop = viewportOf(active)?.scrollTop ?? 0;
    active.fitAddon.fit();
    requestAnimationFrame(() => {
      restoreScroll(active, follow, scrollTop);
      active.isAtBottom = follow;
    });
    this.reportSize(id, active);
  }

  private reportSize(id: string, entry: TerminalEntry): void {
    this.post({ type: 'resize', id, cols: entry.terminal.cols, rows: entry.terminal.rows });
  }

  /**
   * Handles keys that xterm.js cannot encode for CLI agents or that VS Code's
   * webview host intercepts before they reach the terminal.
   *
   * - Keys with a sequence in `keySequence` send it, e.g. Cmd+Left `Ctrl+A`
   *   like VS Code's terminal, and Shift+Enter the CSI-u sequence
   *   `ESC [13;2u`, so agents such as pi can tell it apart from Enter.
   * - Cmd+C / Cmd+V use the clipboard directly. The VS Code webview host
   *   cancels the native copy/paste events on desktop, so without this they
   *   silently do nothing in the terminal.
   *
   * Handled events stop propagating so VS Code does not run a second action
   * for the same keystroke.
   */
  private handleKey(terminal: Terminal, id: string, event: KeyboardEvent): boolean {
    // Let the event reach VS Code's keybindings without typing it
    if (isTabShortcut(event, IS_MAC)) {
      return false;
    }

    const sequence = keySequence(event, IS_MAC);
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
      this.post({ type: 'input', id, data: sequence });
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
}

function restoreScroll(entry: TerminalEntry, follow: boolean, scrollTop: number): void {
  if (follow) {
    entry.terminal.scrollToBottom();
    return;
  }
  const viewport = viewportOf(entry);
  if (viewport && scrollTop > 0) {
    viewport.scrollTop = scrollTop;
  }
}
