import { describe, expect, it } from 'vitest';
import {
  ShellStartupOutput,
  shellClearCommand,
  shellKind,
  shellQuote,
  shellRunLine
} from '../../src/terminal/shell';

describe('shell helpers', () => {
  it.each([
    ['plain', 'plain'],
    ['a b', "'a b'"],
    ["it's", "'it'\\''s'"]
  ])('quotes POSIX %s', (input, expected) => expect(shellQuote(input, 'posix')).toBe(expected));

  it.each([
    ['a&b', '"a&b"'],
    ['say "hi"', '"say ""hi"""'],
    ['C:\\Program Files\\x', '"C:\\Program Files\\x"']
  ])('quotes %s for cmd.exe', (input, expected) => expect(shellQuote(input, 'cmd')).toBe(expected));

  it('quotes for PowerShell', () => expect(shellQuote("it's", 'powershell')).toBe("'it''s'"));

  it.each([
    ['/bin/zsh', 'linux', 'posix'],
    ['C:\\Windows\\System32\\cmd.exe', 'win32', 'cmd'],
    ['pwsh.exe', 'win32', 'powershell'],
    ['/usr/bin/pwsh', 'linux', 'powershell'],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'win32', 'posix']
  ] as const)('reads %s on %s as %s', (shell, platform, kind) => {
    expect(shellKind(shell, platform)).toBe(kind);
  });

  it('quotes the command too, and runs it after clearing the screen', () => {
    expect(shellRunLine('C:\\My Tools\\pi.cmd', ['-c'], 'cmd', 'win32')).toBe(
      'cls && "C:\\My Tools\\pi.cmd" -c'
    );
    expect(shellRunLine('/opt/my tools/pi', [], 'posix', 'linux')).toBe(
      "clear && '/opt/my tools/pi'"
    );
    expect(shellRunLine('C:\\My Tools\\pi.exe', [], 'powershell', 'win32')).toBe(
      "cls; & 'C:\\My Tools\\pi.exe'"
    );
  });

  it.each([
    ['linux', 'clear'],
    ['darwin', 'clear'],
    ['win32', 'cls']
  ] as const)('selects clear command on %s', (platform, expected) =>
    expect(shellClearCommand(platform)).toBe(expected)
  );
});

describe('shell startup output', () => {
  it.each(['\x1b[2J', '\x1b[H\x1b[J', '\x1b[1;1H\x1b[0J'])('batches the echo with %j', (clear) => {
    const startup = new ShellStartupOutput();
    const echo = 'prompt> clear && pi\r\n';
    expect(startup.filter(echo)).toBe('');
    expect(startup.filter(clear.slice(0, -1))).toBe('');
    const programOutput = '\x1b[?2026hagent output';
    expect(startup.filter(`J${programOutput}`)).toBe(echo + clear + programOutput);
    expect(startup.filter(clear)).toBe(clear);
    expect(startup.finish()).toBe('');
  });

  it('keeps diagnostics if the shell never clears the screen', () => {
    const startup = new ShellStartupOutput();
    const message = '\x1b[J\x1b[3Jshell startup failed\r\n';
    expect(startup.filter(message)).toBe('');
    expect(startup.finish()).toBe(message);
    expect(startup.filter('later output')).toBe('later output');
  });

  it('stops holding a large burst of output', () => {
    const startup = new ShellStartupOutput();
    const output = 'a'.repeat(64 * 1024);
    expect(startup.filter('startup\r\n')).toBe('');
    expect(startup.filter(output)).toBe(`startup\r\n${output}`);
    expect(startup.finish()).toBe('');
  });
});
