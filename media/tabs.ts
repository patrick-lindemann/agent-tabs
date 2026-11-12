import { AGENT_ICONS, CLOSE_ICON, IDLE_ICON, STATUS_ICONS, TERMINAL_ICON } from './icons';
import type { TabInfo, WebviewOutgoingMessage } from './types';

/** Drag data type of a tab, so dropping it elsewhere inserts no text */
export const TAB_DRAG_TYPE = 'application/x-agent-tabs-tab';

/** Distance from the strip's edge in pixels at which a drag scrolls it */
const DRAG_SCROLL_EDGE = 24;

/** The tab being dragged, shared by the tab strips and the panes they may drop on */
export const drag: { id: string | undefined } = { id: undefined };

const SCROLL_LEFT_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.928 7.976l4.357 4.357-.618.62L5 8.284v-.618L9.667 3l.618.619-4.357 4.357z"/></svg>';
const SCROLL_RIGHT_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>';
const NEW_TAB_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>';
const PROFILE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>';

/**
 * A pane's browser-style tab strip above its terminal. Tabs share its width
 * and scroll sideways once they reach their minimum width. Tabs can be
 * dragged to another position, also into another pane's strip.
 */
export class TabBar {
  /** The strip, to put at the top of its pane */
  readonly bar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly scrollLeft: HTMLButtonElement;
  private readonly scrollRight: HTMLButtonElement;
  private renderedActiveId: string | undefined;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly paneId: string,
    private readonly post: (message: WebviewOutgoingMessage) => void,
    /** Clicking the active tab returns focus to its terminal */
    private readonly focusActive: () => void
  ) {
    this.bar = element('div', 'tab-bar');
    this.scrollLeft = button('tab-scroll', 'Scroll Left', SCROLL_LEFT_ICON);
    this.list = element('div', 'tab-list');
    this.list.setAttribute('role', 'tablist');
    this.list.setAttribute('aria-label', 'Terminal tabs');
    this.scrollRight = button('tab-scroll', 'Scroll Right', SCROLL_RIGHT_ICON);
    const newTab = element('div', 'new-tab');
    newTab.setAttribute('role', 'group');
    newTab.setAttribute('aria-label', 'New Tab');
    const newTabDefault = button('new-tab-default', 'New Tab', NEW_TAB_ICON);
    const newTabProfile = button('new-tab-profile', 'Use Profile…', PROFILE_ICON);
    newTab.append(newTabDefault, newTabProfile);
    this.bar.append(this.scrollLeft, this.list, this.scrollRight, newTab);

    this.resizeObserver = new ResizeObserver(() => this.updateScrollButtons());
    this.setupScrolling();
    this.setupDragAndDrop();
    this.setupNewTabButtons(newTabDefault, newTabProfile);
  }

  /** The tab elements by tab ID, kept between renders */
  private readonly elements = new Map<string, TabElement>();

  dispose(): void {
    this.resizeObserver.disconnect();
    this.bar.remove();
  }

  /**
   * Shows the tabs. Elements of tabs that stay are updated in place, since
   * the tab list is sent again many times while status streams in.
   */
  render(tabs: TabInfo[], statusColors: boolean, monochromeIcons: boolean): void {
    const ids = new Set(tabs.map((tab) => tab.id));
    // Reordering takes focus from a tab it moves; it gets it back below
    const focused = document.activeElement;
    for (const [id, element] of this.elements) {
      if (!ids.has(id)) {
        element.root.remove();
        this.elements.delete(id);
      }
    }
    let moved = false;
    tabs.forEach((tab, index) => {
      let element = this.elements.get(tab.id);
      if (!element) {
        element = this.createTab(tab.id);
        this.elements.set(tab.id, element);
      }
      this.updateTab(element, tab, monochromeIcons);
      if (this.list.children[index] !== element.root) {
        this.list.insertBefore(element.root, this.list.children[index] ?? null);
        moved = true;
      }
    });
    if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus();
    this.bar.classList.toggle('status-colors', statusColors);

    const activeId = tabs.find((tab) => tab.isActive)?.id;
    // Also after a move, so the moved tab stays in view
    const activeChanged = activeId !== this.renderedActiveId || moved;
    this.renderedActiveId = activeId;

    requestAnimationFrame(() => {
      if (activeChanged) {
        this.list
          .querySelector('.tab.active')
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.updateScrollButtons();
    });
  }

  /**
   * A tab's element with its handlers. The tab strip is a tab list: the
   * active tab takes focus with Tab, arrow keys, Home and End move between
   * tabs, Enter or Space shows one, Delete closes it.
   */
  private createTab(id: string): TabElement {
    const root = document.createElement('div');
    root.dataset.id = id;
    root.setAttribute('role', 'tab');

    const status = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'tab-label';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = 'Close';
    close.tabIndex = -1;
    close.innerHTML = CLOSE_ICON;
    keepFocus(close);
    close.onclick = (event) => {
      event.stopPropagation();
      this.post({ type: 'closeTab', id });
    };

    root.onclick = () => {
      if (root.classList.contains('active')) {
        this.focusActive();
      } else {
        this.post({ type: 'switchTab', id });
      }
    };
    // Middle-click closes, like editor tabs
    root.onauxclick = (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.post({ type: 'closeTab', id });
      }
    };
    root.onkeydown = (event) => this.handleKey(id, event);
    root.draggable = true;
    root.ondragstart = (event) => {
      if (!event.dataTransfer) return;
      drag.id = id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(TAB_DRAG_TYPE, id);
      root.classList.add('dragged');
      document.body.classList.add('dragging-tab');
    };
    root.ondragend = () => {
      drag.id = undefined;
      root.classList.remove('dragged');
      document.body.classList.remove('dragging-tab');
      for (const tab of document.querySelectorAll('.drop-before, .drop-after')) {
        tab.classList.remove('drop-before', 'drop-after');
      }
      for (const zone of document.querySelectorAll('.drop-zone')) zone.remove();
    };

    root.append(status, label, close);
    return { root, status, label, close, statusHtml: '' };
  }

  private updateTab(element: TabElement, tab: TabInfo, monochromeIcons: boolean): void {
    const { root, status, label, close } = element;
    root.classList.add('tab');
    root.classList.toggle('active', tab.isActive);
    root.tabIndex = tab.isActive ? 0 : -1;
    root.setAttribute('aria-selected', String(tab.isActive));
    root.setAttribute('aria-label', tab.statusText ? `${tab.label}, ${tab.statusText}` : tab.label);
    // The full title and the status, since the label is a short key
    root.title = [tab.description, tab.statusText].filter(Boolean).join('\n');
    if (tab.status) root.dataset.status = tab.status;
    else delete root.dataset.status;
    if (tab.accentColor) root.style.setProperty('--tab-accent', tab.accentColor);
    else root.style.removeProperty('--tab-accent');
    // Read by VS Code for the `webview/context` menu (Close, Close Others)
    root.dataset.vscodeContext = JSON.stringify({
      webviewSection: 'tab',
      terminalId: tab.id,
      preventDefaultContextMenuItems: true
    });

    // The agent's logo, replaced by the status icon while there is a status;
    // replaced only when it changes, so the working animation keeps running
    const { icon } = tab;
    const logo = !tab.status && icon !== 'terminal' && icon !== 'sparkle';
    const html = tab.status
      ? STATUS_ICONS[tab.status]
      : icon === 'terminal'
        ? TERMINAL_ICON
        : icon === 'sparkle'
          ? IDLE_ICON
          : AGENT_ICONS[icon][monochromeIcons ? 'mono' : 'color'];
    status.className = logo ? 'tab-status tab-logo' : 'tab-status';
    if (html !== element.statusHtml) {
      status.innerHTML = html;
      element.statusHtml = html;
    }
    label.textContent = tab.label;
    close.setAttribute('aria-label', `Close ${tab.label}`);
  }

  private handleKey(id: string, event: KeyboardEvent): void {
    // Keys with modifiers are VS Code's, e.g. Ctrl+Shift+PageUp moves the tab
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const tabs = [...this.list.querySelectorAll<HTMLElement>('.tab')];
    const index = tabs.findIndex((tab) => tab.dataset.id === id);
    const target = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: tabs.length - 1
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      const next = tabs[(target + tabs.length) % tabs.length];
      if (next?.dataset.id) {
        this.post({ type: 'switchTab', id: next.dataset.id });
        next.focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.post({ type: 'switchTab', id });
      this.focusActive();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      this.post({ type: 'closeTab', id });
    }
  }

  /**
   * The strip scrolls sideways with the mouse wheel or trackpad and with the
   * arrow buttons, which only appear while tabs overflow.
   */
  private setupScrolling(): void {
    this.list.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          this.list.scrollLeft += event.deltaY;
        }
      },
      { passive: false }
    );
    this.list.addEventListener('scroll', () => this.updateScrollButtons(), { passive: true });
    this.resizeObserver.observe(this.list);

    const scrollByTab = (direction: number) => {
      const tabWidth = this.list.querySelector('.tab')?.clientWidth ?? 100;
      this.list.scrollBy({ left: direction * tabWidth, behavior: 'smooth' });
    };
    this.scrollLeft.onclick = () => scrollByTab(-1);
    this.scrollRight.onclick = () => scrollByTab(1);
  }

  /**
   * Dragging a tab over the strip shows where it will go with a line between
   * tabs, and dropping it there moves it, also from another pane's strip.
   * Near the strip's edges the strip scrolls.
   */
  private setupDragAndDrop(): void {
    this.list.addEventListener('dragover', (event) => {
      if (!drag.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const rect = this.list.getBoundingClientRect();
      if (event.clientX < rect.left + DRAG_SCROLL_EDGE) this.list.scrollLeft -= 8;
      else if (event.clientX > rect.right - DRAG_SCROLL_EDGE) this.list.scrollLeft += 8;
      this.showDropIndicator(event.clientX);
    });
    this.list.addEventListener('dragleave', (event) => {
      if (!this.list.contains(event.relatedTarget as Node | null)) this.clearDropIndicator();
    });
    this.list.addEventListener('drop', (event) => {
      const id = drag.id;
      if (!id) return;
      event.preventDefault();
      this.clearDropIndicator();
      const index = this.dropIndex(event.clientX);
      const element = this.elements.get(id);
      if (!element) {
        // From another pane; the layout the extension sends next moves it
        this.post({ type: 'moveTab', id, index, pane: this.paneId });
        return;
      }
      const others = this.otherTabs(id);
      if (index === this.tabElements().indexOf(element.root)) return;
      // Moved at once; the tab list the extension sends next agrees
      this.list.insertBefore(element.root, others[index] ?? null);
      this.post({ type: 'moveTab', id, index });
    });
  }

  private tabElements(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('.tab')];
  }

  /** The tabs other than the dragged one, in order */
  private otherTabs(id: string): HTMLElement[] {
    return this.tabElements().filter((tab) => tab.dataset.id !== id);
  }

  /**
   * The position the dragged tab takes when dropped at `x`: after every
   * other tab whose middle is left of it
   */
  private dropIndex(x: number): number {
    if (!drag.id) return 0;
    return this.otherTabs(drag.id).filter((tab) => {
      const rect = tab.getBoundingClientRect();
      return rect.left + rect.width / 2 < x;
    }).length;
  }

  /** Marks the edge of the tab where the dragged tab would go */
  private showDropIndicator(x: number): void {
    if (!drag.id) return;
    const others = this.otherTabs(drag.id);
    const index = this.dropIndex(x);
    const before = others[index];
    const after = before ? undefined : others[others.length - 1];
    for (const tab of this.tabElements()) {
      tab.classList.toggle('drop-before', tab === before);
      tab.classList.toggle('drop-after', tab === after);
    }
  }

  private clearDropIndicator(): void {
    for (const tab of this.tabElements()) {
      tab.classList.remove('drop-before', 'drop-after');
    }
  }

  /**
   * Split button like VS Code's terminal: + opens the first profile, ⌄ lists
   * them; the tab opens in this pane
   */
  private setupNewTabButtons(newTab: HTMLElement, withProfile: HTMLElement): void {
    keepFocus(newTab);
    keepFocus(withProfile);
    newTab.addEventListener('click', () => this.post({ type: 'newTab', pane: this.paneId }));
    withProfile.addEventListener('click', () =>
      this.post({ type: 'newTabWithProfile', pane: this.paneId })
    );
  }

  /** Shows the scroll buttons while tabs overflow */
  private updateScrollButtons(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.list;
    this.bar.classList.toggle('overflowing', scrollWidth > clientWidth + 1);
    this.scrollLeft.disabled = scrollLeft <= 0;
    this.scrollRight.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
  }
}

/** A tab's elements, and the icon it shows */
interface TabElement {
  root: HTMLDivElement;
  status: HTMLSpanElement;
  label: HTMLSpanElement;
  close: HTMLButtonElement;
  statusHtml: string;
}

function element(tag: 'div', className: string): HTMLDivElement {
  const created = document.createElement(tag);
  created.className = className;
  return created;
}

function button(className: string, label: string, icon: string): HTMLButtonElement {
  const created = document.createElement('button');
  created.className = className;
  created.title = label;
  created.setAttribute('aria-label', label);
  created.innerHTML = icon;
  return created;
}

/** Keeps focus in the terminal when a button is clicked */
function keepFocus(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}
