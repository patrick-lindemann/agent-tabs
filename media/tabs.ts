import { AGENT_ICONS, CLOSE_ICON, IDLE_ICON, STATUS_ICONS } from './icons';
import type { TabInfo, WebviewOutgoingMessage } from './types';

/**
 * Browser-style tab strip above the terminal. Tabs share its width and
 * scroll sideways once they reach their minimum width.
 */
export class TabBar {
  private readonly bar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly scrollLeft: HTMLButtonElement;
  private readonly scrollRight: HTMLButtonElement;
  private renderedActiveId: string | undefined;

  constructor(
    private readonly post: (message: WebviewOutgoingMessage) => void,
    /** Clicking the active tab returns focus to its terminal */
    private readonly focusActive: () => void
  ) {
    const bar = document.getElementById('tab-bar');
    const list = document.getElementById('tab-list');
    const scrollLeft = document.getElementById('tab-scroll-left');
    const scrollRight = document.getElementById('tab-scroll-right');
    if (!bar || !list || !scrollLeft || !scrollRight) {
      throw new Error('Tab bar elements not found');
    }
    this.bar = bar;
    this.list = list;
    this.scrollLeft = scrollLeft as HTMLButtonElement;
    this.scrollRight = scrollRight as HTMLButtonElement;
    this.setupScrolling();
    this.setupNewTabButtons();
  }

  /** The tab elements by tab ID, kept between renders */
  private readonly elements = new Map<string, TabElement>();

  /**
   * Shows the tabs. Elements of tabs that stay are updated in place, since
   * the tab list is sent again many times while status streams in.
   */
  render(tabs: TabInfo[], statusColors: boolean, monochromeIcons: boolean): void {
    const ids = new Set(tabs.map((tab) => tab.id));
    for (const [id, element] of this.elements) {
      if (!ids.has(id)) {
        element.root.remove();
        this.elements.delete(id);
      }
    }
    tabs.forEach((tab, index) => {
      let element = this.elements.get(tab.id);
      if (!element) {
        element = this.createTab(tab.id);
        this.elements.set(tab.id, element);
      }
      this.updateTab(element, tab, monochromeIcons);
      if (this.list.children[index] !== element.root) {
        this.list.insertBefore(element.root, this.list.children[index] ?? null);
      }
    });
    this.bar.classList.toggle('status-colors', statusColors);

    const activeId = tabs.find((tab) => tab.isActive)?.id;
    const activeChanged = activeId !== this.renderedActiveId;
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

    root.append(status, label, close);
    return { root, status, label, close, statusHtml: '' };
  }

  private updateTab(element: TabElement, tab: TabInfo, monochromeIcons: boolean): void {
    const { root, status, label, close } = element;
    root.className = `tab ${tab.isActive ? 'active' : ''}`;
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
    const logo = !tab.status && tab.agent !== undefined;
    const html = tab.status
      ? STATUS_ICONS[tab.status]
      : tab.agent
        ? AGENT_ICONS[tab.agent][monochromeIcons ? 'mono' : 'color']
        : IDLE_ICON;
    status.className = logo ? 'tab-status tab-logo' : 'tab-status';
    if (html !== element.statusHtml) {
      status.innerHTML = html;
      element.statusHtml = html;
    }
    label.textContent = tab.label;
    close.setAttribute('aria-label', `Close ${tab.label}`);
  }

  private handleKey(id: string, event: KeyboardEvent): void {
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
    new ResizeObserver(() => this.updateScrollButtons()).observe(this.list);

    const scrollByTab = (direction: number) => {
      const tabWidth = this.list.querySelector('.tab')?.clientWidth ?? 100;
      this.list.scrollBy({ left: direction * tabWidth, behavior: 'smooth' });
    };
    this.scrollLeft.onclick = () => scrollByTab(-1);
    this.scrollRight.onclick = () => scrollByTab(1);
  }

  /** Split button like VS Code's terminal: + opens the first profile, ⌄ lists them */
  private setupNewTabButtons(): void {
    const newTab = document.getElementById('new-tab-default');
    const withProfile = document.getElementById('new-tab-profile');
    for (const button of [newTab, withProfile]) {
      if (button) keepFocus(button);
    }
    newTab?.addEventListener('click', () => this.post({ type: 'newTab' }));
    withProfile?.addEventListener('click', () => this.post({ type: 'newTabWithProfile' }));
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

/** Keeps focus in the terminal when a button is clicked */
function keepFocus(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}
