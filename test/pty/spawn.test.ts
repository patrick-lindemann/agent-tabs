import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pathKey, resolveExecutable, windowsLaunch } from '../../src/terminal/windows';
import type { INodePty } from '../../src/types';

/**
 * Starts real processes through node-pty's native module, as the extension
 * does, on every platform CI runs on. Run with `npm run test:pty`.
 */
const nodePty = createRequire(__filename)('node-pty') as INodePty;

function run(
  file: string,
  args: string[] | string,
  env = process.env
): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    const pty = nodePty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 24,
      cwd: os.tmpdir(),
      env
    });
    let output = '';
    pty.onData((data) => {
      output += data;
    });
    pty.onExit(({ exitCode }) => resolve({ output, code: exitCode }));
  });
}

/** Words that a shell or cmd.exe would change if they were not escaped */
const TRICKY = ['plain', 'two words', 'a&b|c', 'say "hi"', '100%', 'C:\\dir\\', '^caret', '(x)'];

describe('starting programs through node-pty', () => {
  it('runs a program and reports its exit code', async () => {
    const { output, code } = await run(process.execPath, [
      '-e',
      'console.log("ok"); process.exit(3)'
    ]);
    expect(output).toContain('ok');
    expect(code).toBe(3);
  });

  it('passes arguments unchanged', async () => {
    const { output } = await run(process.execPath, [
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...TRICKY
    ]);
    expect(JSON.parse(output.trim().split(/\r?\n/).pop() ?? '')).toEqual(TRICKY);
  });

  describe.runIf(process.platform === 'win32')('on Windows', () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent tabs '));
      const script = path.join(dir, 'argv.js');
      fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
      // Like the shims npm installs for codex, gemini or pi
      fs.writeFileSync(
        path.join(dir, 'fake-agent.cmd'),
        `@"${process.execPath}" "${script}" %*\r\n`
      );
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('finds a batch file by its name and runs it with its arguments', async () => {
      const env = { ...process.env };
      const key = pathKey(env);
      env[key] = `${env[key] ?? ''};${dir}`;
      const file = resolveExecutable('fake-agent', env[key] ?? '', env.PATHEXT);
      expect(file).toBe(path.join(dir, 'fake-agent.cmd'));
      const launch = windowsLaunch(file ?? '', TRICKY, env.ComSpec);
      const { output, code } = await run(launch.file, launch.args, env);
      expect(code).toBe(0);
      const line = output.split(/\r?\n/).find((text) => text.trim().startsWith('['));
      expect(JSON.parse(line?.trim() ?? '')).toEqual(TRICKY);
    });
  });
});
