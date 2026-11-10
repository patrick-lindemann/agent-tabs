import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as stopword from 'stopword';
import { MULTIPLEXER_IDS, type MultiplexerId } from './terminal/multiplexer';
import type { AgentId, LaunchSpec } from './types';
import { innerProgram, type Program, programName } from './wrappers';

interface AgentDefinition {
  label: string;
  command: string;
  /** Other names of the executable */
  aliases?: string[];
  /** npm packages that install it, for `npx` and the like */
  packages?: string[];
  /**
   * Subcommands that do something other than start a conversation, e.g.
   * `claude doctor`; no conversation arguments go in front of them
   */
  subcommands?: string[];
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
  /** Reports no status; its tab's status comes from prompt detection */
  noStatus?: boolean;
  /**
   * Arguments that start a conversation with an ID the extension chooses
   * and that continue it, so a closed tab can be reopened. Not added when
   * the command line already picks a conversation with one of `conflicts`.
   */
  conversation?: {
    start: (id: string) => string[];
    resume: (id: string) => string[];
    conflicts: string[];
    /**
     * A line the agent prints when it starts a conversation with a new ID,
     * which the tab hides since the ID is new on purpose
     */
    startNotice?: (id: string) => string;
  };
}

/**
 * Agents the extension recognizes in a profile's command line: logo, title
 * format and status options. Everything else is configured in the agent.
 */
const AGENTS: Record<AgentId, AgentDefinition> = {
  claude: {
    label: 'Claude Code',
    command: 'claude',
    packages: ['@anthropic-ai/claude-code'],
    subcommands: [
      'agents',
      'attach',
      'auth',
      'auto-mode',
      'config',
      'doctor',
      'gateway',
      'import',
      'install',
      'logs',
      'mcp',
      'migrate-installer',
      'plugin',
      'plugins',
      'purge',
      'respawn',
      'rm',
      'setup-token',
      'stop',
      'kill',
      'ultrareview',
      'update',
      'upgrade'
    ],
    conversation: {
      start: (id) => ['--session-id', id],
      resume: (id) => ['--resume', id],
      conflicts: [
        '--session-id',
        '-r',
        '--resume',
        '-c',
        '--continue',
        '--fork-session',
        '--from-pr',
        '--teleport',
        '-p',
        '--print'
      ]
    }
  },
  codex: {
    label: 'Codex',
    command: 'codex',
    packages: ['@openai/codex'],
    statusArgs: [
      '-c',
      'tui.notification_method="osc9"',
      '-c',
      'tui.notifications=["agent-turn-complete","approval-requested"]',
      '-c',
      'tui.notification_condition="always"'
    ]
  },
  antigravity: { label: 'Antigravity', command: 'agy', noStatus: true },
  gemini: {
    label: 'Gemini CLI',
    command: 'gemini',
    packages: ['@google/gemini-cli'],
    noStatus: true
  },
  opencode: {
    label: 'OpenCode',
    command: 'opencode',
    packages: ['opencode-ai'],
    idleWhenDone: true
  },
  pi: {
    label: 'Pi',
    command: 'pi',
    packages: ['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent'],
    subcommands: ['auth', 'config', 'install', 'list', 'mcp', 'remove', 'uninstall', 'update'],
    // Opens the conversation with the ID, or starts it
    conversation: {
      start: (id) => ['--session-id', id],
      resume: (id) => ['--session-id', id],
      startNotice: (id) =>
        `Warning: No project session found with id '${id}'; creating a new session with that id.`,
      conflicts: [
        '--session-id',
        '--session',
        '-c',
        '--continue',
        '-r',
        '--resume',
        '--fork',
        '--no-session',
        '-p',
        '--print',
        '--export'
      ]
    }
  },
  cursor: {
    label: 'Cursor',
    command: 'agent',
    aliases: ['cursor-agent'],
    noStatus: true,
    subcommands: [
      'about',
      'create-chat',
      'generate-rule',
      'help',
      'install-shell-integration',
      'login',
      'logout',
      'ls',
      'mcp',
      'resume',
      'rule',
      'status',
      'uninstall-shell-integration',
      'update',
      'upgrade',
      'whoami'
    ],
    // An unknown ID starts a chat with that ID
    conversation: {
      start: (id) => ['--resume', id],
      resume: (id) => ['--resume', id],
      conflicts: ['--resume', '--continue', 'resume', 'ls', 'create-chat', '-p', '--print']
    }
  },
  copilot: {
    label: 'GitHub Copilot',
    command: 'copilot',
    packages: ['@github/copilot'],
    noStatus: true
  },
  grok: { label: 'Grok Build', command: 'grok' },
  hermes: { label: 'Hermes Agent', command: 'hermes' },
  devin: { label: 'Devin', command: 'devin' }
};

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

/**
 * Whether an agent reports its status (OSC 7501), so that a message counts
 * as sent when it starts working rather than on Enter
 */
export function reportsStatus(agent: AgentId | undefined): boolean {
  return agent !== undefined && !AGENTS[agent].noStatus;
}

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
 * Builds what a tab runs from a command line. The program it runs, also
 * behind a wrapper, e.g. `claude` in `env A=1 claude` or `npx
 * @openai/codex`, gives the tab the agent's logo, title format and status
 * support, and its status arguments follow it.
 */
function launchFromWords(
  label: string,
  words: string[],
  commandLine: string,
  programStatus: boolean
): LaunchSpec {
  const program = innerProgram(words);
  const agent = program && agentOfProgram(program);
  const statusArgs = agent && programStatus ? (AGENTS[agent].statusArgs ?? []) : [];
  const all = [...words];
  if (program && statusArgs.length > 0 && !program.shell) {
    all.splice(program.index + 1, 0, ...statusArgs);
  }
  return { label, command: all[0], args: all.slice(1), env: {}, agent, commandLine };
}

/**
 * A new conversation ID for a launch, when its agent can start a
 * conversation with a given ID and the command line does not pick one
 * already.
 */
export function newConversation(launch: LaunchSpec): string | undefined {
  const conversation = launch.agent && AGENTS[launch.agent].conversation;
  if (!conversation || agentIndex(launch) === undefined) return undefined;
  const conflict = launch.args.some((arg) =>
    conversation.conflicts.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
  );
  return conflict ? undefined : randomUUID();
}

/**
 * Matches the line an agent prints when it starts the conversation with a
 * new ID, with its colors and line break, e.g. pi's warning that no session
 * has the ID yet
 */
export function startNotice(launch: LaunchSpec, id: string): RegExp | undefined {
  const notice = launch.agent && AGENTS[launch.agent].conversation?.startNotice?.(id);
  if (!notice) return undefined;
  const escaped = notice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\x1b\\[[0-9;]*m)*${escaped}(?:\\x1b\\[[0-9;]*m)*\\r?\\n?`);
}

/**
 * The launch with the arguments that start (`resume` false) or continue a
 * conversation, right after the agent's executable.
 */
export function withConversation(launch: LaunchSpec, id: string, resume: boolean): LaunchSpec {
  const conversation = launch.agent && AGENTS[launch.agent].conversation;
  const index = agentIndex(launch);
  if (!conversation || index === undefined) return launch;
  const words = [launch.command, ...launch.args];
  words.splice(index + 1, 0, ...(resume ? conversation.resume(id) : conversation.start(id)));
  return { ...launch, command: words[0], args: words.slice(1) };
}

/**
 * Where the launch's agent is among its words, for arguments that follow
 * it. Undefined when it runs inside a command string, e.g. `bash -c
 * "claude"`, or a subcommand follows it, e.g. `claude doctor`.
 */
function agentIndex(launch: LaunchSpec): number | undefined {
  const words = [launch.command, ...launch.args];
  const program = innerProgram(words);
  const agent = program && agentOfProgram(program);
  if (!program || !agent || agent !== launch.agent || program.shell) return undefined;
  const next = words[program.index + 1];
  if (next !== undefined && AGENTS[agent].subcommands?.includes(next)) return undefined;
  return program.index;
}

/** The agent an executable is, by its name, also as a path */
function agentOf(word: string): AgentId | undefined {
  const name = programName(word);
  return AGENT_IDS.find((id) => AGENTS[id].command === name || AGENTS[id].aliases?.includes(name));
}

/** The agent a program is: its executable, or for `npx` and the like its package */
function agentOfProgram(program: Program): AgentId | undefined {
  if (program.package) {
    const found = AGENT_IDS.find((id) => AGENTS[id].packages?.includes(program.name));
    if (found) return found;
  }
  return agentOf(program.name);
}

/** A profile as written in `agentTabs.profiles` */
export interface ProfileSetting {
  command: string;
  name?: string;
  env?: Record<string, string>;
  multiplexer?: MultiplexerId | 'none';
}

/** `agentTabs.multiplexer` or a profile's `multiplexer`, if valid */
export function multiplexerSetting(value: unknown): MultiplexerId | 'none' {
  return MULTIPLEXER_IDS.includes(value as MultiplexerId) ? (value as MultiplexerId) : 'none';
}

/**
 * The profile `agentTabs.defaultProfile` names; the first profile when unset
 * or not found.
 */
export function defaultProfile(
  profiles: LaunchSpec[],
  setting: unknown
): { profile: LaunchSpec; problem?: string } {
  const name = typeof setting === 'string' ? setting.trim() : '';
  if (!name) return { profile: profiles[0] };
  const profile = profiles.find((candidate) => candidate.label === name);
  if (profile) return { profile };
  return {
    profile: profiles[0],
    problem: `the default profile "${name}" is not one of the profiles, so "${profiles[0].label}" is used`
  };
}

/**
 * Resolves `agentTabs.profiles`, a list of profiles with a unique name, a
 * command line and optionally environment variables and a multiplexer, in
 * the order of the setting. Invalid entries are skipped and described in
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
  const list = Array.isArray(setting) ? setting : [];

  if (setting !== undefined && !Array.isArray(setting)) {
    problems.push(
      'it must be a list of profiles, e.g. [{ "name": "Claude", "command": "claude" }]'
    );
  }
  for (const [index, entry] of list.entries()) {
    const { command, name, env, multiplexer } = (
      typeof entry === 'object' && entry !== null ? entry : {}
    ) as Record<string, unknown>;
    const position = `profile ${index + 1}`;
    const words = typeof command === 'string' ? splitCommandLine(command) : undefined;
    if (typeof command !== 'string' || !command.trim()) {
      problems.push(`${position} needs a command`);
    } else if (!words?.length) {
      problems.push(`the command of ${position} has an unclosed quote`);
    } else if (typeof name !== 'string' || !name.trim()) {
      problems.push(`${position} needs a name`);
    } else if (profiles.some((profile) => profile.label === name.trim())) {
      problems.push(`the name of ${position}, "${name.trim()}", is already taken`);
    } else if (
      env !== undefined &&
      (typeof env !== 'object' ||
        env === null ||
        Array.isArray(env) ||
        Object.values(env).some((value) => typeof value !== 'string'))
    ) {
      problems.push(`the env of ${position} must map names to text`);
    } else if (
      multiplexer !== undefined &&
      multiplexer !== 'none' &&
      !MULTIPLEXER_IDS.includes(multiplexer as MultiplexerId)
    ) {
      problems.push(
        `the multiplexer of ${position} must be ${[...MULTIPLEXER_IDS, 'none'].join(', ')}`
      );
    } else {
      const launch = launchFromWords(name.trim(), words, command.trim(), programStatus);
      launch.env = { ...(env as Record<string, string> | undefined) };
      launch.profile = launch.label;
      if (multiplexer !== undefined) launch.multiplexer = multiplexer as MultiplexerId | 'none';
      profiles.push(launch);
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

/** The agent's name, e.g. `Claude Code`, or the program's, e.g. `htop` */
function defaultLabel(launch: LaunchSpec): string {
  return launch.agent ? AGENTS[launch.agent].label : path.basename(launch.command);
}

/**
 * The first program a launch needs that cannot be found: its command, or the
 * program a wrapper runs from the PATH, e.g. `claude` in `env A=1 claude` or
 * `tmux new-session claude`. A program that runs elsewhere is not looked
 * for: on another machine (`ssh`) or from a package (`npx`). Inside a
 * shell's command string, only an agent is, since the string may start
 * with a shell builtin. `searchPath` is the PATH the terminal gets.
 */
export function missingCommand(launch: LaunchSpec, searchPath?: string): string | undefined {
  if (!isInstalled(launch.command, searchPath)) return launch.command;
  const words = [launch.command, ...launch.args];
  const program = innerProgram(words);
  if (!program || program.index === 0 || program.remote || program.package) return undefined;
  if (program.shell && !agentOf(program.name)) return undefined;
  const command = program.shell ? words[program.index].trim().split(/\s/)[0] : words[program.index];
  return isInstalled(command, searchPath) ? undefined : command;
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
  const launch = launchFromWords('', words, words.map(quoteWord).join(' '), programStatus);
  launch.label = defaultLabel(launch);
  return launch;
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
    // The folder may contain hyphens, e.g. `agent-tabs`, but not ` - `
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
