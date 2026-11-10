/** How long after a start the notice is looked for */
const NOTICE_WINDOW_MS = 10_000;

/**
 * Removes a line a program prints when it starts, e.g. pi's warning that a
 * new conversation ID has no session yet. Output passes through at once;
 * the filter stops after the line, once the program switches to its own
 * screen or after a few seconds.
 */
export class NoticeFilter {
  private readonly until = Date.now() + NOTICE_WINDOW_MS;
  private done = false;

  constructor(private readonly pattern: RegExp) {}

  /** The output without the notice */
  filter(data: string): string {
    if (this.done) return data;
    if (Date.now() > this.until) {
      this.done = true;
      return data;
    }
    const match = this.pattern.exec(data);
    if (match) {
      this.done = true;
      return data.slice(0, match.index) + data.slice(match.index + match[0].length);
    }
    // Full-screen programs print notices before they switch screens
    if (data.includes('\x1b[?1049h')) this.done = true;
    return data;
  }

  get finished(): boolean {
    return this.done;
  }
}
