import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Starting programs on Windows. node-pty looks for a program by its exact
 * name on the extension host's PATH, without PATHEXT, so `claude` is not
 * found as `claude.exe`. And batch files, e.g. the `.cmd` shims npm installs
 * for codex, gemini or pi, only run through `cmd.exe`. VS Code's terminal
 * resolves programs itself for the same reason.
 */

/** The name of the PATH variable in an environment; Windows writes it `Path` */
export function pathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
}

/**
 * The full path of a program, like the shell finds it: a path as given, or
 * the first match on the search path, also with an extension of PATHEXT.
 * Undefined when there is none.
 */
export function resolveExecutable(
  command: string,
  searchPath: string,
  pathext = '.COM;.EXE;.BAT;.CMD',
  exists: (file: string) => boolean = isFile
): string | undefined {
  const extensions = pathext
    .split(';')
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  // A name with an extension is tried as it is first, e.g. `codex.cmd`
  const candidates = (base: string) => [
    ...(path.win32.extname(base) ? [base] : []),
    ...extensions.map((extension) => base + extension)
  ];
  if (/[\\/]/.test(command)) {
    return candidates(command).find(exists);
  }
  for (const dir of searchPath.split(';').filter(Boolean)) {
    const found = candidates(path.win32.join(dir, command)).find(exists);
    if (found) return found;
  }
  return undefined;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Characters `cmd.exe` gives a meaning, which a caret escapes */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Quotes a word for a program's command line as `CommandLineToArgvW` reads
 * it, then escapes it for `cmd.exe`. npm's shims in `node_modules\.bin`
 * read their arguments twice and need the escape twice. The same as
 * cross-spawn, which Node tools use for this.
 */
export function cmdArgument(word: string, twice = false): string {
  let quoted = word
    // Backslashes before a quote double, and the quote is escaped
    .replace(/(\\*)"/g, '$1$1\\"')
    // Backslashes at the end double, since a quote follows them
    .replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`.replace(CMD_META, '^$1');
  return twice ? quoted.replace(CMD_META, '^$1') : quoted;
}

/** Escapes a program's path for `cmd.exe` */
export function cmdCommand(command: string): string {
  return command.replace(CMD_META, '^$1');
}

/**
 * How node-pty starts a program on Windows: an executable by its full path,
 * a batch file through `cmd.exe`. `args` is a ready command line for
 * `cmd.exe`, which node-pty passes on unchanged.
 */
export function windowsLaunch(
  file: string,
  args: string[],
  comspec = 'cmd.exe'
): { file: string; args: string[] | string } {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args };
  const twice = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [cmdCommand(file), ...args.map((arg) => cmdArgument(arg, twice))].join(' ');
  return { file: comspec, args: `/d /s /c "${line}"` };
}
