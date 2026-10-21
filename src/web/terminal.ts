import { Terminal, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import type { Job } from "../sim/job";
import type { Device } from "../sim/network";

/** What a terminal needs from a device's command line, IOS or PC. */
export interface Session {
  prompt(): string;
  secret(): boolean;
  run(line: string): { lines: string[]; job?: Job };
  help?(line: string): { lines: string[]; line: string };
  complete?(line: string): string;
  ctrlZ?(): { lines: string[] };
  history: string[];
  start(): string[];
}

export function iosSession(d: IosDevice): Session {
  const c = d.console;
  return {
    prompt: () => c.prompt(),
    secret: () => c.readingSecret,
    run: (l) => c.input(l),
    help: (l) => c.help(l),
    complete: (l) => c.complete(l),
    ctrlZ: () => c.ctrlZ(),
    history: c.history,
    start: () => c.boot(),
  };
}

export function pcSession(pc: Pc): Session {
  const history: string[] = [];
  return {
    prompt: () => pc.shell.prompt(),
    secret: () => false,
    run: (l) => {
      if (l.trim()) history.push(l);
      return pc.shell.execute(l);
    },
    history,
    start: () => [pc.shell.banner, ""],
  };
}

const CRLF = "\r\n";

export class TerminalView {
  readonly term: Terminal;
  readonly el: HTMLDivElement;
  private readonly fit = new FitAddon();
  private buffer = "";
  private historyIndex = -1;
  /** A command still running in simulated time, like ping. Input waits for it. */
  private busy: Job | null = null;
  /** True while a command runs, so its log messages print after its output. */
  private running = false;
  private queuedLogs: string[] = [];

  constructor(
    readonly device: Device,
    private readonly session: Session,
    parent: HTMLElement,
  ) {
    this.el = document.createElement("div");
    this.el.className = "term";
    parent.appendChild(this.el);
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 14,
      theme: { background: "#0b0c0a", foreground: "#d8d4c0", cursor: "#ffb000", selectionBackground: "#3a3320" },
    });
    this.term.loadAddon(this.fit);
    this.term.open(this.el);
    this.term.onData((d) => this.onData(d));
    // Ctrl+Shift+6 doesn't produce a control character on every keyboard layout, so catch the key itself.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.ctrlKey && (e.code === "Digit6" || e.key === "^")) {
        this.onData("\x1e");
        return false;
      }
      return true;
    });
    this.writeLines(session.start());
    this.term.write(session.prompt());
  }

  show(): void {
    this.el.classList.add("active");
    this.fit.fit();
    this.term.focus();
  }

  hide(): void {
    this.el.classList.remove("active");
  }

  resize(): void {
    if (this.el.classList.contains("active")) this.fit.fit();
  }

  /** Unsolicited messages are printed above the current line, like `logging synchronous`. */
  log(text: string): void {
    if (this.busy || this.running) {
      this.queuedLogs.push(text);
      return;
    }
    this.term.write(CRLF + text + CRLF + this.session.prompt() + (this.session.secret() ? "" : this.buffer));
  }

  /**
   * Prints `text` over the current prompt line and redraws the prompt under it, so it reads as
   * the last line of the previous command's output. Once xterm has drawn it, `onMarked` gets a
   * marker on that line. Returns false, and prints nothing, if a command is running.
   */
  insertAbove(text: string, onMarked: (marker: IMarker) => void): boolean {
    if (this.busy || this.running) return false;
    const line = this.session.prompt() + (this.session.secret() ? "" : this.buffer);
    // xterm parses writes later, so the marker has to wait until this one has landed.
    this.term.write("\r\x1b[2K" + text + CRLF + line, () => {
      const marker = this.term.registerMarker(-1);
      if (marker) onMarked(marker);
    });
    return true;
  }

  private flushLogs(): void {
    for (const text of this.queuedLogs.splice(0)) this.term.write(CRLF + text + CRLF);
  }

  private writeLines(lines: string[]): void {
    for (const l of lines) this.term.write(l + CRLF);
  }

  private redrawLine(): void {
    this.term.write("\r\x1b[K" + this.session.prompt() + this.buffer);
  }

  private onData(data: string): void {
    if (this.busy) {
      // Ctrl+Shift+6 is the IOS escape sequence; Ctrl+C stops a PC command.
      if (data === "\x1e" || data === "\x03") {
        this.term.write(data === "\x1e" ? "^^" : "^C");
        this.busy.abort();
      }
      return;
    }
    if (data.startsWith("\x1b")) {
      if (data === "\x1b[A" || data === "\x1b[B") this.recall(data === "\x1b[A" ? 1 : -1);
      return;
    }
    for (const ch of data) this.onChar(ch);
  }

  private onChar(ch: string): void {
    const s = this.session;
    switch (ch) {
      case "\r":
        return this.submit();
      case "\x7f":
      case "\b":
        if (this.buffer.length) {
          this.buffer = this.buffer.slice(0, -1);
          if (!s.secret()) this.term.write("\b \b");
        }
        return;
      case "\t":
        if (s.complete && !s.secret()) {
          this.buffer = s.complete(this.buffer);
          this.redrawLine();
        }
        return;
      case "\x1a":
        if (s.ctrlZ) {
          this.term.write("^Z" + CRLF);
          this.buffer = "";
          this.running = true;
          const out = s.ctrlZ().lines;
          this.running = false;
          this.writeLines(out);
          this.flushLogs();
          this.term.write(s.prompt());
        }
        return;
      case "\x03":
        this.buffer = "";
        this.term.write("^C" + CRLF + s.prompt());
        return;
      case "?":
        if (s.help && !s.secret()) {
          this.term.write("?" + CRLF);
          const h = s.help(this.buffer);
          this.writeLines(h.lines);
          this.buffer = h.line;
          this.term.write(s.prompt() + this.buffer);
          return;
        }
        break;
    }
    if (ch < " ") return;
    this.buffer += ch;
    if (!s.secret()) this.term.write(ch);
  }

  private recall(direction: 1 | -1): void {
    const h = this.session.history;
    if (!h.length || this.session.secret()) return;
    this.historyIndex = Math.max(-1, Math.min(h.length - 1, this.historyIndex + direction));
    this.buffer = this.historyIndex < 0 ? "" : h[h.length - 1 - this.historyIndex];
    this.redrawLine();
  }

  private submit(): void {
    const line = this.buffer;
    this.buffer = "";
    this.historyIndex = -1;
    this.term.write(CRLF);
    this.running = true;
    const result = this.session.run(line);
    this.running = false;
    this.writeLines(result.lines);
    if (result.job) {
      const job = result.job;
      this.busy = job;
      job.onData((text) => this.term.write(text.replace(/\n/g, CRLF)));
      job.onDone(() => this.onJobDone());
      return;
    }
    this.flushLogs();
    this.term.write(this.session.prompt());
  }

  private onJobDone(): void {
    this.busy = null;
    this.flushLogs();
    this.term.write(this.session.prompt());
  }
}
