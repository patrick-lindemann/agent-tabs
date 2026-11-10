import { describe, expect, it } from 'vitest';
import { cmdArgument, pathKey, resolveExecutable, windowsLaunch } from '../../src/terminal/windows';

const files = new Set([
  'C:\\bin\\claude.exe',
  'C:\\npm\\codex.cmd',
  'C:\\npm\\codex',
  'C:\\last\\pi.cmd',
  'C:\\tools\\run.bat'
]);
const exists = (file: string) => files.has(file);

describe('finding programs on Windows', () => {
  it.each([
    ['claude', 'C:\\bin\\claude.exe'],
    // npm also installs a shell script without an extension, which Windows cannot run
    ['codex', 'C:\\npm\\codex.cmd'],
    ['codex.cmd', 'C:\\npm\\codex.cmd'],
    // The last entry of the PATH counts too
    ['pi', 'C:\\last\\pi.cmd'],
    ['C:\\tools\\run', 'C:\\tools\\run.bat'],
    ['C:\\tools\\run.bat', 'C:\\tools\\run.bat'],
    ['gemini', undefined]
  ])('finds %s as %s', (command, file) => {
    expect(resolveExecutable(command, 'C:\\bin;C:\\npm;;C:\\last', undefined, exists)).toBe(file);
  });

  it('uses PATHEXT', () => {
    expect(resolveExecutable('claude', 'C:\\bin', '.CMD', exists)).toBeUndefined();
  });

  it('finds the PATH variable whatever its case', () => {
    expect(pathKey({ Path: 'x' })).toBe('Path');
    expect(pathKey({})).toBe('PATH');
  });
});

describe('starting programs on Windows', () => {
  it('runs an executable directly', () => {
    expect(windowsLaunch('C:\\bin\\claude.exe', ['--x'])).toEqual({
      file: 'C:\\bin\\claude.exe',
      args: ['--x']
    });
  });

  it('runs a batch file through cmd.exe with its arguments escaped', () => {
    expect(windowsLaunch('C:\\npm\\codex.cmd', ['-c', 'a="b & c"'], 'C:\\cmd.exe')).toEqual({
      file: 'C:\\cmd.exe',
      args: '/d /s /c "C:\\npm\\codex.cmd ^"-c^" ^"a=\\^"b^ ^&^ c\\^"^""'
    });
  });

  it('escapes the arguments of npm shims twice', () => {
    expect(cmdArgument('a&b', true)).toBe('^^^"a^^^&b^^^"');
    expect(windowsLaunch('C:\\p\\node_modules\\.bin\\pi.cmd', ['a&b']).args).toBe(
      '/d /s /c "C:\\p\\node_modules\\.bin\\pi.cmd ^^^"a^^^&b^^^""'
    );
  });

  it('doubles backslashes before a quote and at the end', () => {
    expect(cmdArgument('C:\\dir\\')).toBe('^"C:\\dir\\\\^"');
    expect(cmdArgument('a\\"b')).toBe('^"a\\\\\\^"b^"');
  });
});
