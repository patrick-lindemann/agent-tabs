import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { LaunchSpec } from '../types';

/**
 * Terminal multiplexers that keep a tab's program running without VS Code,
 * e.g. while a laptop is disconnected from its remote. A tab runs a client
 * that shows the session; closing the tab ends the session, closing the
 * window or losing the connection only ends the client, and the tab
 * attaches again when the window opens.
 */
export type MultiplexerId = 'tmux' | 'abduco';

export const MULTIPLEXER_IDS: readonly MultiplexerId[] = ['tmux', 'abduco'];

export interface Command {
  command: string;
  args: string[];
}

/**
 * What a session belongs to, stored with it on the machine it runs on: its
 * workspace and the tab that shows it. Only sessions with a tag are
 * listed, restored or cleaned up, so sessions the extension did not start
 * are never touched.
 */
export interface SessionTag {
  /** The workspace's folders or workspace file */
  workspace: string;
  launch: LaunchSpec;
  cwd?: string;
  workspaceFolderIndex?: number;
  /** When the session started, to restore tabs in order */
  created: number;
  /**
   * The agent's conversation, to reopen the tab after it closes, and whether
   * a message was sent in it; tags written before 3.2 do not say, and count
   * as started
   */
  conversation?: { id: string; started?: boolean };
}

/** A session the extension started */
export interface SessionEntry {
  name: string;
  tag: SessionTag;
  /** The program ended and the session only keeps its exit code */
  ended: boolean;
  /** A client shows the session, e.g. in another window */
  attached: boolean;
}

export interface SessionOptions {
  /** Session name, unique per tab */
  session: string;
  /** What the session runs */
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  cols: number;
  rows: number;
  /** Stored with a new session */
  tag: SessionTag;
}

/** A word for `sh` that it reads back unchanged */
function shWord(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * Writes environment variables to a new file only the user can read, as
 * `sh` commands that export them, so their values, e.g. API keys, do not
 * appear on a command line where every user sees them in `ps`. Returns
 * its path, or undefined without variables. Names `sh` cannot export are
 * skipped.
 */
export function writeEnvironmentFile(
  env: Record<string, string>,
  folder = os.tmpdir()
): string | undefined {
  const lines = Object.entries(env)
    .filter(([key]) => /^[A-Za-z_]\w*$/.test(key))
    .map(([key, value]) => `export ${key}=${shWord(value)}\n`);
  if (lines.length === 0) return undefined;
  const file = path.join(folder, `agent-tabs-env-${randomBytes(8).toString('hex')}`);
  // `wx` fails on an existing file or link instead of writing through it
  fs.writeFileSync(file, lines.join(''), { mode: 0o600, flag: 'wx' });
  return file;
}

/** Encodes a tag for storing it in one tmux option or file */
export function encodeTag(tag: SessionTag): string {
  return Buffer.from(JSON.stringify(tag), 'utf8').toString('base64');
}

/** Reads a stored tag; anything that is not one gives undefined */
export function decodeTag(text: string): SessionTag | undefined {
  try {
    const tag = JSON.parse(
      Buffer.from(text.trim(), 'base64').toString('utf8')
    ) as Partial<SessionTag>;
    const launch = tag.launch as Partial<LaunchSpec> | undefined;
    if (
      typeof tag.workspace !== 'string' ||
      typeof tag.created !== 'number' ||
      typeof launch?.command !== 'string' ||
      typeof launch.label !== 'string' ||
      !Array.isArray(launch.args)
    ) {
      return undefined;
    }
    return { ...tag, launch: { env: {}, commandLine: launch.command, ...launch } } as SessionTag;
  } catch {
    return undefined;
  }
}

/**
 * The program's own output, for the status reports and queries a
 * multiplexer does not pass on to its client.
 */
export interface Tap {
  /** Sends data to the program as if typed, e.g. the answer to a status query */
  reply(data: string): void;
  dispose(): void;
}

export type OpenResult =
  /** `client` shows the session; `created` when the session is new */
  | { client: Command; tap?: Tap; created: boolean }
  /** The session's program ended while no client was attached */
  | { exitCode: number };

export interface Multiplexer {
  readonly id: MultiplexerId;
  /** The executable, which must be installed */
  readonly command: string;
  /**
   * Starts the session unless it runs already. `onData` receives the
   * program's output through a tap, when the multiplexer needs one.
   */
  open(options: SessionOptions, onData: (data: string) => void): Promise<OpenResult>;
  /** Whether the session exists, also with a program that ended */
  exists(session: string): Promise<boolean>;
  /** The sessions the extension started, in all workspaces */
  list(): Promise<SessionEntry[]>;
  /**
   * After the client exited with `clientCode`: the program's exit code, or
   * undefined when the session still runs because the client was detached.
   */
  ended(session: string, clientCode: number): Promise<number | undefined>;
  kill(session: string): Promise<void>;
  /** Replaces the session's tag, e.g. once its conversation started */
  updateTag(session: string, tag: SessionTag): Promise<void>;
}

/** Runs a command and resolves with its output, or rejects when it fails */
export type Run = (command: string, args: string[]) => Promise<string>;

const run: Run = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { env: clientEnvironment() }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

/** The extension host's environment, without the tmux session it may run in */
function clientEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

/**
 * The active pane of a session, matched by its exact name. Commands that
 * take a session (`has-session`, `attach-session`) accept `=name`; those that
 * take a window or pane need `=name:`.
 */
function paneTarget(session: string): string {
  return `=${session}:`;
}

/** Bytes as `send-keys -H` takes them: hexadecimal, one argument each */
export function hexBytes(data: string): string[] {
  return [...Buffer.from(data, 'utf8')].map((byte) => byte.toString(16).padStart(2, '0'));
}

/**
 * Reads the output of a tmux control client: `%output %<pane> <data>` lines
 * whose data has bytes below 32 and the backslash as octal escapes (`\033`).
 * Other notifications and command replies are skipped. UTF-8 characters
 * split across lines are kept together.
 */
export class ControlModeParser {
  private pending = Buffer.alloc(0);
  private readonly decoder = new StringDecoder('utf8');

  /** @param pane Only this pane's output, e.g. `%3`, when given */
  constructor(
    private readonly onOutput: (data: string) => void,
    private readonly pane?: string
  ) {}

  push(chunk: Buffer): void {
    let buffer = Buffer.concat([this.pending, chunk]);
    let newline = buffer.indexOf(0x0a);
    while (newline !== -1) {
      this.line(buffer.subarray(0, newline));
      buffer = buffer.subarray(newline + 1);
      newline = buffer.indexOf(0x0a);
    }
    this.pending = buffer;
  }

  private line(line: Buffer): void {
    const prefix = '%output %';
    if (line.subarray(0, prefix.length).toString('latin1') !== prefix) return;
    const space = line.indexOf(0x20, prefix.length);
    if (space === -1) return;
    const pane = line.subarray(prefix.length - 1, space).toString('latin1');
    if (this.pane && pane !== this.pane) return;
    const data = line.subarray(space + 1);
    const bytes: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const octal = data.subarray(i + 1, i + 4).toString('latin1');
      if (data[i] === 0x5c && /^[0-7]{3}$/.test(octal)) {
        bytes.push(Number.parseInt(octal, 8));
        i += 3;
      } else {
        bytes.push(data[i]);
      }
    }
    const text = this.decoder.write(Buffer.from(bytes));
    if (text) this.onOutput(text);
  }
}

/**
 * Sessions on their own tmux server (`tmux -L agent-tabs`), so they stay
 * apart from the user's sessions; `~/.tmux.conf` applies to it.
 *
 * tmux draws its own screen and does not pass on OSC 7501 status reports,
 * status queries or OSC 9 notifications. A control client (`tmux -C`) reads
 * the program's raw output for them and answers queries with
 * `send-keys -H`. A new session holds its program back until the control
 * client is attached, so it sees the program's first query. When the
 * program exits, the session's shell stores its exit code in the session
 * and detaches the clients; tmux itself can take seconds to notice that a
 * pane's program exited. The pane stays (`remain-on-exit`) until the
 * extension ends the session, and a hook detaches the clients in case the
 * shell could not.
 *
 * Needs tmux 3.2 or later.
 */
export class Tmux implements Multiplexer {
  readonly id = 'tmux';
  readonly command = 'tmux';
  static readonly SOCKET = 'agent-tabs';
  /** Session option with the session's tag */
  static readonly TAG = '@agent-tabs';
  /** Session option with the program's exit code, once it exited */
  static readonly EXIT = '@agent-tabs-exit';
  /**
   * Session option with the ID of the program's pane, e.g. `%3`, which
   * stays the same when the user splits the window or switches panes
   */
  static readonly PANE = '@agent-tabs-pane';

  constructor(
    private readonly execute: Run = run,
    private readonly spawnControl: (args: string[]) => ChildProcessWithoutNullStreams = (args) =>
      spawn('tmux', args, { env: clientEnvironment() }),
    private readonly envFolder = os.tmpdir()
  ) {}

  async open(options: SessionOptions, onData: (data: string) => void): Promise<OpenResult> {
    const { session } = options;
    const created = !(await this.exists(session));
    if (created) {
      const envFile = writeEnvironmentFile(options.env, this.envFolder);
      try {
        await this.tmux(this.newSession(options, envFile));
      } catch (error) {
        if (envFile) fs.rmSync(envFile, { force: true });
        throw error;
      }
      await this.configureServer();
    } else {
      const exitCode = await this.deadPaneStatus(session);
      if (exitCode !== undefined) return { exitCode };
    }
    const tap = this.tap(session, await this.programPane(session), created, onData);
    return {
      client: {
        command: this.command,
        args: ['-L', Tmux.SOCKET, 'attach-session', '-t', `=${session}`]
      },
      tap,
      created
    };
  }

  /**
   * The session runs `sh`, which waits for the control client's signal on
   * the session's channel, reads and deletes the file with the environment
   * variables, runs the program, then stores its exit code and detaches the
   * clients. `sh` keeps running through Ctrl+C, which the program handles.
   */
  newSession(options: SessionOptions, envFile = '-'): string[] {
    const { session, command, args, cwd, cols, rows } = options;
    const tmux = `"$0" -L ${Tmux.SOCKET}`;
    const hold = [
      'trap : INT QUIT',
      `${tmux} wait-for "$1"`,
      'session=$1',
      'if [ "$2" != - ]; then . "$2"; rm -f "$2"; fi',
      'shift 2',
      '"$@"',
      'code=$?',
      `${tmux} set-option -t "=$session:" ${Tmux.EXIT} "$code" ";" detach-client -s "=$session"`,
      'exit "$code"'
    ].join('; ');
    const target = paneTarget(session);
    return [
      'new-session',
      '-d',
      '-s',
      session,
      '-x',
      String(cols),
      '-y',
      String(rows),
      '-c',
      cwd,
      '--',
      'sh',
      '-c',
      hold,
      this.command,
      session,
      envFile,
      command,
      ...args,
      ';',
      'set-option',
      '-t',
      target,
      Tmux.TAG,
      encodeTag(options.tag),
      ';',
      'set-option',
      '-F',
      '-t',
      target,
      Tmux.PANE,
      '#{pane_id}',
      ';',
      'set-option',
      '-t',
      target,
      'status',
      'off',
      ';',
      'set-option',
      '-w',
      '-t',
      target,
      'remain-on-exit',
      'on',
      ';',
      'set-hook',
      '-t',
      target,
      'pane-died',
      `detach-client -s =${session}`
    ];
  }

  /**
   * Server options for a tab: the window follows the tab's size, Esc
   * arrives without delay, Shift+Enter arrives as a CSI u key, and the mouse
   * wheel scrolls tmux's history. Options a tmux version does not know are
   * skipped.
   */
  private async configureServer(): Promise<void> {
    const options = [
      ['-g', 'window-size', 'latest'],
      ['-s', 'escape-time', '10'],
      ['-s', 'extended-keys', 'on'],
      ['-s', 'extended-keys-format', 'csi-u'],
      ['-g', 'mouse', 'on']
    ];
    await Promise.all(
      options.map((option) => this.tmux(['set-option', ...option]).catch(() => undefined))
    );
  }

  /**
   * The program's pane: the one stored when the session started, or for
   * sessions of older versions the active one
   */
  private async programPane(session: string): Promise<string> {
    const pane = await this.tmux(['show-options', '-qv', '-t', paneTarget(session), Tmux.PANE])
      .then((output) => output.trim())
      .catch(() => '');
    return /^%\d+$/.test(pane) ? pane : paneTarget(session);
  }

  private tap(
    session: string,
    pane: string,
    created: boolean,
    onData: (data: string) => void
  ): Tap {
    const control = this.spawnControl([
      '-L',
      Tmux.SOCKET,
      '-C',
      'attach-session',
      '-t',
      `=${session}`
    ]);
    // Other panes the user opens in the session are not the program
    const parser = new ControlModeParser(onData, pane.startsWith('%') ? pane : undefined);
    control.stdout.on('data', (chunk: Buffer) => parser.push(chunk));
    // A failing control client only costs the status reports, but must not
    // leave a new session's program held back
    const release = () => {
      if (created) void this.tmux(['wait-for', '-S', session]).catch(() => undefined);
    };
    control.on('error', release);
    control.on('exit', release);
    control.stdin.on('error', () => undefined);
    const send = (line: string) => {
      if (control.stdin.writable) control.stdin.write(`${line}\n`);
    };
    // Commands run in order once attached, so the release comes after the attach
    send('refresh-client -f ignore-size');
    if (created) send(`wait-for -S ${session}`);
    return {
      reply: (data) => send(`send-keys -t ${pane} -H ${hexBytes(data).join(' ')}`),
      dispose: () => {
        control.stdin.end();
        control.kill();
      }
    };
  }

  async exists(session: string): Promise<boolean> {
    try {
      await this.tmux(['has-session', '-t', `=${session}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Sessions with a tag; none when the server is not running */
  async list(): Promise<SessionEntry[]> {
    // tmux prints control characters such as tabs as `_`; the tag is base64
    // and session names have no spaces
    const format = `#{session_attached} #{pane_dead} #{${Tmux.EXIT}} #{${Tmux.TAG}} #{session_name}`;
    const output = await this.tmux(['list-sessions', '-F', format]).catch(() => '');
    const entries: SessionEntry[] = [];
    for (const line of output.split('\n')) {
      const [attached, dead, exit, encoded, name] = line.split(' ');
      const tag = encoded ? decodeTag(encoded) : undefined;
      if (name && tag) {
        const ended = dead === '1' || exit !== '';
        entries.push({ name, tag, ended, attached: Number(attached) > 0 });
      }
    }
    return entries;
  }

  async ended(session: string, clientCode: number): Promise<number | undefined> {
    if (!(await this.exists(session))) return clientCode;
    return this.deadPaneStatus(session);
  }

  /**
   * The exit code of a session whose program ended, or undefined while it
   * runs: the one the session's shell stored, else the dead pane's.
   */
  private async deadPaneStatus(session: string): Promise<number | undefined> {
    const output = await this.tmux([
      'display-message',
      '-p',
      '-t',
      await this.programPane(session),
      `#{${Tmux.EXIT}} #{pane_dead} #{pane_dead_status} #{pane_dead_signal}`
    ]);
    const [exit, dead, status, signal] = output.replace(/\n$/, '').split(' ');
    if (exit) return Number(exit);
    if (dead !== '1') return undefined;
    if (status) return Number(status);
    return signal ? 128 + Number(signal) : 1;
  }

  async kill(session: string): Promise<void> {
    await this.tmux(['kill-session', '-t', `=${session}`]).catch(() => undefined);
  }

  async updateTag(session: string, tag: SessionTag): Promise<void> {
    await this.tmux(['set-option', '-t', paneTarget(session), Tmux.TAG, encodeTag(tag)]);
  }

  private tmux(args: string[]): Promise<string> {
    return this.execute(this.command, ['-L', Tmux.SOCKET, ...args]);
  }
}

/**
 * abduco only detaches a session: its client passes the program's output
 * and the replies through unchanged, so status needs no tap, and it exits
 * with the program's exit code. It draws on the alternate screen, so the
 * tab's scrollback does not keep the output.
 */
export class Abduco implements Multiplexer {
  readonly id = 'abduco';
  readonly command = 'abduco';

  /**
   * The session gets the environment of the client that starts it, so the
   * variables pass through the tab's process and not its command line.
   *
   * @param tags Folder with a file per session holding its tag, since abduco
   *   cannot store one itself
   */
  constructor(
    private readonly execute: Run = run,
    private readonly tags = defaultTagFolder()
  ) {}

  async open(options: SessionOptions): Promise<OpenResult> {
    const created = !(await this.exists(options.session));
    if (created) {
      await fs.promises.mkdir(this.tags, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(this.tagFile(options.session), encodeTag(options.tag), {
        mode: 0o600
      });
    }
    // -A creates the session or attaches to it
    const args = ['-A', options.session, options.command, ...options.args];
    return { client: { command: this.command, args }, created };
  }

  /**
   * Sessions listed by `abduco`: `+` marks one whose program ended, `*` one
   * with a client attached.
   */
  private async sessions(): Promise<Array<{ name: string; ended: boolean; attached: boolean }>> {
    // abduco exits with 1 when there are no sessions
    const output = await this.execute(this.command, []).catch(() => '');
    return output
      .split('\n')
      .slice(1)
      .filter((line) => line.includes('\t'))
      .map((line) => ({
        name: line.slice(line.lastIndexOf('\t') + 1),
        ended: line.startsWith('+'),
        attached: line.startsWith('*')
      }));
  }

  /** Sessions with a tag file; tag files of sessions that are gone are removed */
  async list(): Promise<SessionEntry[]> {
    const running = new Map((await this.sessions()).map((entry) => [entry.name, entry]));
    let files: string[];
    try {
      files = fs.readdirSync(this.tags).filter((file) => file.endsWith('.tag'));
    } catch {
      return [];
    }
    const entries: SessionEntry[] = [];
    for (const file of files) {
      const name = file.slice(0, -'.tag'.length);
      const session = running.get(name);
      if (!session) {
        this.removeTag(name);
        continue;
      }
      const tag = decodeTag(readFile(this.tagFile(name)));
      if (tag) entries.push({ name, tag, ended: session.ended, attached: session.attached });
    }
    return entries;
  }

  async updateTag(session: string, tag: SessionTag): Promise<void> {
    await fs.promises.writeFile(this.tagFile(session), encodeTag(tag), { mode: 0o600 });
  }

  private tagFile(session: string): string {
    return path.join(this.tags, `${session}.tag`);
  }

  private removeTag(session: string): void {
    fs.rmSync(this.tagFile(session), { force: true });
  }

  async exists(session: string): Promise<boolean> {
    return (await this.sessions()).some((entry) => entry.name === session);
  }

  async ended(session: string, clientCode: number): Promise<number | undefined> {
    const entry = (await this.sessions()).find((candidate) => candidate.name === session);
    return entry && !entry.ended ? undefined : clientCode;
  }

  /**
   * Ends the session's server, also one whose program ended. abduco has no
   * command for it, so its processes are found by their command line,
   * which starts with the session's name the extension chose; only the
   * user's own processes and only names the extension creates.
   */
  async kill(session: string): Promise<void> {
    this.removeTag(session);
    if (!/^agent-tabs-[a-z0-9-]+$/.test(session)) return;
    const entry = (await this.sessions()).find((candidate) => candidate.name === session);
    if (!entry) return;
    const user = String(os.userInfo().uid);
    await this.execute('pkill', ['-U', user, '-f', `^([^ ]*/)?abduco -A ${session} `]).catch(
      () => undefined
    );
  }
}

/** `$XDG_STATE_HOME/agent-tabs/abduco`, by default under `~/.local/state` */
function defaultTagFolder(): string {
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(state, 'agent-tabs', 'abduco');
}

function readFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const instances = new Map<MultiplexerId, Multiplexer>();

export function getMultiplexer(id: MultiplexerId): Multiplexer {
  let multiplexer = instances.get(id);
  if (!multiplexer) {
    multiplexer = id === 'tmux' ? new Tmux() : new Abduco();
    instances.set(id, multiplexer);
  }
  return multiplexer;
}

/** Replaces the multiplexers, for tests */
export function setMultiplexer(multiplexer: Multiplexer | undefined, id: MultiplexerId): void {
  if (multiplexer) instances.set(id, multiplexer);
  else instances.delete(id);
}
