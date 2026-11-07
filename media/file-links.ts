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
  while ((match = FILE_PATH_REGEX.exec(line)) !== null) {
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
