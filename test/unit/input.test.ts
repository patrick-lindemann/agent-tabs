import { describe, expect, it } from 'vitest';
import {
  availableFlags,
  detectPathContext,
  filterModeFor,
  insertFlag,
  insertPath,
  isPathValueHint,
  parseInput
} from '../../src/picker/input';
import type { CommandFlag } from '../../src/types';

const flags: CommandFlag[] = [
  {
    flag: '--dir',
    shortFlag: '-d',
    description: 'Directory',
    takesValue: true,
    valueHint: '<dir>'
  },
  { flag: '--file', description: 'File', takesValue: true, valueHint: '<file>' },
  { flag: '--name', description: 'Name', takesValue: true, valueHint: '<name>' },
  { flag: '--verbose', shortFlag: '-v', description: 'Verbose' },
  { flag: '--add', description: 'Add', repeatable: true }
];

describe('command picker input', () => {
  it('splits the command, finished arguments and a flag being typed', () => {
    expect(parseInput('claude --verbose --mo')).toEqual({
      command: 'claude',
      existingArgs: ['--verbose'],
      partial: '--mo'
    });
    expect(parseInput('claude --model=x')).toMatchObject({
      partial: '',
      existingArgs: ['--model=x']
    });
  });

  it.each([
    ['<path>', true, 'all'],
    ['<dir>', true, 'directories'],
    ['<directories...>', true, 'directories'],
    ['FILE', true, 'files'],
    ['<files>', true, 'files'],
    ['<name>', false, 'all'],
    [undefined, false, 'all']
  ])('classifies the value hint %s', (hint, isPath, mode) => {
    expect(isPathValueHint(hint)).toBe(isPath);
    expect(filterModeFor(hint)).toBe(mode);
  });

  it('starts path completion after a path flag and a space', () => {
    expect(detectPathContext('tool --dir ', flags)).toMatchObject({
      partialPath: '',
      filterMode: 'directories'
    });
    expect(detectPathContext('tool -d ', flags)?.flag.flag).toBe('--dir');
  });

  it('completes the path being typed, absolute or relative', () => {
    expect(detectPathContext('tool --file src/ma', flags)).toMatchObject({
      partialPath: 'src/ma',
      filterMode: 'files',
      isAbsolute: false
    });
    expect(detectPathContext('tool --file ~/x', flags)?.isAbsolute).toBe(true);
  });

  it.each([
    'tool',
    'tool --name ',
    'tool --file src/main.ts ',
    'tool --file a.ts --verbose',
    'tool --file --verbose'
  ])('does not complete paths in %j', (value) => {
    expect(detectPathContext(value, flags)).toBeNull();
  });

  it('offers unused flags matching the partial input, keeping repeatable ones', () => {
    const names = (partial: string, used: string[]) =>
      availableFlags(flags, partial, used).map((f) => f.flag);
    expect(names('', ['-v', '--add'])).toEqual(['--dir', '--file', '--name', '--add']);
    expect(names('--fi', [])).toEqual(['--file']);
    expect(names('-D', [])).toEqual(['--dir']);
  });

  it('inserts a picked flag in place of the one being typed', () => {
    expect(insertFlag('tool --ver', '--verbose')).toBe('tool --verbose ');
    expect(insertFlag('tool -v', '--dir')).toBe('tool --dir ');
    expect(insertFlag('tool', '--dir')).toBe('tool --dir ');
  });

  it('inserts a picked path, with a space after files only', () => {
    const typing = detectPathContext('tool --dir sr', flags);
    const empty = detectPathContext('tool --dir ', flags);
    if (!typing || !empty) throw new Error('expected path contexts');
    expect(insertPath('tool --dir sr', typing, 'src/', true)).toBe('tool --dir src/');
    expect(insertPath('tool --dir ', empty, 'a.ts', false)).toBe('tool --dir a.ts ');
  });
});
