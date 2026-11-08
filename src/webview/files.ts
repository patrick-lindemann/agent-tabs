import * as vscode from 'vscode';

/** POSIX, UNC (`\\server\share`) and Windows drive (`C:\`, `C:/`) paths */
export function isAbsoluteFilePath(filePath: string): boolean {
  return (
    filePath.startsWith('/') || filePath.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(filePath)
  );
}

function resolveUri(filePath: string, cwd: string | undefined): vscode.Uri {
  let resolved = filePath;
  if (resolved.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    resolved = resolved.replace('~', home);
  }
  if (isAbsoluteFilePath(resolved)) {
    return vscode.Uri.file(resolved);
  }
  if (cwd) {
    return vscode.Uri.file(`${cwd}/${resolved}`);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, resolved) : vscode.Uri.file(resolved);
}

/**
 * Opens a path clicked in the terminal, relative to the tab's working
 * directory or the first workspace folder, at a 1-based line and column.
 */
export async function openFile(
  filePath: string,
  cwd?: string,
  line?: number,
  column?: number
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(resolveUri(filePath, cwd));
    const editor = await vscode.window.showTextDocument(document);
    if (line !== undefined && line > 0) {
      const position = new vscode.Position(
        line - 1,
        column !== undefined && column > 0 ? column - 1 : 0
      );
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  } catch (error) {
    // A path-like word that is no file is common; no notification for it
    console.warn(`[SideMates] Failed to open file: ${filePath}`, error);
  }
}
