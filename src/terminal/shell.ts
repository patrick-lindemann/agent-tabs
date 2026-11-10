/** Shell-specific helpers kept free of VS Code dependencies. */

/** How a shell reads a typed command line */
export type ShellKind = 'posix' | 'cmd' | 'powershell';

/** The kind of a shell by its executable, e.g. `pwsh.exe` */
export function shellKind(shell: string, platform: NodeJS.Platform = process.platform): ShellKind {
  const name = shell.replace(/^.*[\\/]/, '').toLowerCase();
  if (/^(?:pwsh|powershell)(?:\.exe)?$/.test(name)) return 'powershell';
  if (platform === 'win32' && !/^(?:bash|sh|zsh|fish)(?:\.exe)?$/.test(name)) return 'cmd';
  return 'posix';
}

export function shellClearCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'cls' : 'clear';
}

/**
 * Quotes a word so the shell passes it on unchanged. In `cmd.exe`, a quoted
 * word keeps its metacharacters and a quote inside it is doubled, which
 * programs read as one quote; `%NAME%` still expands, as cmd cannot escape
 * it inside quotes.
 */
export function shellQuote(arg: string, kind: ShellKind): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  if (kind === 'cmd') return `"${arg.replace(/"/g, '""')}"`;
  if (kind === 'powershell') return `'${arg.replace(/'/g, "''")}'`;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * The line typed into a shell to clear the screen and run a command, e.g.
 * with `agentTabs.directMode` off. PowerShell runs a quoted program with
 * `&`; Windows PowerShell 5 has no `&&`.
 */
export function shellRunLine(
  command: string,
  args: string[],
  kind: ShellKind,
  platform: NodeJS.Platform = process.platform
): string {
  const words = [command, ...args].map((word) => shellQuote(word, kind)).join(' ');
  if (kind === 'powershell') return `${shellClearCommand(platform)}; & ${words}`;
  return `${shellClearCommand(platform)} && ${words}`;
}
