import type { XTermTheme } from './types';
export class ThemeBuilder {
  private cachedTheme: XTermTheme | null = null;
  private cachedFontFamily: string | null = null;

  private static readonly DEFAULT_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

  private getCssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  getFontFamily(): string {
    if (this.cachedFontFamily) {
      return this.cachedFontFamily;
    }

    // Read VSCode's editor font family from CSS variable
    const editorFont = this.getCssVar('--vscode-editor-font-family', '');
    this.cachedFontFamily = editorFont || ThemeBuilder.DEFAULT_FONT_FAMILY;

    return this.cachedFontFamily;
  }

  getTheme(): XTermTheme {
    if (this.cachedTheme) {
      return this.cachedTheme;
    }

    this.cachedTheme = {
      background: this.getCssVar(
        '--vscode-terminal-background',
        this.getCssVar('--vscode-editor-background', '#1e1e1e')
      ),
      foreground: this.getCssVar(
        '--vscode-terminal-foreground',
        this.getCssVar('--vscode-editor-foreground', '#d4d4d4')
      ),
      cursor: this.getCssVar('--vscode-terminalCursor-foreground', '#d4d4d4'),
      cursorAccent: this.getCssVar('--vscode-terminalCursor-background', '#1e1e1e'),
      selectionBackground: this.getCssVar('--vscode-terminal-selectionBackground', '#264f78'),
      black: this.getCssVar('--vscode-terminal-ansiBlack', '#000000'),
      red: this.getCssVar('--vscode-terminal-ansiRed', '#cd3131'),
      green: this.getCssVar('--vscode-terminal-ansiGreen', '#0dbc79'),
      yellow: this.getCssVar('--vscode-terminal-ansiYellow', '#e5e510'),
      blue: this.getCssVar('--vscode-terminal-ansiBlue', '#2472c8'),
      magenta: this.getCssVar('--vscode-terminal-ansiMagenta', '#bc3fbc'),
      cyan: this.getCssVar('--vscode-terminal-ansiCyan', '#11a8cd'),
      white: this.getCssVar('--vscode-terminal-ansiWhite', '#e5e5e5'),
      brightBlack: this.getCssVar('--vscode-terminal-ansiBrightBlack', '#666666'),
      brightRed: this.getCssVar('--vscode-terminal-ansiBrightRed', '#f14c4c'),
      brightGreen: this.getCssVar('--vscode-terminal-ansiBrightGreen', '#23d18b'),
      brightYellow: this.getCssVar('--vscode-terminal-ansiBrightYellow', '#f5f543'),
      brightBlue: this.getCssVar('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
      brightMagenta: this.getCssVar('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
      brightCyan: this.getCssVar('--vscode-terminal-ansiBrightCyan', '#29b8db'),
      brightWhite: this.getCssVar('--vscode-terminal-ansiBrightWhite', '#ffffff')
    };

    return this.cachedTheme;
  }

  invalidateCache(): void {
    this.cachedTheme = null;
    this.cachedFontFamily = null;
  }
}

