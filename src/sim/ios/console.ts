// One console session on an IOS device: modes, prompts, password checks and
// the multi-step questions IOS asks (copy, erase, reload, banners).
import type { IosDevice } from "../devices/ios-device";
import { commandsFor, type Ctx } from "./commands";
import { complete, help, parse, splitWords, type ParseResult } from "./parser";
import { type5Verify } from "./passwords";
import { Job } from "../job";
import { bookFor, type Grimoire } from "../grimoire";

export type Mode = "user" | "enable" | "config" | "config-if" | "config-line" | "dhcp-config";

type Pending =
  | { kind: "press-return" }
  | { kind: "password"; purpose: "login" | "enable"; attempts: number }
  | { kind: "question"; prompt: string; answer: (text: string) => void }
  | { kind: "banner"; delimiter: string; lines: string[] };

export interface ConsoleOutput {
  lines: string[];
  /** Set when the command keeps running in simulated time, like ping or a DNS lookup on a typo. */
  job?: Job;
}

const SUFFIX: Record<Mode, string> = {
  user: ">",
  enable: "#",
  config: "(config)#",
  "config-if": "(config-if)#",
  "config-line": "(config-line)#",
  "dhcp-config": "(dhcp-config)#",
};

const CONFIRM = (text: string) => ["", "y", "yes"].includes(text.trim().toLowerCase());
const DNS_LOOKUP_MS = 5000;

export class IosConsole {
  mode: Mode = "user";
  ifaces: string[] = [];
  lineKind: "con" | "vty" = "con";
  /** The pool `ip dhcp pool NAME` selected. */
  dhcpPool = "";
  pending: Pending | null = null;
  readonly history: string[] = [];
  /** The player's learned incantations. Without one, every command reads plainly. */
  grimoire: Grimoire | null = null;
  private out: string[] = [];
  private job: Job | null = null;

  constructor(readonly device: IosDevice) {}

  prompt(): string {
    const p = this.pending;
    if (p) {
      if (p.kind === "password") return "Password: ";
      if (p.kind === "question") return p.prompt;
      return "";
    }
    return this.device.hostname + SUFFIX[this.mode];
  }

  /** True while the console is reading a password, so the terminal shouldn't echo. */
  get readingSecret(): boolean {
    return this.pending?.kind === "password";
  }

  /** Power-on text, ending at "Press RETURN to get started!". */
  boot(): string[] {
    this.mode = "user";
    this.ifaces = [];
    this.pending = { kind: "press-return" };
    const d = this.device;
    return [
      "System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)",
      "Copyright (c) 1986-1993 by Cryptis Systems, Inc.",
      `Initializing memory for ECC... done.`,
      `Cryptis ${d.model} platform with 524288 Kbytes of main memory`,
      "",
      "Readonly ROMMON initialized",
      "",
      d.startup ? "Loading startup-config from NVRAM... [OK]" : "--- No startup-config found. Booting with factory defaults. ---",
      "",
      "Press RETURN to get started!",
      "",
    ];
  }

  input(line: string): ConsoleOutput {
    this.out = [];
    this.job = null;
    if (this.pending) this.handlePending(line);
    else this.run(line);
    return this.job ? { lines: this.out, job: this.job } : { lines: this.out };
  }

  /** `?` pressed. `line` is what was typed before it. Returns help and the text to put back. */
  help(line: string): { lines: string[]; line: string } {
    if (this.pending) return { lines: [], line };
    const { commands, offset, text, isDo } = this.commandsForLine(line);
    const r = help(commands, text, this.ctx(), this.reveal(isDo));
    if (r.kind === "list") return { lines: r.lines, line };
    this.out = [];
    this.reportError(r.result as ParseResult<Ctx>, offset, false);
    return { lines: this.out, line };
  }

  /** Tab pressed. Returns the completed line, or the same line if nothing matched. */
  complete(line: string): string {
    if (this.pending) return line;
    const { commands, offset, text, isDo } = this.commandsForLine(line);
    const done = complete(commands, text, this.ctx(), this.reveal(isDo));
    return done === null ? line : line.slice(0, offset) + done;
  }

  /** Ctrl+Z: leave configuration mode. */
  ctrlZ(): ConsoleOutput {
    this.out = [];
    if (!this.pending && this.mode !== "user" && this.mode !== "enable") {
      this.setMode("enable");
      this.device.emit("%SYS-5-CONFIG_I: Configured from console by console");
    }
    return { lines: this.out };
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== "config-if") this.ifaces = [];
  }

  // ---- called by commands -------------------------------------------------

  beginEnable(): void {
    const cfg = this.device.config;
    if (!cfg.enableSecret && !cfg.enablePassword) this.setMode("enable");
    else this.pending = { kind: "password", purpose: "enable", attempts: 0 };
  }

  logout(): void {
    this.setMode("user");
    this.pending = { kind: "press-return" };
    this.out.push("", "", `${this.device.hostname} con0 is now available`, "", "", "", "", "", "Press RETURN to get started.", "");
  }

  beginBanner(text: string): void {
    const delimiter = text[0];
    const rest = text.slice(1);
    const end = rest.indexOf(delimiter);
    if (end >= 0) {
      this.device.config.bannerMotd = rest.slice(0, end);
      return;
    }
    this.out.push(`Enter TEXT message.  End with the character '${delimiter}'.`);
    this.pending = { kind: "banner", delimiter, lines: rest.trim() ? [rest.trimStart()] : [] };
  }

  askCopyRunStart(): void {
    this.ask("Destination filename [startup-config]? ", (text) => {
      const name = text.trim();
      if (name && name !== "startup-config") {
        this.out.push(`%Error opening flash:${name} (Permission denied)`);
        return;
      }
      this.out.push("Building configuration...", "[OK]");
      this.device.saveConfig();
    });
  }

  askErase(): void {
    this.ask("Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]", (text) => {
      if (!CONFIRM(text)) return;
      this.device.eraseStartup();
      this.out.push("[OK]", "Erase of nvram: complete");
      this.device.emit("%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram");
    });
  }

  askReload(): void {
    const proceed = () =>
      this.ask("Proceed with reload? [confirm]", (text) => {
        if (!CONFIRM(text)) return;
        this.device.reload();
        this.out.push(...this.boot());
      });
    if (!this.device.dirty) {
      proceed();
      return;
    }
    const askSave = (): void =>
      this.ask("System configuration has been modified. Save? [yes/no]: ", (text) => {
        const t = text.trim().toLowerCase();
        if (t === "yes" || t === "y") {
          this.out.push("Building configuration...", "[OK]");
          this.device.saveConfig();
        } else if (t !== "no" && t !== "n") {
          this.out.push("% Please answer 'yes' or 'no'.");
          askSave();
          return;
        }
        proceed();
      });
    askSave();
  }

  // ---- internals ------------------------------------------------------------

  private ask(prompt: string, answer: (text: string) => void): void {
    this.pending = { kind: "question", prompt, answer };
  }

  private reveal(isDo: boolean) {
    const g = this.grimoire;
    if (!g) return undefined;
    const book = isDo ? "exec" : bookFor(this.mode);
    return (path: string[]) => g.knows(book, path);
  }

  /** Using a command correctly teaches it, so players who already know IOS aren't held back. */
  private learnFrom(tokens: { type: string; word?: string }[], book: ReturnType<typeof bookFor>): void {
    this.grimoire?.learn(book, tokens.map((t) => (t.type === "kw" ? t.word! : "*")));
  }

  private ctx(): Ctx {
    return { device: this.device, console: this, out: this.out, job: null };
  }

  /** Splits off a leading `do` in config modes, which runs a privileged EXEC command. */
  private commandsForLine(line: string) {
    const words = splitWords(line);
    const kind = this.device.kind as "router" | "switch";
    if (this.mode.startsWith("config") && words[0]?.text.toLowerCase() === "do" && words.length > 1) {
      return { commands: commandsFor("enable", kind), offset: words[1].start, text: line.slice(words[1].start), isDo: true };
    }
    return { commands: commandsFor(this.mode, kind), offset: 0, text: line, isDo: false };
  }

  private run(line: string): void {
    if (!line.trim()) return;
    this.history.push(line);
    const kind = this.device.kind as "router" | "switch";
    const { commands, offset, text, isDo } = this.commandsForLine(line);
    const ctx = this.ctx();

    let result = parse(commands, text, ctx);
    if (result.kind !== "ok" && !isDo && (this.mode === "config-if" || this.mode === "config-line" || this.mode === "dhcp-config")) {
      // Sub-modes fall back to global config commands, like real IOS.
      const global = parse(commandsFor("config", kind), text, ctx);
      if (global.kind === "ok") {
        this.setMode("config");
        result = global;
      }
    }
    if (result.kind === "ok") {
      // Learned in the book of the mode it was spoken in, before the command can change modes.
      this.learnFrom(result.command.tokens, isDo ? "exec" : bookFor(this.mode));
      if (this.mode.startsWith("config") && !isDo) this.device.dirty = true;
      result.command.run(ctx, result.args);
      this.job = ctx.job;
      return;
    }
    this.reportError(result, offset, !isDo && (this.mode === "user" || this.mode === "enable"));
  }

  private reportError(result: ParseResult<Ctx>, offset: number, exec: boolean): void {
    if (result.kind === "invalid") {
      if (exec && result.wordIndex === 0 && result.wordCount === 1) {
        // IOS assumes an unknown word is a hostname to telnet to.
        const word = splitWords(this.history[this.history.length - 1] ?? "")[0]?.text ?? "";
        const unknown = "% Unknown command or computer name, or unable to find computer address\n";
        if (!this.device.config.ipDomainLookup) {
          this.out.push(`Translating "${word}"`, unknown.trimEnd());
          return;
        }
        this.out.push(`Translating "${word}"...domain server (255.255.255.255)`);
        const job = new Job();
        this.device.clock.schedule(DNS_LOOKUP_MS, () => {
          job.write(unknown);
          job.finish();
        });
        job.onAbort(() => job.write("\n" + unknown));
        this.job = job;
        return;
      }
      this.out.push(" ".repeat(this.prompt().length + offset + result.caret) + "^", "% Invalid input detected at '^' marker.", "");
    } else if (result.kind === "incomplete") {
      this.out.push("% Incomplete command.", "");
    } else if (result.kind === "ambiguous") {
      this.out.push(`% Ambiguous command:  "${result.text}"`, "");
    }
  }

  private handlePending(line: string): void {
    const p = this.pending!;
    switch (p.kind) {
      case "press-return":
        this.startSession();
        return;
      case "password":
        this.checkPassword(p, line);
        return;
      case "question":
        this.pending = null;
        p.answer(line);
        return;
      case "banner": {
        const end = line.indexOf(p.delimiter);
        if (end < 0) {
          p.lines.push(line);
          return;
        }
        p.lines.push(line.slice(0, end));
        this.device.config.bannerMotd = p.lines.join("\n");
        this.pending = null;
        return;
      }
    }
  }

  private startSession(): void {
    const cfg = this.device.config;
    this.pending = null;
    this.setMode("user");
    if (cfg.bannerMotd !== null) this.out.push(...cfg.bannerMotd.split("\n"), "");
    if (!cfg.con.login) return;
    if (!cfg.con.password) {
      this.out.push("", "Password required, but none set", "");
      this.pending = { kind: "press-return" };
      return;
    }
    this.out.push("", "User Access Verification", "");
    this.pending = { kind: "password", purpose: "login", attempts: 0 };
  }

  private checkPassword(p: Extract<Pending, { kind: "password" }>, text: string): void {
    const cfg = this.device.config;
    let ok: boolean;
    if (p.purpose === "login") ok = cfg.con.password?.text === text;
    else if (cfg.enableSecret) ok = type5Verify(text, cfg.enableSecret);
    else ok = cfg.enablePassword?.text === text;

    if (ok) {
      this.pending = null;
      this.setMode(p.purpose === "enable" ? "enable" : "user");
      return;
    }
    p.attempts++;
    if (p.attempts < 3) return;
    if (p.purpose === "enable") {
      this.pending = null;
      this.out.push("% Bad secrets", "");
    } else {
      this.pending = { kind: "press-return" };
      this.out.push("% Bad passwords", "");
    }
  }
}
