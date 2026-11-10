import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpExecutor } from '../../src/picker/help';

const HELP = `Usage: tool [options]\n\nOptions:\n  --verbose  Print more of what happens\n  --model <name>  The model to use\n`;

/** A process started for help, controlled by the test */
function fakeProcess() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: () => {
      proc.killed = true;
      return true;
    }
  });
  return proc;
}

describe('command help', () => {
  let calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }>;
  let processes: Array<ReturnType<typeof fakeProcess>>;
  const spawn = ((command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    const proc = fakeProcess();
    processes.push(proc);
    return proc;
  }) as never;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    processes = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const executor = (installed = true) =>
    new HelpExecutor({ timeout: 1000 }, spawn, () => installed);

  it('runs only --help, without a shell', async () => {
    const help = executor().getHelp('tool');
    processes[0].stdout.write(HELP);
    processes[0].emit('close', 0);
    const result = await help;
    expect(result.flags.map((flag) => flag.flag)).toEqual(['--verbose', '--model']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: 'tool', args: ['--help'] });
    expect(calls[0].options.shell).toBeUndefined();
  });

  it('does not run a command that is not installed', async () => {
    const result = await executor(false).getHelp('make');
    expect(calls).toEqual([]);
    expect(result.flags).toEqual([]);
  });

  it('tries nothing else when --help prints nothing', async () => {
    const help = executor().getHelp('tool');
    processes[0].emit('close', 1);
    await expect(help).resolves.toMatchObject({ flags: [] });
    expect(calls).toHaveLength(1);
  });

  it('settles once when the process fails and then closes', async () => {
    const help = executor().getHelp('tool');
    processes[0].emit('error', new Error('ENOENT'));
    processes[0].stdout.write(HELP);
    processes[0].emit('close', 0);
    await expect(help).resolves.toMatchObject({ flags: [] });
    expect(calls).toHaveLength(1);
  });

  it('kills the process after the timeout and starts no other', async () => {
    const help = executor().getHelp('tool');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(help).resolves.toMatchObject({ flags: [], parseErrors: ['Help timed out'] });
    expect(processes[0].killed).toBe(true);
    processes[0].emit('close', null);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });
});
