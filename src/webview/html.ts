import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** The webview's page: the tab bar, the terminal container and the bundled script */
export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString();
  const nonce = randomBytes(16).toString('hex');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${asset('xterm.css')}" rel="stylesheet">
    <link href="${asset('styles.css')}" rel="stylesheet">
</head>
<body>
    <div id="tab-bar">
        <button id="tab-scroll-left" class="tab-scroll" title="Scroll Left" aria-label="Scroll Left">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.928 7.976l4.357 4.357-.618.62L5 8.284v-.618L9.667 3l.618.619-4.357 4.357z"/></svg>
        </button>
        <div id="tab-list" role="tablist" aria-label="Terminal tabs"></div>
        <button id="tab-scroll-right" class="tab-scroll" title="Scroll Right" aria-label="Scroll Right">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>
        </button>
        <div id="new-tab" role="group" aria-label="New Tab">
            <button id="new-tab-default" title="New Tab" aria-label="New Tab">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
            </button>
            <button id="new-tab-profile" title="Use Profile…" aria-label="Use Profile…">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>
            </button>
        </div>
    </div>
    <div id="terminals-container"></div>
    <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
