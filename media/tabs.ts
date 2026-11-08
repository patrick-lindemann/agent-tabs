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

  render(tabs: TabInfo[], statusColors: boolean, monochromeIcons: boolean): void {
    this.list.replaceChildren(...tabs.map((tab) => this.createTab(tab, monochromeIcons)));
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

  private createTab(tab: TabInfo, monochromeIcons: boolean): HTMLDivElement {
    const element = document.createElement('div');
    element.className = `tab ${tab.isActive ? 'active' : ''}`;
    element.dataset.id = tab.id;
    element.setAttribute('role', 'tab');
    element.setAttribute('aria-selected', String(tab.isActive));
    element.setAttribute(
      'aria-label',
      tab.statusText ? `${tab.label}, ${tab.statusText}` : tab.label
    );
    // The full title and the status, since the label is a short key
    element.title = [tab.description, tab.statusText].filter(Boolean).join('\n');
    if (tab.status) {
      element.dataset.status = tab.status;
    }
    if (tab.accentColor) {
      element.style.setProperty('--tab-accent', tab.accentColor);
    }
    // Read by VS Code for the `webview/context` menu (Close, Close Others)
    element.dataset.vscodeContext = JSON.stringify({
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

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = 'Close';
    close.innerHTML = CLOSE_ICON;
    keepFocus(close);
    close.onclick = (event) => {
      event.stopPropagation();
      this.post({ type: 'closeTab', id: tab.id });
    };

    element.onclick = () => {
      if (tab.isActive) {
        this.focusActive();
      } else {
        this.post({ type: 'switchTab', id: tab.id });
      }
    };
    // Middle-click closes, like editor tabs
    element.onauxclick = (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.post({ type: 'closeTab', id: tab.id });
      }
    };

    element.append(status, label, close);
    return element;
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

/** Keeps focus in the terminal when a button is clicked */
function keepFocus(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}
