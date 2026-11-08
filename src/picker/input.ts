import type { CommandFlag, PathContext, PathFilterMode } from '../types';

/**
 * What the custom command picker reads from its input line: the command,
 * the flags used so far and whether a flag's path value is being typed.
 * Free of VS Code so it can be tested on its own.
 */

/** Value hints that indicate path completion */
const PATH_HINTS = new Set([
  '<path>',
  'PATH',
  '[path]',
  '<file>',
  'FILE',
  '[file]',
  '<directory>',
  'DIRECTORY',
  '<dir>',
  'DIR',
  '[directory]',
  '[dir]'
]);
const DIRECTORY_HINTS = new Set([
  '<directory>',
  'DIRECTORY',
  '<dir>',
  'DIR',
  '[directory]',
  '[dir]'
]);
const FILE_HINTS = new Set(['<file>', 'FILE', '[file]']);

export function isPathValueHint(hint: string | undefined): boolean {
  if (!hint) return false;
  const normalized = hint.trim();
  // Also plurals and variations: paths, files, dirs, directories
  return (
    PATH_HINTS.has(normalized) || /\b(paths?|files?|dirs?|director(y|ies)?)\b/i.test(normalized)
  );
}

export function filterModeFor(hint: string | undefined): PathFilterMode {
  if (!hint) return 'all';
  const normalized = hint.trim();
  if (DIRECTORY_HINTS.has(normalized)) return 'directories';
  if (FILE_HINTS.has(normalized)) return 'files';
  if (/\b(dirs?|director(y|ies)?)\b/i.test(normalized)) return 'directories';
  if (/\bfiles?\b/i.test(normalized)) return 'files';
  return 'all';
}

export interface ParsedInput {
  command: string;
  /** Arguments before the one being typed */
  existingArgs: string[];
  /** A flag being typed, e.g. `--ver` */
  partial: string;
}

export function parseInput(value: string): ParsedInput {
  const parts = value.trim().split(/\s+/);
  const command = parts[0] || '';
  const args = parts.slice(1);
  const last = args[args.length - 1] || '';
  const isPartial = last.startsWith('-') && !last.includes('=');
  return {
    command,
    existingArgs: isPartial ? args.slice(0, -1) : args,
    partial: isPartial ? last : ''
  };
}

function pathContext(flag: CommandFlag, partialPath: string): PathContext {
  return {
    active: true,
    partialPath,
    filterMode: filterModeFor(flag.valueHint),
    isAbsolute: partialPath.startsWith('/') || partialPath.startsWith('~'),
    flag
  };
}

/** Whether the user is typing a path value for a flag, e.g. `cmd --dir src/co` */
export function detectPathContext(value: string, flags: CommandFlag[]): PathContext | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const endsWithSpace = /\s$/.test(value);
  const findFlag = (part: string) => flags.find((f) => f.flag === part || f.shortFlag === part);
  const takesPath = (flag: CommandFlag | undefined): flag is CommandFlag =>
    flag?.takesValue === true && isPathValueHint(flag.valueHint);

  // `command --flag `: the path value comes next
  const last = parts[parts.length - 1];
  if (endsWithSpace && last.startsWith('-')) {
    const flag = findFlag(last);
    if (takesPath(flag)) return pathContext(flag, '');
  }

  // Otherwise the last word may be the value of the flag before it
  for (let i = parts.length - 2; i >= 1; i--) {
    if (!parts[i].startsWith('-')) continue;
    const flag = findFlag(parts[i]);
    if (!takesPath(flag)) continue;

    const partialPath = parts[i + 1];
    // A value that is another flag, a finished value (trailing space) or
    // words after it end the path input
    if (partialPath.startsWith('-') || endsWithSpace || i + 1 < parts.length - 1) {
      return null;
    }
    return pathContext(flag, partialPath);
  }
  return null;
}

/** Flags not used yet (unless repeatable) that match the flag being typed */
export function availableFlags(
  flags: CommandFlag[],
  partial: string,
  existingArgs: string[]
): CommandFlag[] {
  const used = new Set(existingArgs.filter((arg) => arg.startsWith('-')));
  const lowerPartial = partial.toLowerCase();
  return flags.filter((f) => {
    if (!f.repeatable && (used.has(f.flag) || (f.shortFlag && used.has(f.shortFlag)))) {
      return false;
    }
    return (
      !partial ||
      f.flag.toLowerCase().includes(lowerPartial) ||
      (f.shortFlag?.toLowerCase().includes(lowerPartial) ?? false)
    );
  });
}

/** The input after picking a flag: replaces a flag being typed and adds a space */
export function insertFlag(value: string, flag: string): string {
  const parts = value.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.startsWith('-') && !last.includes('=')) {
    parts.pop();
  }
  const rest = parts.join(' ');
  return `${rest}${rest ? ' ' : ''}${flag} `;
}

/**
 * The input after picking a path: replaces the partial path or appends it
 * after the flag. Files get a trailing space for the next argument.
 */
export function insertPath(
  value: string,
  context: PathContext,
  path: string,
  isDirectory: boolean
): string {
  let result = value.trim();
  if (context.partialPath) {
    const parts = result.split(/\s+/);
    if (parts.length > 1) {
      parts[parts.length - 1] = path;
      result = parts.join(' ');
    }
  } else {
    result = `${result} ${path}`;
  }
  return isDirectory ? result : `${result} `;
}
