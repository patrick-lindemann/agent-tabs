import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** The webview's page: the container of the panes, which the bundled script fills */
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
    <div id="panes"></div>
    <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
