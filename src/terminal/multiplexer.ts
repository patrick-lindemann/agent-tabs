import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
  /**
   * After the client exited with `clientCode`: the program's exit code, or
   * undefined when the session still runs because the client was detached.
   */
  ended(session: string, clientCode: number): Promise<number | undefined>;
  kill(session: string): Promise<void>;
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

  constructor(private readonly onOutput: (data: string) => void) {}

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
 * client is attached, so it sees the program's first query. The pane
 * stays after its program exits (`remain-on-exit`) so its exit code can be
 * read; a hook detaches the clients then.
 *
 * Needs tmux 3.2 or later.
 */
export class Tmux implements Multiplexer {
  readonly id = 'tmux';
  readonly command = 'tmux';
  static readonly SOCKET = 'agent-tabs';

  constructor(
    private readonly execute: Run = run,
    private readonly spawnControl: (args: string[]) => ChildProcessWithoutNullStreams = (args) =>
      spawn('tmux', args, { env: clientEnvironment() })
  ) {}

  async open(options: SessionOptions, onData: (data: string) => void): Promise<OpenResult> {
    const { session } = options;
    const created = !(await this.exists(session));
    if (created) {
      await this.tmux(this.newSession(options));
      await this.configureServer();
    } else {
      const exitCode = await this.deadPaneStatus(session);
      if (exitCode !== undefined) return { exitCode };
    }
    const tap = this.tap(session, created, onData);
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
   * the session's channel, then becomes the program.
   */
  newSession(options: SessionOptions): string[] {
    const { session, command, args, env, cwd, cols, rows } = options;
    const hold = `"$0" -L ${Tmux.SOCKET} wait-for "$1"; shift; exec "$@"`;
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
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      '--',
      'sh',
      '-c',
      hold,
      this.command,
      session,
      command,
      ...args,
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

  private tap(session: string, created: boolean, onData: (data: string) => void): Tap {
    const control = this.spawnControl([
      '-L',
      Tmux.SOCKET,
      '-C',
      'attach-session',
      '-t',
      `=${session}`
    ]);
    const parser = new ControlModeParser(onData);
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
      reply: (data) => send(`send-keys -t ${paneTarget(session)} -H ${hexBytes(data).join(' ')}`),
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

  async ended(session: string, clientCode: number): Promise<number | undefined> {
    if (!(await this.exists(session))) return clientCode;
    return this.deadPaneStatus(session);
  }

  /** The exit code of a session whose program ended, or undefined while it runs */
  private async deadPaneStatus(session: string): Promise<number | undefined> {
    const output = await this.tmux([
      'display-message',
      '-p',
      '-t',
      paneTarget(session),
      '#{pane_dead} #{pane_dead_status} #{pane_dead_signal}'
    ]);
    const [dead, status, signal] = output.trim().split(' ');
    if (dead !== '1') return undefined;
    if (status) return Number(status);
    return signal ? 128 + Number(signal) : 1;
  }

  async kill(session: string): Promise<void> {
    await this.tmux(['kill-session', '-t', `=${session}`]).catch(() => undefined);
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

  constructor(private readonly execute: Run = run) {}

  async open(options: SessionOptions): Promise<OpenResult> {
    const created = !(await this.exists(options.session));
    // -A creates the session or attaches to it
    const args = ['-A', options.session, options.command, ...options.args];
    return { client: { command: this.command, args }, created };
  }

  /** Sessions listed by `abduco`, also those whose program ended (`+`) */
  private async sessions(): Promise<Array<{ name: string; ended: boolean }>> {
    // abduco exits with 1 when there are no sessions
    const output = await this.execute(this.command, []).catch(() => '');
    return output
      .split('\n')
      .slice(1)
      .filter((line) => line.includes('\t'))
      .map((line) => ({
        name: line.slice(line.lastIndexOf('\t') + 1),
        ended: line.startsWith('+')
      }));
  }

  async exists(session: string): Promise<boolean> {
    return (await this.sessions()).some((entry) => entry.name === session);
  }

  async ended(session: string, clientCode: number): Promise<number | undefined> {
    const entry = (await this.sessions()).find((candidate) => candidate.name === session);
    return entry && !entry.ended ? undefined : clientCode;
  }

  /** Attaching to a session collects it once its program ended */
  async kill(session: string): Promise<void> {
    const entry = (await this.sessions()).find((candidate) => candidate.name === session);
    if (!entry) return;
    await this.execute('pkill', ['-f', `abduco -A ${session} `]).catch(() => undefined);
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
