import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import type { WebviewOutgoingMessage } from './types';

export interface FileLinkMatch {
  path: string;
  line?: number;
  column?: number;
  start: number;
  end: number;
}

const FILE_PATH_REGEX =
  /(?:^|[\s"'`([{])((?:[.~]?\/[\w./-]+|[a-zA-Z]:[\\/][\w.\\/-]+|\\\\[^\s"'`:]+|[\w.-]+\/[\w./-]+|(?:Makefile|Dockerfile|Containerfile|Vagrantfile|Procfile|Gemfile|Rakefile|Brewfile|Justfile|Taskfile|Earthfile|CMakeLists|GNUmakefile|BSDmakefile))(?:\.[a-zA-Z0-9]+)?)(?::(\d+))?(?::(\d+))?/g;
const EXTENSIONLESS_FILES = new Set([
  'Makefile',
  'Dockerfile',
  'Containerfile',
  'Vagrantfile',
  'Procfile',
  'Gemfile',
  'Rakefile',
  'Brewfile',
  'Justfile',
  'Taskfile',
  'Earthfile',
  'CMakeLists',
  'GNUmakefile',
  'BSDmakefile'
]);

/** Extract source paths from one terminal line, including optional line/column. */
export function extractFileLinks(line: string): FileLinkMatch[] {
  const links: FileLinkMatch[] = [];
  FILE_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (true) {
    match = FILE_PATH_REGEX.exec(line);
    if (match === null) break;
    const path = match[1];
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
    if (!hasExtension && !EXTENSIONLESS_FILES.has(path.split(/[\\/]/).pop() ?? '')) continue;
    const start = match.index + match[0].indexOf(path);
    links.push({
      path,
      line: match[2] ? Number(match[2]) : undefined,
      column: match[3] ? Number(match[3]) : undefined,
      start,
      end:
        start +
        path.length +
        (match[2] ? match[2].length + 1 : 0) +
        (match[3] ? match[3].length + 1 : 0)
    });
  }
  return links;
}

export interface FileTarget {
  path: string;
  line?: number;
  column?: number;
}

/**
 * The file an OSC 8 hyperlink points to, as programs such as pi write them
 * for Markdown links: a `file://` URL or a path, with an optional line in a
 * `#L10`, `#L10C5` or `#L10-L20` fragment or a `:10:5` suffix. Other URLs,
 * e.g. `mailto:`, point to no file.
 */
export function parseFileTarget(target: string): FileTarget | undefined {
  let rest = target;
  let line: number | undefined;
  let column: number | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    const fragment = /^L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i.exec(rest.slice(hash + 1));
    if (fragment) {
      line = Number(fragment[1]);
      column = fragment[2] ? Number(fragment[2]) : undefined;
    }
    rest = rest.slice(0, hash);
  }

  let path: string;
  if (/^file:/i.test(rest)) {
    try {
      const url = new URL(rest);
      path = decodeURIComponent(url.pathname);
      // `file:///C:/x` has the path `/C:/x`; `file://server/share` is UNC
      if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
      else if (url.host) path = `\\\\${url.host}${path.replace(/\//g, '\\')}`;
    } catch {
      return undefined;
    }
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(rest)) {
    // A URL with another scheme; one letter followed by `:` is a drive
    return undefined;
  } else {
    path = rest;
  }

  if (line === undefined) {
    const suffix = /^(.*?):(\d+)(?::(\d+))?$/.exec(path);
    if (suffix && !/^[a-zA-Z]$/.test(suffix[1])) {
      path = suffix[1];
      line = Number(suffix[2]);
      column = suffix[3] ? Number(suffix[3]) : undefined;
    }
  }
  if (!path) return undefined;
  return { path, line, column };
}

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly terminalId: string,
    private readonly postMessage: (msg: WebviewOutgoingMessage) => void
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const lineText = line.translateToString();
    const links: ILink[] = extractFileLinks(lineText).map((match) => ({
      range: {
        start: { x: match.start + 1, y: bufferLineNumber },
        end: { x: match.end + 1, y: bufferLineNumber }
      },
      text: match.path,
      activate: () => {
        this.postMessage({
          type: 'openFile',
          id: this.terminalId,
          path: match.path,
          line: match.line,
          column: match.column
        });
      }
    }));
    callback(links.length > 0 ? links : undefined);
  }
}
