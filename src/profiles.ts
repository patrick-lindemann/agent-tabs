import * as fs from 'node:fs';
import * as path from 'node:path';
import * as stopword from 'stopword';
import type { AgentId, LaunchSpec } from './types';

interface AgentDefinition {
  label: string;
  command: string;
  /** Other names of the executable */
  aliases?: string[];
  /**
   * Arguments the extension needs for status reporting. Codex reports
   * `working` and `idle` but no `done`; with these options it writes an OSC 9
   * notification when a turn completes or needs approval, which tells a
   * finished turn apart from a cancelled one.
   */
  statusArgs?: string[];
  /**
   * Reports `idle` instead of `done` when a turn completes. Other agents
   * report `idle` after `working` only when the user cancels.
   */
  idleWhenDone?: boolean;
}

/**
 * Agents the extension recognizes in a profile's command line: logo, title
 * format and status options. Everything else is configured in the agent.
 */
const AGENTS: Record<AgentId, AgentDefinition> = {
  claude: { label: 'Claude Code', command: 'claude' },
  codex: {
    label: 'Codex',
    command: 'codex',
    statusArgs: [
      '-c',
      'tui.notification_method="osc9"',
      '-c',
      'tui.notifications=["agent-turn-complete","approval-requested"]',
      '-c',
      'tui.notification_condition="always"'
    ]
  },
  antigravity: { label: 'Antigravity', command: 'agy' },
  gemini: { label: 'Gemini CLI', command: 'gemini' },
  opencode: { label: 'OpenCode', command: 'opencode', idleWhenDone: true },
  pi: { label: 'Pi', command: 'pi' },
  cursor: { label: 'Cursor', command: 'agent', aliases: ['cursor-agent'] },
  copilot: { label: 'GitHub Copilot', command: 'copilot' },
  grok: { label: 'Grok Build', command: 'grok' },
  hermes: { label: 'Hermes Agent', command: 'hermes' },
  devin: { label: 'Devin', command: 'devin' }
};

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

/** Whether an agent reports `idle` instead of `done` when a turn completes */
export function idleWhenDone(agent: AgentId | undefined): boolean {
  return agent !== undefined && AGENTS[agent].idleWhenDone === true;
}

/**
 * Splits a command line into words like a POSIX shell: quotes group words and
 * a backslash escapes the next character, except on Windows, where it
 * separates path segments. Returns undefined for an unclosed quote.
 */
export function splitCommandLine(line: string): string[] | undefined {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;
  const escapes = process.platform !== 'win32';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (escapes && char === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1]))
        word += line[++i];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (escapes && char === '\\' && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (quote) return undefined;
  if (inWord) words.push(word);
  return words;
}

/** Quotes a word so `splitCommandLine` reads it back unchanged */
function quoteWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds what a tab runs from a command line. The first word that names a
 * known agent, e.g. `claude` in `tmux new-session claude`, gives the tab the
 * agent's logo, title format and status support; when that word is the
 * agent's executable itself, its status arguments follow it.
 */
function launchFromWords(
  label: string,
  words: string[],
  commandLine: string,
  programStatus: boolean
): LaunchSpec {
  const index = words.findIndex((word) => agentOf(word) !== undefined);
  const agent = index >= 0 ? agentOf(words[index]) : undefined;
  const statusArgs = agent && programStatus ? (AGENTS[agent].statusArgs ?? []) : [];
  const all = [...words];
  // A shell's `-c` takes one command string; words after it are not its arguments
  const shellCommand = index > 0 && /^-\w*c$/.test(words[index - 1]);
  if (statusArgs.length > 0 && !/\s/.test(words[index]) && !shellCommand) {
    all.splice(index + 1, 0, ...statusArgs);
  }
  return { label, command: all[0], args: all.slice(1), env: {}, agent, commandLine };
}

/** The agent a word runs: its executable, also as a path or inside a quoted command */
function agentOf(word: string): AgentId | undefined {
  const name = path.basename(word.trim().split(/\s/)[0]).replace(/\.(exe|cmd)$/i, '');
  return AGENT_IDS.find((id) => AGENTS[id].command === name || AGENTS[id].aliases?.includes(name));
}

/**
 * Resolves `agentTabs.profiles`, a table of names and command lines, in
 * the order of the settings. Invalid entries are skipped and described in
 * `problems`.
 *
 * Without any profile, there is one for each known agent that is installed,
 * or for all of them when none is found.
 */
export function resolveProfiles(
  setting: unknown,
  programStatus: boolean
): { profiles: LaunchSpec[]; problems: string[] } {
  const problems: string[] = [];
  const profiles: LaunchSpec[] = [];
  const table = setting;

  if (
    table !== undefined &&
    (typeof table !== 'object' || table === null || Array.isArray(table))
  ) {
    problems.push('it must map names to command lines');
  } else {
    for (const [name, line] of Object.entries(table ?? {})) {
      const words = typeof line === 'string' ? splitCommandLine(line) : undefined;
      if (!name.trim()) {
        problems.push('a profile has no name');
      } else if (typeof line !== 'string' || !line.trim()) {
        problems.push(`"${name}" needs a command`);
      } else if (!words?.length) {
        problems.push(`the command of "${name}" has an unclosed quote`);
      } else {
        profiles.push(launchFromWords(name.trim(), words, line.trim(), programStatus));
      }
    }
  }

  if (profiles.length === 0) {
    const installed = AGENT_IDS.filter((agent) => isInstalled(AGENTS[agent].command));
    for (const agent of installed.length > 0 ? installed : AGENT_IDS) {
      const { label, command } = AGENTS[agent];
      profiles.push(launchFromWords(label, [command], command, programStatus));
    }
  }
  return { profiles, problems };
}

/**
 * The first program a launch needs that cannot be found: its command, or the
 * agent it wraps, e.g. `claude` in `tmux new-session claude`. `searchPath` is
 * the PATH the terminal gets.
 */
export function missingCommand(launch: LaunchSpec, searchPath?: string): string | undefined {
  if (!isInstalled(launch.command, searchPath)) return launch.command;
  if (!launch.agent || agentOf(launch.command) === launch.agent) return undefined;
  const wrapped = launch.args
    .map((arg) => arg.trim().split(/\s/)[0])
    .find((word) => agentOf(word) === launch.agent);
  return wrapped && !isInstalled(wrapped, searchPath) ? wrapped : undefined;
}

/**
 * Whether a command resolves to an executable file, like the shell would find
 * it: a path as given, a name on the PATH of the machine the extension runs
 * on (with PATHEXT on Windows).
 */
export function isInstalled(command: string, searchPath = process.env.PATH ?? ''): boolean {
  const isFile = (file: string) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes('/') || command.includes('\\')) {
    return isFile(command);
  }
  const extensions =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')]
      : [''];
  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => extensions.some((extension) => isFile(path.join(dir, command + extension))));
}

/**
 * Launches a custom command as given. A known agent in it, e.g.
 * `/usr/local/bin/codex`, gets its logo, title format and status arguments.
 */
export function launchForCommand(
  command: string,
  args: string[],
  programStatus: boolean
): LaunchSpec {
  const words = [command, ...args];
  const agent = agentOf(command);
  const label = agent ? AGENTS[agent].label : path.basename(command);
  return launchFromWords(label, words, words.map(quoteWord).join(' '), programStatus);
}

type StopwordLanguage = Exclude<keyof typeof stopword, 'removeStopwords'>;

const STOPWORD_LISTS = Object.entries(stopword)
  .filter((entry): entry is [StopwordLanguage, string[]] => Array.isArray(entry[1]))
  .map(([, words]) => new Set(words));

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * Shortens a title for a tab, keeping its case: `Refactor the API client`
 * becomes `Refactor API client`. Words are split per language
 * (`Intl.Segmenter`, also for scripts without spaces). Filler words are
 * removed with the stopword list that matches most of the title's words;
 * languages without a list keep all their words. When only one word would be
 * left, the title keeps its filler words. Kept words are joined as in
 * the title: with a space where it had one, directly in scripts without
 * spaces.
 */
export function shortTitle(text: string, maxWords: number): string | undefined {
  const words = [...wordSegmenter.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map(({ segment, index }) => ({ segment, index, key: segment.toLowerCase() }));

  let fillers: Set<string> | undefined;
  let bestMatches = 0;
  for (const list of STOPWORD_LISTS) {
    const matches = words.filter((word) => list.has(word.key)).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      fillers = list;
    }
  }

  const meaningful = fillers ? words.filter((word) => !fillers.has(word.key)) : words;
  // A single word says too little, e.g. `work` from `Make it work`
  const kept = (meaningful.length > 1 || maxWords === 1 ? meaningful : words).slice(0, maxWords);
  let title = '';
  kept.forEach((word, position) => {
    if (position > 0) {
      const previous = kept[position - 1];
      const gap = text.slice(previous.index + previous.segment.length, word.index);
      const skipped = words.some((w) => w.index > previous.index && w.index < word.index);
      title += /\s/.test(gap) ? ' ' : skipped ? '' : gap;
    }
    title += word.segment;
  });
  return title || undefined;
}

/**
 * Turns a terminal title (OSC 0/2) into a short tab label, or undefined when
 * it carries nothing beyond the program name or folder.
 *
 * - pi: `π - <session name> - <folder>`; only a named session gives a label.
 * - Claude Code: `<spinner or ✳> <summary of the conversation>`.
 * - Gemini CLI: `<glyph>  <state or current thought> (<folder>)`, padded to
 *   80 characters; only a thought gives a label.
 * - Codex: `<activity> | <thread name> | <project>`, with `[ ! ] Action
 *   Required` as the activity while it waits; only a named thread gives a
 *   label.
 * - OpenCode: `OC | <session title>`.
 * - Others: the title without leading status glyphs.
 */
export function labelFromTitle(title: string, launch: LaunchSpec): string | undefined {
  let label: string | undefined;
  if (launch.agent === 'pi') {
    // The folder may contain hyphens, e.g. `agent-terminal`, but not ` - `
    label = /^π - (.+) - (?:(?! - ).)+$/.exec(title)?.[1];
  } else if (launch.agent === 'gemini') {
    label = title
      .trim()
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/ \([^()]*\)$/, '');
    if (/^(?:Ready|Working…|Action Required|Gemini CLI)$/.test(label)) label = undefined;
  } else if (launch.agent === 'codex') {
    const parts = title
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .split(' | ')
      .map((part) => part.trim());
    if (/^(?:Ready|Working|Waiting|Thinking|Starting|Action Required)$/.test(parts[0])) {
      parts.shift();
    }
    // The last part is the project folder
    label = parts.length > 1 ? parts.slice(0, -1).join(' | ') : undefined;
  } else if (launch.agent === 'opencode') {
    label = /^OC \| (.+)$/i.exec(title)?.[1];
  } else {
    label = title.replace(/^[^\p{L}\p{N}]+/u, '');
  }
  label = label?.trim();
  if (!label || label.toLowerCase() === launch.label.toLowerCase()) {
    return undefined;
  }
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
