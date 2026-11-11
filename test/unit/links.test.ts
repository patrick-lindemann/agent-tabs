import { describe, expect, it } from 'vitest';
import { extractFileLinks, parseFileTarget } from '../../media/links';

describe('file link extraction', () => {
  it.each([
    ['src/app.ts:10:5', 'src/app.ts', 10, 5],
    ['/tmp/app.ts:2', '/tmp/app.ts', 2, undefined],
    ['C:\\work\\app.ts:3:4', 'C:\\work\\app.ts', 3, 4],
    ['\\\\server\\share\\app.ts:7', '\\\\server\\share\\app.ts', 7, undefined]
  ])('extracts %s', (text, path, line, column) =>
    expect(extractFileLinks(text)[0]).toMatchObject({ path, line, column })
  );
  it('recognizes known extensionless files and ignores arbitrary words', () => {
    expect(extractFileLinks('see Makefile and README')).toHaveLength(1);
  });
});

describe('hyperlink file targets', () => {
  it.each([
    ['/repo/test/a_test.exs#L243', '/repo/test/a_test.exs', 243, undefined],
    ['/repo/a.ts#L10C5', '/repo/a.ts', 10, 5],
    ['/repo/a.ts#L10-L20', '/repo/a.ts', 10, undefined],
    ['/repo/docs/part/', '/repo/docs/part/', undefined, undefined],
    ['src/a.ts:3:4', 'src/a.ts', 3, 4],
    ['file:///repo/my%20file.ts#L2', '/repo/my file.ts', 2, undefined],
    ['file:///C:/work/a.ts', 'C:/work/a.ts', undefined, undefined],
    ['C:\\work\\a.ts', 'C:\\work\\a.ts', undefined, undefined]
  ])('reads %s', (target, path, line, column) =>
    expect(parseFileTarget(target)).toEqual({ path, line, column })
  );
  it('ignores URLs with other schemes', () => {
    expect(parseFileTarget('mailto:a@b.c')).toBeUndefined();
    expect(parseFileTarget('vscode://file/a')).toBeUndefined();
  });
});
