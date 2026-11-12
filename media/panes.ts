import { drag, TabBar } from './tabs';
import type { Terminals } from './terminal';
import type { PaneInfo, SplitSide, WebviewOutgoingMessage } from './types';

/** A pane's terminal is at least this high in pixels while its edge is dragged */
const MIN_PANE_HEIGHT = 60;

/** A pane in the view: its tab strip and the container its terminal shows in */
interface PaneElement {
  root: HTMLElement;
  tabs: TabBar;
  terminal: HTMLElement;
  size: number;
  /** The tab the pane shows */
  shown: string | undefined;
}

/**
 * The view's panes, stacked top to bottom, each a tab strip over the
 * terminal of its active tab. Dropping a dragged tab on the top or bottom
 * half of a pane's terminal splits the pane, and the edge between two panes
 * can be dragged to resize them.
 */
export class Panes {
  private readonly root: HTMLElement;
  private readonly panes = new Map<string, PaneElement>();
  /** Pane IDs, top to bottom */
  private order: string[] = [];
  private focusedId: string | undefined;

  constructor(
    private readonly post: (message: WebviewOutgoingMessage) => void,
    private readonly terminals: Terminals
  ) {
    const root = document.getElementById('panes');
    if (!root) throw new Error('Pane container not found');
    this.root = root;
  }

  get count(): number {
    return this.order.length;
  }

  /** Lays out the panes and shows each pane's active tab in it */
  render(panes: PaneInfo[], statusColors: boolean, monochromeIcons: boolean): void {
    const ids = new Set(panes.map((pane) => pane.id));
    for (const [id, pane] of this.panes) {
      if (!ids.has(id)) {
        this.terminals.release(pane.terminal);
        pane.tabs.dispose();
        pane.root.remove();
        this.panes.delete(id);
      }
    }
    // Emptied first, so a terminal that moved between panes is not taken back
    for (const info of panes) {
      const pane = this.panes.get(info.id);
      if (pane && !info.tabs.some((tab) => tab.isActive)) this.terminals.release(pane.terminal);
    }
    for (const info of panes) {
      const pane = this.panes.get(info.id) ?? this.createPane(info.id);
      pane.size = info.size;
      pane.root.style.flexGrow = String(info.size);
      pane.root.classList.toggle('focused', info.focused);
      pane.tabs.render(info.tabs, statusColors, monochromeIcons);
      pane.shown = info.tabs.find((tab) => tab.isActive)?.id;
    }
    // Laid out again only when the panes changed: moving a pane's element
    // takes keyboard focus from its terminal, and tab updates come often
    const order = panes.map((pane) => pane.id);
    if (order.join('\n') !== this.order.join('\n')) {
      this.root.replaceChildren();
      order.forEach((id, index) => {
        const pane = this.panes.get(id);
        if (!pane) return;
        if (index > 0) this.root.appendChild(this.createSash(index));
        this.root.appendChild(pane.root);
      });
    }
    this.order = order;
    this.root.classList.toggle('split', panes.length > 1);
    for (const info of panes) {
      const pane = this.panes.get(info.id);
      const active = info.tabs.find((tab) => tab.isActive);
      if (pane && active) this.terminals.place(active.id, pane.terminal);
    }
    const focused = panes.find((pane) => pane.focused);
    this.focusedId = focused?.id;
    this.terminals.setActive(focused?.tabs.find((tab) => tab.isActive)?.id);
  }

  private createPane(id: string): PaneElement {
    const root = document.createElement('div');
    root.className = 'pane';
    root.dataset.pane = id;
    // Clicking the pane's active tab focuses its terminal, before the
    // extension has told the view that the pane has focus
    const tabs = new TabBar(id, this.post, () => {
      const shown = this.panes.get(id)?.shown;
      if (!shown) return;
      this.terminals.setActive(shown);
      this.terminals.focusActive();
    });
    const terminal = document.createElement('div');
    terminal.className = 'pane-terminal';
    root.append(tabs.bar, terminal);
    // Clicking into a pane gives it focus, for commands and new tabs
    root.addEventListener('mousedown', () => {
      if (this.focusedId !== id) {
        this.focusedId = id;
        this.post({ type: 'focusPane', pane: id });
      }
    });
    this.setupSplitDrop(id, terminal);
    const pane: PaneElement = { root, tabs, terminal, size: 1, shown: undefined };
    this.panes.set(id, pane);
    return pane;
  }

  /**
   * A tab dragged over a pane's terminal shades the half it would go to:
   * the top half opens a new pane above, the bottom half below
   */
  private setupSplitDrop(id: string, terminal: HTMLElement): void {
    const side = (event: DragEvent): SplitSide => {
      const rect = terminal.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    };
    const zone = (): HTMLElement => {
      let element = terminal.querySelector<HTMLElement>('.drop-zone');
      if (!element) {
        element = document.createElement('div');
        element.className = 'drop-zone';
        terminal.appendChild(element);
      }
      return element;
    };
    // A pane's only tab cannot split from its own pane
    const canSplit = () => {
      const tabs = this.panes.get(id)?.root.querySelectorAll<HTMLElement>('.tab') ?? [];
      return drag.id !== undefined && !(tabs.length === 1 && tabs[0].dataset.id === drag.id);
    };
    terminal.addEventListener('dragover', (event) => {
      if (!canSplit()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      zone().dataset.side = side(event);
    });
    terminal.addEventListener('dragleave', (event) => {
      if (!terminal.contains(event.relatedTarget as Node | null)) {
        terminal.querySelector('.drop-zone')?.remove();
      }
    });
    terminal.addEventListener('drop', (event) => {
      const tab = drag.id;
      if (!tab || !canSplit()) return;
      event.preventDefault();
      terminal.querySelector('.drop-zone')?.remove();
      this.post({ type: 'splitTab', id: tab, pane: id, side: side(event) });
    });
  }

  /**
   * The edge above the pane at `index`: dragging it moves height between
   * that pane and the one above
   */
  private createSash(index: number): HTMLElement {
    const sash = document.createElement('div');
    sash.className = 'pane-sash';
    sash.setAttribute('role', 'separator');
    sash.setAttribute('aria-orientation', 'horizontal');
    sash.addEventListener('pointerdown', (event) => {
      const above = this.panes.get(this.order[index - 1]);
      const below = this.panes.get(this.order[index]);
      if (!above || !below) return;
      event.preventDefault();
      sash.setPointerCapture(event.pointerId);
      sash.classList.add('active');
      const startY = event.clientY;
      const aboveHeight = above.root.getBoundingClientRect().height;
      const belowHeight = below.root.getBoundingClientRect().height;
      const total = above.size + below.size;
      const move = (moved: PointerEvent) => {
        const delta = Math.max(
          MIN_PANE_HEIGHT - aboveHeight,
          Math.min(moved.clientY - startY, belowHeight - MIN_PANE_HEIGHT)
        );
        const share = (aboveHeight + delta) / (aboveHeight + belowHeight);
        above.size = total * share;
        below.size = total - above.size;
        above.root.style.flexGrow = String(above.size);
        below.root.style.flexGrow = String(below.size);
      };
      const end = () => {
        sash.removeEventListener('pointermove', move);
        sash.classList.remove('active');
        const sizes = this.order.map((pane) => this.panes.get(pane)?.size ?? 1);
        this.post({ type: 'resizePanes', sizes });
      };
      sash.addEventListener('pointermove', move);
      sash.addEventListener('pointerup', end, { once: true });
      sash.addEventListener('pointercancel', end, { once: true });
    });
    return sash;
  }
}
