import * as path from 'node:path';

/** The program a command line runs, after any wrappers around it */
export interface Program {
  /** Its position among the command line's words */
  index: number;
  /**
   * The executable's name, e.g. `claude` from `/usr/bin/claude` or `bash -c
   * "claude -c"`, or the package's, e.g. `@anthropic-ai/claude-code` from
   * `npx @anthropic-ai/claude-code@latest`
   */
  name: string;
  /** Runs from a package a runner like `npx` may download first */
  package?: boolean;
  /** Runs on another machine, e.g. `ssh devbox claude` */
  remote?: boolean;
  /**
   * Runs inside a shell's command string, e.g. `bash -lc "claude"`, where
   * arguments added after it would not reach it
   */
  shell?: boolean;
}

/** The name of an executable, e.g. `codex` from `C:\Tools\codex.exe` */
export function programName(word: string): string {
  return path
    .basename(word.trim().split(/\s/)[0])
    .replace(/^.*\\/, '')
    .replace(/\.(exe|cmd|bat|ps1)$/i, '');
}

/** The name of a package without its version, e.g. `@openai/codex` from `@openai/codex@1.2` */
function packageName(word: string): string {
  return word.replace(/(.)@[^@/]*$/, '$1');
}

/**
 * The position after a wrapper's options, starting at `start`. Short
 * options in `withValue` take the rest of their word, or the next word when
 * they end it; long ones in `long` take the next word.
 */
function skipOptions(
  words: string[],
  start: number,
  withValue: string,
  long: string[] = []
): { index: number; letters: string } {
  let index = start;
  let letters = '';
  while (index < words.length) {
    const word = words[index];
    if (word === '--') return { index: index + 1, letters };
    if (!word.startsWith('-') || word === '-') break;
    if (word.startsWith('--')) {
      index += long.includes(word) ? 2 : 1;
      continue;
    }
    const valueAt = [...word.slice(1)].findIndex((letter) => withValue.includes(letter));
    letters += valueAt < 0 ? word.slice(1) : word.slice(1, valueAt + 2);
    index += valueAt === word.length - 2 ? 2 : 1;
  }
  return { index, letters };
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh']);

/** Runners that run a package's executable, possibly after downloading it */
const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

/** Package managers whose subcommand runs a package, e.g. `pnpm dlx` */
const PACKAGE_SUBCOMMANDS: Record<string, string> = { pnpm: 'dlx', yarn: 'dlx', bun: 'x' };

type Step = { index: number } & Omit<Program, 'index' | 'name'>;

/**
 * Where the command a wrapper runs starts, or undefined when the word is
 * not a wrapper or runs no command, e.g. `tmux ls`
 */
function unwrap(name: string, words: string[], at: number): Step | undefined {
  const next = at + 1;
  if (name === 'env') {
    const options = skipOptions(words, next, 'uCS', ['--unset', '--chdir', '--split-string']);
    // `-S` splits a string into words, which this does not follow
    if (options.letters.includes('S')) return undefined;
    let index = options.index;
    while (index < words.length && /^[A-Za-z_]\w*=/.test(words[index])) index++;
    return { index };
  }
  if (name === 'nohup' || name === 'time' || name === 'nice') {
    return { index: skipOptions(words, next, 'n').index };
  }
  if (PACKAGE_RUNNERS.has(name)) {
    const options = skipOptions(words, next, 'pc', ['--package', '--call']);
    return options.letters.includes('c') ? undefined : { index: options.index, package: true };
  }
  if (PACKAGE_SUBCOMMANDS[name] !== undefined) {
    if (words[next] !== PACKAGE_SUBCOMMANDS[name]) return undefined;
    return { index: skipOptions(words, next + 1, 'p', ['--package']).index, package: true };
  }
  if (name === 'tmux') {
    const command = skipOptions(words, next, 'cfLST').index;
    if (words[command] !== 'new-session' && words[command] !== 'new') return undefined;
    return { index: skipOptions(words, command + 1, 'cefFnstxy').index };
  }
  if (name === 'abduco') {
    // `abduco [-e key] -c|-n|-A <name> <command>`
    const options = skipOptions(words, next, 'e');
    return /[cnA]/.test(options.letters) ? { index: options.index + 1 } : undefined;
  }
  if (name === 'ssh') {
    const host = skipOptions(words, next, 'BbcDEeFIiJLlmOoPpQRSWw').index;
    return { index: host + 1, remote: true };
  }
  if (SHELLS.has(name)) {
    // `-c` or a group of options ending in it, e.g. `-lc`
    const flag = words.findIndex((word, position) => position > at && /^-\w*c$/.test(word));
    return flag < 0 ? undefined : { index: flag + 1, shell: true };
  }
  return undefined;
}

/**
 * The program a command line runs: its first word, or the command a known
 * wrapper around it runs, e.g. `claude` in `env A=1 claude`, `npx
 * @openai/codex`, `tmux new-session -s x -- claude`, `ssh devbox claude` or
 * `bash -lc "claude --continue"`. Other words never count, e.g. `claude` in
 * `tmux new -s claude` or `git log --author pi`.
 */
export function innerProgram(words: string[]): Program | undefined {
  let index = 0;
  const flags: Omit<Program, 'index' | 'name'> = {};
  while (index < words.length) {
    const name = programName(words[index]);
    // A shell's command string is one word; its program is its first
    const step = flags.shell ? undefined : unwrap(name, words, index);
    if (!step || step.index >= words.length) {
      return { index, name: flags.package ? packageName(words[index]) : name, ...flags };
    }
    index = step.index;
    if (step.package) flags.package = true;
    if (step.remote) flags.remote = true;
    if (step.shell) flags.shell = true;
  }
  return undefined;
}
