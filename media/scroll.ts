import type { Terminal } from '@xterm/xterm';
import type { TerminalEntry } from './types';
// biome-ignore lint/complexity/noStaticOnlyClass: Static grouping keeps scroll helpers namespaced.
export class ScrollManager {
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
