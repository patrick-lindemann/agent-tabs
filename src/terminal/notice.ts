/** How long after a start the notice is looked for */
const NOTICE_WINDOW_MS = 10_000;

/** Color codes and the line break the notice may come with */
const STYLE = /^(?:\x1b\[[0-9;]*m)*/;

/**
 * Removes a line a program prints when it starts, e.g. pi's warning that a
 * new conversation ID has no session yet, also when it arrives in several
 * chunks. Output passes through at once, except a trailing part that may
 * be the start of the notice, which waits for the next chunk. The filter
 * stops after the line, once the program switches to its own screen or
 * after a few seconds.
 */
export class NoticeFilter {
  private readonly until = Date.now() + NOTICE_WINDOW_MS;
  private done = false;
  /** Output held back because it may be the start of the notice */
  private held = '';

  /** @param notice The notice's text, without colors or line break */
  constructor(private readonly notice: string) {}

  /** The output without the notice */
  filter(received: string): string {
    if (this.done) return received;
    const data = this.held + received;
    this.held = '';
    if (Date.now() > this.until) return this.finish(data);

    const index = data.indexOf(this.notice);
    if (index >= 0) {
      const before = data.slice(0, index).replace(/(?:\x1b\[[0-9;]*m)*$/, '');
      const after = data.slice(index + this.notice.length);
      const rest = after.slice((STYLE.exec(after)?.[0] ?? '').length).replace(/^\r?\n?/, '');
      return this.finish(before + rest);
    }
    // Full-screen programs print notices before they switch screens
    if (data.includes('\x1b[?1049h')) return this.finish(data);
    const start = this.partialStart(data);
    this.held = data.slice(start);
    return data.slice(0, start);
  }

  /**
   * Where a trailing part of the output starts that may still become the
   * notice: its first characters, possibly after color codes
   */
  private partialStart(data: string): number {
    const from = Math.max(0, data.length - this.notice.length - 32);
    for (let start = from; start < data.length; start++) {
      // The notice is a line of its own
      if (start > 0 && data[start - 1] !== '\n') continue;
      const tail = data.slice(start);
      const text = tail.slice((STYLE.exec(tail)?.[0] ?? '').length);
      // Its first characters, or a color code that may come before them
      if (this.notice.startsWith(text) || /^\x1b(?:\[[0-9;]*)?$/.test(text)) return start;
    }
    return data.length;
  }

  /**
   * Output held back for longer than the program takes to print a line,
   * which is not the notice then
   */
  flush(): string {
    const held = this.held;
    this.held = '';
    return held;
  }

  private finish(data: string): string {
    this.done = true;
    return data;
  }

  get finished(): boolean {
    return this.done;
  }
}
