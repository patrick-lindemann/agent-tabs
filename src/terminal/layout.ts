import type { LayoutInfo, PaneInfo, SplitDirection, SplitSide } from '../types';

/** A pane of the view: its tabs in order and the one it shows */
export interface Pane {
  kind: 'pane';
  id: string;
  tabs: string[];
  active: string | undefined;
  parent: Split | undefined;
}

/** Panes or further splits side by side (`row`) or one above the other (`column`) */
export interface Split {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  /** Each child's share of the split's width or height */
  sizes: number[];
  parent: Split | undefined;
}

export type LayoutNode = Pane | Split;

/**
 * A layout as kept for the next window: a pane as its position among the
 * panes in reading order, or a split of such layouts
 */
export type SavedLayout =
  | number
  | { direction: SplitDirection; sizes: number[]; children: SavedLayout[] };

/**
 * The view's panes as a tree of splits. A split has at least two children
 * and never a child split in its own direction, so each layout has one
 * tree. There is always at least one pane, and the focused pane is one
 * of them.
 */
export class PaneLayout {
  root: LayoutNode = newPane();
  focused: Pane = this.root as Pane;

  /** The panes in reading order: left to right, top to bottom */
  panes(node: LayoutNode = this.root): Pane[] {
    return node.kind === 'pane' ? [node] : node.children.flatMap((child) => this.panes(child));
  }

  pane(id: string): Pane | undefined {
    return this.panes().find((pane) => pane.id === id);
  }

  paneOf(tabId: string): Pane | undefined {
    return this.panes().find((pane) => pane.tabs.includes(tabId));
  }

  private split(id: string, node: LayoutNode = this.root): Split | undefined {
    if (node.kind === 'pane') return undefined;
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = this.split(id, child);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Adds an empty pane on a side of another, which shares its space with
   * it. It must get a tab before anything else happens.
   */
  addPane(paneId: string, side: SplitSide): Pane | undefined {
    const target = this.pane(paneId);
    if (!target) return undefined;
    const pane = newPane();
    const direction: SplitDirection = side === 'left' || side === 'right' ? 'row' : 'column';
    const before = side === 'left' || side === 'top';
    const parent = target.parent;
    if (parent?.direction === direction) {
      const index = parent.children.indexOf(target);
      parent.sizes[index] /= 2;
      parent.children.splice(before ? index : index + 1, 0, pane);
      parent.sizes.splice(before ? index : index + 1, 0, parent.sizes[index]);
      pane.parent = parent;
      return pane;
    }
    const split: Split = {
      kind: 'split',
      id: newId('split'),
      direction,
      children: before ? [pane, target] : [target, pane],
      sizes: [1, 1],
      parent
    };
    this.replace(target, split);
    pane.parent = split;
    target.parent = split;
    return pane;
  }

  /**
   * Removes an empty pane, unless it is the last one. The pane before it in
   * its split, or else after, gets its space and, when it had focus, the
   * focus. A split left with one child gives its place to that child.
   */
  removePane(pane: Pane): void {
    const parent = pane.parent;
    if (!parent) return;
    const index = parent.children.indexOf(pane);
    const neighborIndex = index > 0 ? index - 1 : 1;
    const neighbor = parent.children[neighborIndex];
    if (this.focused === pane) {
      const panes = this.panes(neighbor);
      this.focused = index > 0 ? panes[panes.length - 1] : panes[0];
    }
    parent.sizes[neighborIndex] += parent.sizes[index];
    parent.children.splice(index, 1);
    parent.sizes.splice(index, 1);
    if (parent.children.length === 1) this.collapse(parent);
  }

  /** Removes the panes without tabs, e.g. after restoring, keeping one */
  prune(): void {
    for (const pane of this.panes()) {
      if (pane.tabs.length === 0 && this.panes().length > 1) this.removePane(pane);
    }
  }

  /** Sets the sizes of a split's children; ignored unless there is one per child */
  resize(splitId: string, sizes: number[]): boolean {
    const split = this.split(splitId);
    if (!split || sizes.length !== split.children.length) return false;
    if (!sizes.every((size) => Number.isFinite(size) && size > 0)) return false;
    split.sizes = [...sizes];
    return true;
  }

  /** The layout for the webview, with each pane described by `describe` */
  info(describe: (pane: Pane) => Omit<PaneInfo, 'type' | 'id' | 'focused'>): LayoutInfo {
    const visit = (node: LayoutNode): LayoutInfo =>
      node.kind === 'pane'
        ? { type: 'pane', id: node.id, focused: node === this.focused, ...describe(node) }
        : {
            type: 'split',
            id: node.id,
            direction: node.direction,
            sizes: [...node.sizes],
            children: node.children.map(visit)
          };
    return visit(this.root);
  }

  /** The layout for the next window; a single pane has none */
  save(): SavedLayout | undefined {
    if (this.root.kind === 'pane') return undefined;
    const panes = this.panes();
    const visit = (node: LayoutNode): SavedLayout =>
      node.kind === 'pane'
        ? panes.indexOf(node)
        : { direction: node.direction, sizes: [...node.sizes], children: node.children.map(visit) };
    return visit(this.root);
  }

  /**
   * Replaces a layout without tabs with a saved one of `count` panes, and
   * returns its panes by their saved position. Returns undefined when the
   * saved layout is not one of `count` panes, e.g. from another version.
   */
  restore(saved: unknown, count: number): Pane[] | undefined {
    if (this.panes().some((pane) => pane.tabs.length > 0)) return undefined;
    const panes: Pane[] = [];
    const build = (node: unknown, parent: Split | undefined): LayoutNode | undefined => {
      if (typeof node === 'number') {
        if (!Number.isInteger(node) || node < 0 || node >= count || panes[node]) return undefined;
        const pane = newPane();
        pane.parent = parent;
        panes[node] = pane;
        return pane;
      }
      if (typeof node !== 'object' || node === null) return undefined;
      const { direction, sizes, children } = node as Record<string, unknown>;
      if (direction !== 'row' && direction !== 'column') return undefined;
      if (!Array.isArray(children) || !Array.isArray(sizes)) return undefined;
      if (children.length < 2 || sizes.length !== children.length) return undefined;
      if (!sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)) {
        return undefined;
      }
      if (parent?.direction === direction) return undefined;
      const split: Split = {
        kind: 'split',
        id: newId('split'),
        direction,
        children: [],
        sizes: [...(sizes as number[])],
        parent
      };
      for (const child of children) {
        const built = build(child, split);
        if (!built) return undefined;
        split.children.push(built);
      }
      return split;
    };
    const root = build(saved, undefined);
    if (!root || panes.length !== count || panes.includes(undefined as unknown as Pane)) {
      return undefined;
    }
    this.root = root;
    this.focused = panes[0];
    return panes;
  }

  /** Puts a node in another's place, in its split or as the root */
  private replace(node: LayoutNode, replacement: LayoutNode): void {
    const parent = node.parent;
    replacement.parent = parent;
    if (!parent) {
      this.root = replacement;
      return;
    }
    parent.children[parent.children.indexOf(node)] = replacement;
  }

  /**
   * A split with one child gives its place to it. A child split in the
   * direction of the split it lands in gives its children to that split,
   * each with its share of the place.
   */
  private collapse(split: Split): void {
    const [only] = split.children;
    this.replace(split, only);
    const parent = only.parent;
    if (only.kind !== 'split' || !parent || parent.direction !== only.direction) return;
    const index = parent.children.indexOf(only);
    const place = parent.sizes[index];
    const total = only.sizes.reduce((sum, size) => sum + size, 0);
    parent.children.splice(index, 1, ...only.children);
    parent.sizes.splice(index, 1, ...only.sizes.map((size) => (size / total) * place));
    for (const child of only.children) child.parent = parent;
  }
}

function newPane(): Pane {
  return { kind: 'pane', id: newId('pane'), tabs: [], active: undefined, parent: undefined };
}

function newId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
}
