import { drag, TabBar } from './tabs';
import type { Terminals } from './terminal';
import type { LayoutInfo, PaneInfo, SplitInfo, SplitSide, WebviewOutgoingMessage } from './types';

/** A pane is at least this wide and high in pixels while an edge is dragged */
const MIN_PANE_SIZE = 60;

/**
 * The share of a pane's width or height at its edges where a dropped tab
 * splits it toward that edge; the top and bottom take what is left
 */
const SIDE_ZONE = 0.25;

/** A pane in the view: its tab strip and the container its terminal shows in */
interface PaneElement {
  root: HTMLElement;
  tabs: TabBar;
  terminal: HTMLElement;
  /** The tab the pane shows */
  shown: string | undefined;
}

/**
 * The view's panes, laid out by the splits the extension sends: side by
 * side in a row, one above the other in a column, and splits within
 * splits. Each pane is a tab strip over the terminal of its active tab.
 * Dropping a dragged tab near an edge of a pane's terminal splits the pane
 * toward it, and the edge between two panes can be dragged to resize them.
 */
export class Panes {
  private readonly root: HTMLElement;
  private readonly panes = new Map<string, PaneElement>();
  /** The layout last built, to build it again only when it changed */
  private shape = '';
  private paneCount = 0;
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
    return this.paneCount;
  }

  /** Lays out the panes and shows each pane's active tab in it */
  render(layout: LayoutInfo, statusColors: boolean, monochromeIcons: boolean): void {
    const infos = panesOf(layout);
    const ids = new Set(infos.map((pane) => pane.id));
    for (const [id, pane] of this.panes) {
      if (!ids.has(id)) {
        this.terminals.release(pane.terminal);
        pane.tabs.dispose();
        pane.root.remove();
        this.panes.delete(id);
      }
    }
    // Emptied first, so a terminal that moved between panes is not taken back
    for (const info of infos) {
      const pane = this.panes.get(info.id);
      if (pane && !info.tabs.some((tab) => tab.isActive)) this.terminals.release(pane.terminal);
    }
    for (const info of infos) {
      const pane = this.panes.get(info.id) ?? this.createPane(info.id);
      pane.root.classList.toggle('focused', info.focused);
      pane.tabs.render(info.tabs, statusColors, monochromeIcons);
      pane.shown = info.tabs.find((tab) => tab.isActive)?.id;
    }
    // Built again only when the splits changed: moving a pane's element
    // takes keyboard focus from its terminal, and tab updates come often.
    // Sizes alone are applied in place.
    const shape = JSON.stringify(shapeOf(layout));
    if (shape !== this.shape) {
      this.shape = shape;
      this.root.replaceChildren(this.build(layout));
    } else {
      this.applySizes(layout);
    }
    this.paneCount = infos.length;
    this.root.classList.toggle('split', infos.length > 1);
    for (const info of infos) {
      const pane = this.panes.get(info.id);
      const active = info.tabs.find((tab) => tab.isActive);
      if (pane && active) this.terminals.place(active.id, pane.terminal);
    }
    const focused = infos.find((pane) => pane.focused);
    this.focusedId = focused?.id;
    this.terminals.setActive(focused?.tabs.find((tab) => tab.isActive)?.id);
  }

  /** The element of a pane, or of a split with its children and the edges between them */
  private build(node: LayoutInfo): HTMLElement {
    if (node.type === 'pane') {
      const pane = this.panes.get(node.id);
      if (!pane) throw new Error(`Pane ${node.id} not found`);
      return pane.root;
    }
    const split = document.createElement('div');
    split.className = `split split-${node.direction}`;
    split.dataset.split = node.id;
    node.children.forEach((child, index) => {
      if (index > 0) split.appendChild(this.createSash(node, index));
      const element = this.build(child);
      element.style.flexGrow = String(node.sizes[index]);
      split.appendChild(element);
    });
    return split;
  }

  /** Sets the sizes of every split's children, without building it again */
  private applySizes(node: LayoutInfo): void {
    if (node.type === 'pane') return;
    const split = this.root.querySelector<HTMLElement>(`[data-split="${node.id}"]`);
    const children = split ? childrenOf(split) : [];
    node.children.forEach((child, index) => {
      const element = children[index];
      if (element) element.style.flexGrow = String(node.sizes[index]);
      this.applySizes(child);
    });
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
    const pane: PaneElement = { root, tabs, terminal, shown: undefined };
    this.panes.set(id, pane);
    return pane;
  }

  /**
   * A tab dragged over a pane's terminal shades the part it would go to: a
   * new pane on the left or right near those edges, else above or below
   */
  private setupSplitDrop(id: string, terminal: HTMLElement): void {
    const side = (event: DragEvent): SplitSide => {
      const rect = terminal.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (x < SIDE_ZONE) return 'left';
      if (x > 1 - SIDE_ZONE) return 'right';
      return y < 0.5 ? 'top' : 'bottom';
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
   * The edge before the split's child at `index`: dragging it moves width
   * or height between that child and the one before
   */
  private createSash(split: SplitInfo, index: number): HTMLElement {
    const row = split.direction === 'row';
    const sash = document.createElement('div');
    sash.className = `pane-sash ${row ? 'sash-vertical' : 'sash-horizontal'}`;
    sash.setAttribute('role', 'separator');
    sash.setAttribute('aria-orientation', row ? 'vertical' : 'horizontal');
    sash.addEventListener('pointerdown', (event) => {
      const parent = sash.parentElement;
      if (!parent) return;
      const children = childrenOf(parent);
      const before = children[index - 1];
      const after = children[index];
      if (!before || !after) return;
      event.preventDefault();
      sash.setPointerCapture(event.pointerId);
      sash.classList.add('active');
      const length = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return row ? rect.width : rect.height;
      };
      const position = (pointer: PointerEvent) => (row ? pointer.clientX : pointer.clientY);
      const start = position(event);
      const beforeLength = length(before);
      const afterLength = length(after);
      // Sizes as rendered, since the user may have dragged before
      const sizes = children.map((child) => Number(child.style.flexGrow) || 1);
      const total = sizes[index - 1] + sizes[index];
      const move = (moved: PointerEvent) => {
        const delta = Math.max(
          MIN_PANE_SIZE - beforeLength,
          Math.min(position(moved) - start, afterLength - MIN_PANE_SIZE)
        );
        const share = (beforeLength + delta) / (beforeLength + afterLength);
        sizes[index - 1] = total * share;
        sizes[index] = total - sizes[index - 1];
        before.style.flexGrow = String(sizes[index - 1]);
        after.style.flexGrow = String(sizes[index]);
      };
      const end = () => {
        sash.removeEventListener('pointermove', move);
        sash.classList.remove('active');
        this.post({ type: 'resizeSplit', split: split.id, sizes });
      };
      sash.addEventListener('pointermove', move);
      sash.addEventListener('pointerup', end, { once: true });
      sash.addEventListener('pointercancel', end, { once: true });
    });
    return sash;
  }
}

/** The panes of a layout in reading order */
function panesOf(node: LayoutInfo): PaneInfo[] {
  return node.type === 'pane' ? [node] : node.children.flatMap(panesOf);
}

/** A layout without sizes and tabs: what decides whether it must be built again */
function shapeOf(node: LayoutInfo): unknown {
  return node.type === 'pane'
    ? node.id
    : { id: node.id, direction: node.direction, children: node.children.map(shapeOf) };
}

/** A split element's children, without the edges between them */
function childrenOf(split: HTMLElement): HTMLElement[] {
  return [...split.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.classList.contains('pane-sash')
  );
}
