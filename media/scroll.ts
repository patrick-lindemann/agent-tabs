import type { Terminal } from '@xterm/xterm';
import type { TerminalEntry } from './types';

export function isAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.viewportY >= buffer.baseY - 1;
}

export function viewportOf(entry: TerminalEntry): HTMLElement | null {
  return entry.element.querySelector<HTMLElement>('.xterm-viewport');
}

/** Remembers whether a terminal follows its output and where it was scrolled to */
export function trackScroll(entry: TerminalEntry): void {
  entry.terminal.onScroll(() => {
    entry.isAtBottom = isAtBottom(entry.terminal);
  });
  const viewport = viewportOf(entry);
  viewport?.addEventListener(
    'scroll',
    () => {
      entry.lastScrollTop = viewport.scrollTop;
      entry.isAtBottom = isAtBottom(entry.terminal);
    },
    { passive: true }
  );
}
