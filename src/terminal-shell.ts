/** Shell-specific helpers kept free of VS Code dependencies. */
export function shellClearCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'cls' : 'clear';
}

export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[\\w@%+=:,./-]+$/.test(arg)) return arg;
  if (platform === 'win32') {
    // cmd.exe uses double quotes; double embedded quotes and escape metacharacters.
    return `"${arg.replace(/([%&|<>^])/g, '^$1').replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
