import { describe, expect, it } from 'vitest';
import { extractFileLinks } from '../../media/file-links';

describe('file link extraction', () => {
  it.each([
    ['src/app.ts:10:5', 'src/app.ts', 10, 5],
    ['/tmp/app.ts:2', '/tmp/app.ts', 2, undefined],
    ['C:\\work\\app.ts:3:4', 'C:\\work\\app.ts', 3, 4],
    ['\\\\server\\share\\app.ts:7', '\\\\server\\share\\app.ts', 7, undefined]
  ])('extracts %s', (text, path, line, column) => expect(extractFileLinks(text)[0]).toMatchObject({ path, line, column }));
  it('recognizes known extensionless files and ignores arbitrary words', () => {
    expect(extractFileLinks('see Makefile and README')).toHaveLength(1);
  });
});
