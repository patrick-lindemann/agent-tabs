import * as vscode from 'vscode';
import type { IconFiles } from '../dialogs';
import type { ExtensionMessage, WebviewMessage } from '../protocol';
import { isWebviewMessage } from '../validate';
import { renderHtml } from '../webview/html';

interface EditorAreaHost {
  receive(id: string, message: WebviewMessage): void;
  closed(id: string): void;
  viewed(id: string): void;
}

/** Renders moved tabs without owning their processes. */
export class EditorArea {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; ready: boolean }>();
  private panelNumber = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: EditorAreaHost
  ) {}

  has(id: string): boolean {
    return this.panels.has(id);
  }

  get count(): number {
    return this.panels.size;
  }

  /** Returns the moved tab in the active editor, if any. */
  getActiveId(): string | undefined {
    for (const [id, { panel }] of this.panels) {
      if (panel.active) {
        return id;
      }
    }
    return undefined;
  }

  /** Opens a panel in the active editor group. */
  move(id: string, name: string, iconPath: IconFiles): void {
    const panel = vscode.window.createWebviewPanel(
      `agentTabs.editor.${++this.panelNumber}`,
      name,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );
    panel.iconPath = iconPath;
    const entry = { panel, ready: false };
    this.panels.set(id, entry);
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isWebviewMessage(message) || ('id' in message && message.id !== id)) {
        return;
      }
      if (message.type === 'ready') {
        entry.ready = true;
      }
      this.host.receive(id, message);
    });
    const viewState = panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.host.viewed(id);
      }
    });
    panel.onDidDispose(() => {
      messages.dispose();
      viewState.dispose();
      if (this.panels.delete(id)) {
        this.host.closed(id);
      }
    });
    panel.webview.html = renderHtml(panel.webview, this.extensionUri, true);
    this.host.viewed(id);
  }

  show(id: string): void {
    this.panels.get(id)?.panel.reveal();
  }

  close(id: string): void {
    this.panels.get(id)?.panel.dispose();
  }

  closeFromMenu(resource: vscode.Uri): boolean {
    const id = this.getIdFromMenu(resource);
    if (id === undefined) {
      return false;
    }
    this.close(id);
    return true;
  }

  /** Returns the tab whose editor title menu VS Code opened. */
  getIdFromMenu(resource: vscode.Uri): string | undefined {
    if (resource.scheme !== 'webview-panel') {
      return undefined;
    }
    // VS Code sends a synthetic URI with the view type of the clicked tab.
    // Each panel has its own type so the menu can target an inactive tab.
    for (const [id, { panel }] of this.panels) {
      if (resource.path.startsWith(`webview-panel/webview-${panel.viewType}-`)) {
        return id;
      }
    }
    return undefined;
  }

  post(id: string, message: ExtensionMessage): void {
    const entry = this.panels.get(id);
    if (entry?.ready) {
      void entry.panel.webview.postMessage(message);
    }
  }

  /** Sets the editor tab's name and icon; an unchanged icon is kept, so its animation goes on */
  update(id: string, label: string, iconPath: IconFiles): void {
    const entry = this.panels.get(id);
    if (!entry) {
      return;
    }
    if (entry.panel.title !== label) {
      entry.panel.title = label;
    }
    if (iconKey(entry.panel.iconPath) !== iconKey(iconPath)) {
      entry.panel.iconPath = iconPath;
    }
  }

  dispose(): void {
    const entries = [...this.panels.values()];
    this.panels.clear();
    for (const { panel } of entries) {
      panel.dispose();
    }
  }
}

function iconKey(icon: vscode.WebviewPanel['iconPath']): string | undefined {
  if (!icon) {
    return undefined;
  }
  return 'light' in icon ? `${icon.light} ${icon.dark}` : icon.toString();
}
