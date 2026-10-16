// Virtual time for the whole simulation, in milliseconds.
// The game pumps it from real time; tests advance it by hand.

interface Scheduled {
  at: number;
  order: number;
  run: () => void;
}

export class Clock {
  now = 0;
  private queue: Scheduled[] = [];
  private order = 0;

  schedule(delayMs: number, run: () => void): void {
    this.queue.push({ at: this.now + Math.max(0, delayMs), order: this.order++, run });
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
  }

  /** Runs every event due within the next `ms` milliseconds, then moves time forward. */
  advance(ms: number): void {
    this.runUntil(this.now + ms, () => false);
  }

  /**
   * Runs events in order until `done()` returns true or `deadline` passes.
   * Returns true if `done()` became true.
   */
  runUntil(deadline: number, done: () => boolean): boolean {
    while (!done()) {
      const next = this.queue[0];
      if (!next || next.at > deadline) {
        this.now = Math.max(this.now, deadline);
        return done();
      }
      this.queue.shift();
      this.now = Math.max(this.now, next.at);
      next.run();
    }
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }
}
