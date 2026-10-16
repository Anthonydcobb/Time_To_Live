// A command that keeps printing as simulated time passes, like ping or traceroute.
// Output uses "\n" line breaks; partial lines (a row of `!`) are normal.

export class Job {
  done = false;
  private text = "";
  private dataListeners = new Set<(text: string) => void>();
  private doneListeners = new Set<() => void>();
  private abortHandler: (() => void) | null = null;

  /** Everything written so far. */
  get output(): string {
    return this.text;
  }

  write(text: string): void {
    if (this.done || !text) return;
    this.text += text;
    for (const l of this.dataListeners) l(text);
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    for (const l of this.doneListeners) l();
  }

  /** Receives text already written, then everything after. */
  onData(listener: (text: string) => void): void {
    if (this.text) listener(this.text);
    this.dataListeners.add(listener);
  }

  onDone(listener: () => void): void {
    if (this.done) listener();
    else this.doneListeners.add(listener);
  }

  /** What Ctrl+Shift+6 (or Ctrl+C on a PC) does to this job. Defaults to stopping it. */
  onAbort(handler: () => void): void {
    this.abortHandler = handler;
  }

  abort(): void {
    if (this.done) return;
    if (this.abortHandler) this.abortHandler();
    this.finish();
  }
}
