import { describe, expect, it } from 'vitest';
import { type LayoutNode, PaneLayout, type SavedLayout } from '../../src/terminal/layout';

/** A layout as nested arrays: a pane as its position, a split as [direction, sizes, children] */
function shape(layout: PaneLayout, node: LayoutNode = layout.root): unknown {
  const panes = layout.panes();
  return node.kind === 'pane'
    ? panes.indexOf(node)
    : [node.direction, node.sizes, node.children.map((child) => shape(layout, child))];
}

/** A layout whose panes each have a tab, so pruning keeps them */
function withTabs(layout: PaneLayout): PaneLayout {
  layout.panes().forEach((pane, index) => {
    if (pane.tabs.length === 0) pane.tabs.push(`tab-${String(index)}`);
  });
  return layout;
}

describe('pane layout', () => {
  it('splits a pane into a row or column, halving its space', () => {
    const layout = withTabs(new PaneLayout());
    const [first] = layout.panes();
    layout.addPane(first.id, 'right');
    expect(shape(layout)).toEqual(['row', [1, 1], [0, 1]]);
    // The new pane and the one it split share that one's space
    layout.addPane(first.id, 'left');
    expect(shape(layout)).toEqual(['row', [0.5, 0.5, 1], [0, 1, 2]]);
  });

  it('nests a split in the other direction inside a split', () => {
    const layout = new PaneLayout();
    const [first] = layout.panes();
    const right = layout.addPane(first.id, 'right');
    if (!right) throw new Error('no pane');
    layout.addPane(right.id, 'bottom');
    layout.addPane(first.id, 'top');
    expect(shape(layout)).toEqual([
      'row',
      [1, 1],
      [
        ['column', [1, 1], [0, 1]],
        ['column', [1, 1], [2, 3]]
      ]
    ]);
    expect(layout.panes().every((pane) => pane.parent?.parent === layout.root)).toBe(true);
  });

  it('gives a removed pane its space to its neighbor and unwraps a split left with one child', () => {
    const layout = new PaneLayout();
    const [first] = layout.panes();
    const right = layout.addPane(first.id, 'right');
    if (!right) throw new Error('no pane');
    const below = layout.addPane(right.id, 'bottom');
    if (!below) throw new Error('no pane');
    layout.focused = below;
    layout.removePane(below);
    expect(shape(layout)).toEqual(['row', [1, 1], [0, 1]]);
    expect(layout.focused).toBe(right);
    expect(right.parent).toBe(layout.root);
    layout.removePane(first);
    expect(layout.root).toBe(right);
    expect(right.parent).toBeUndefined();
    // The last pane stays
    layout.removePane(right);
    expect(layout.root).toBe(right);
  });

  it('merges a split into its parent when the pane between them goes', () => {
    // column [ a, row [ b, column [ c, d ] ] ]; removing b leaves the inner
    // column in the outer one, which takes its panes in its place
    const layout = new PaneLayout();
    const [a] = layout.panes();
    const b = layout.addPane(a.id, 'bottom');
    if (!b) throw new Error('no pane');
    const c = layout.addPane(b.id, 'right');
    if (!c) throw new Error('no pane');
    layout.addPane(c.id, 'bottom');
    layout.resize(layout.root.id, [1, 3]);
    layout.removePane(b);
    expect(shape(layout)).toEqual(['column', [1, 1.5, 1.5], [0, 1, 2]]);
    expect(layout.panes().every((pane) => pane.parent === layout.root)).toBe(true);
  });

  it("focuses the nearest pane of the neighbor that takes a focused pane's space", () => {
    const layout = new PaneLayout();
    const [first] = layout.panes();
    const right = layout.addPane(first.id, 'right');
    if (!right) throw new Error('no pane');
    layout.addPane(right.id, 'bottom');
    layout.focused = first;
    layout.removePane(first);
    expect(layout.focused).toBe(right);
  });

  it('saves and restores a nested layout with its sizes', () => {
    const layout = new PaneLayout();
    const [first] = layout.panes();
    const right = layout.addPane(first.id, 'right');
    if (!right) throw new Error('no pane');
    layout.addPane(right.id, 'bottom');
    layout.resize(layout.root.id, [2, 1]);
    const saved = layout.save();
    expect(saved).toEqual({
      direction: 'row',
      sizes: [2, 1],
      children: [0, { direction: 'column', sizes: [1, 1], children: [1, 2] }]
    });

    const restored = new PaneLayout();
    const panes = restored.restore(JSON.parse(JSON.stringify(saved)), 3);
    expect(panes).toHaveLength(3);
    expect(shape(restored)).toEqual(shape(layout));
    expect(restored.panes()).toEqual(panes);
    expect(restored.focused).toBe(panes?.[0]);
  });

  it('saves no layout for a single pane', () => {
    expect(new PaneLayout().save()).toBeUndefined();
  });

  it.each([
    ['nothing', undefined, 2],
    ['a pane count that does not fit', { direction: 'row', sizes: [1, 1], children: [0, 1] }, 3],
    ['a pane twice', { direction: 'row', sizes: [1, 1], children: [0, 0] }, 2],
    ['a pane out of range', { direction: 'row', sizes: [1, 1], children: [0, 2] }, 2],
    ['a wrong direction', { direction: 'diagonal', sizes: [1, 1], children: [0, 1] }, 2],
    ['missing sizes', { direction: 'row', sizes: [1], children: [0, 1] }, 2],
    ['a size of zero', { direction: 'row', sizes: [1, 0], children: [0, 1] }, 2],
    ['one child', { direction: 'row', sizes: [1], children: [0] }, 1],
    [
      'a child split in its own direction',
      {
        direction: 'row',
        sizes: [1, 1],
        children: [0, { direction: 'row', sizes: [1, 1], children: [1, 2] }]
      },
      3
    ]
  ] as Array<[string, SavedLayout | undefined, number]>)(
    'restores no layout with %s',
    (_, saved, count) => {
      const layout = new PaneLayout();
      const root = layout.root;
      expect(layout.restore(saved, count)).toBeUndefined();
      expect(layout.root).toBe(root);
    }
  );

  it('removes the panes without tabs, keeping one', () => {
    const layout = new PaneLayout();
    const [first] = layout.panes();
    const right = layout.addPane(first.id, 'right');
    if (!right) throw new Error('no pane');
    right.tabs.push('a');
    layout.addPane(right.id, 'bottom');
    layout.prune();
    expect(layout.root).toBe(right);

    const empty = new PaneLayout();
    empty.addPane(empty.panes()[0].id, 'right');
    empty.prune();
    expect(empty.panes()).toHaveLength(1);
  });
});
