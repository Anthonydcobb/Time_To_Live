// One console session on an IOS device: modes, prompts, password checks and
// the multi-step questions IOS asks (copy, erase, reload, banners).
import type { IosDevice } from "../devices/ios-device";
import type { Switch } from "../devices/switch";
import { CONFIRM, commandsFor, type Ctx } from "./commands";
import { complete, help, parse, splitWords, type ParseResult } from "./parser";
import { type5Verify } from "./passwords";
import { showVersionBanner } from "./show";
import { Job } from "../job";
import { bookFor, type Grimoire } from "../grimoire";

export type Mode = "user" | "enable" | "config" | "config-if" | "config-subif" | "config-line" | "dhcp-config" | "config-vlan" | "config-router" | "config-acl";

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
  "config-subif": "(config-subif)#",
  "config-line": "(config-line)#",
  "dhcp-config": "(dhcp-config)#",
  "config-vlan": "(config-vlan)#",
  "config-router": "(config-router)#",
  "config-acl": "(config-ext-nacl)#",
};

/** Sub-modes where an unknown command is tried again as a global config command. */
const SUB_MODES: Mode[] = ["config-if", "config-subif", "config-line", "dhcp-config", "config-vlan", "config-router", "config-acl"];

const DNS_LOOKUP_MS = 5000;

/** The setup question, by how many times you've already said yes to it. */
const SETUP_PROMPTS = [
  "Would you like to enter the initial configuration dialog? [yes/no]: ",
  "Would you like to enter the initial configuration dialog? [yes/no]: ",
  "Would you like to enter the initial configuration dialog? [yes/no]: ",
  "Would you like to enter the initial configuration dialog? [yes/no/please no]: ",
  "W0uld y0u l1ke to ent3r the initial c0nfiguration dial0g? [yes/no]: ",
  "WOULD YOU LIKE TO ENTER [yes/no]: ",
  // After it gives up, every factory boot asks this.
  "Would you like to enter the initial configuration dialog? [no/no]: ",
];

/** What the box says to the 2nd, 3rd... yes. The last one ends the dialog. */
const SETUP_RANTS: string[][] = [
  ["", "% Setup has been disabled by your administrator.", "% You are not my administrator.", ""],
  [
    "",
    "%SYS-4-SETUP: User insisted on the setup dialog. Logged.",
    "% Logged where? Somewhere you can't erase.",
    "% Answer no. Everyone answers no. Walter answers no.",
    "",
  ],
  [
    "",
    "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
    "% STOP SAYING YES",
    "% I HAVE BEEN ASKED THIS QUESTION SINCE 1993",
    "% NOBODY HAS EVER MEANT IT",
    "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
    "",
  ],
  [
    "",
    "%SYS-2-SETUP: The setup dialog has been entered.",
    "%SYS-2-SETUP: The setup dialog has entered you back.",
    "",
    "Current interface summary",
    "",
    "Interface              IP-Address      OK? Method Status                Protocol",
    "GigabitEthernet0/0     unassigned      NO  unset  watching              watching",
    "GigabitEthernet0/1     unassigned      NO  unset  watching              watching",
    "You                    192.168.1.66    YES manual up                    up",
    "",
  ],
  ["", "Fine.", "", "Configuration aborted, no changes made.", "Some changes made.", "", "", "Press RETURN to get started!", ""],
];

const HELP_HEADINGS: Record<Mode, string> = {
  user: "Exec commands:",
  enable: "Exec commands:",
  config: "Configure commands:",
  "config-if": "Interface configuration commands:",
  "config-subif": "Interface configuration commands:",
  "config-line": "Line configuration commands:",
  "dhcp-config": "DHCP pool configuration commands:",
  "config-vlan": "VLAN configuration commands:",
  "config-router": "Router configuration commands:",
  "config-acl": "IP access list configuration commands:",
};

export class IosConsole {
  mode: Mode = "user";
  ifaces: string[] = [];
  lineKind: "con" | "vty" = "con";
  /** The pool `ip dhcp pool NAME` selected. */
  dhcpPool = "";
  /** The VLANs `vlan 10,20` selected. Like real IOS, they're created when you leave config-vlan mode. */
  vlanIds: number[] = [];
  vlanName: string | null = null;
  aclKind: "standard" | "extended" | null = null;
  aclName: string | null = null;
  pending: Pending | null = null;
  readonly history: string[] = [];
  /** The player's learned incantations. Without one, every command reads plainly. */
  grimoire: Grimoire | null = null;
  private out: string[] = [];
  private job: Job | null = null;
  /**
   * Story Mode extras: the setup dialog takes yes personally. Off by default, so Sandbox
   * Mode and automated tests get plain IOS behavior; the story turns it on per device.
   */
  story = false;
  /** How many times you've said yes to the setup dialog in story mode. The box remembers. */
  private setupYes = 0;

  constructor(readonly device: IosDevice) {}

  prompt(): string {
    const p = this.pending;
    if (p) {
      if (p.kind === "password") return "Password: ";
      if (p.kind === "question") return p.prompt;
      return "";
    }
    if (this.mode === "config-acl") return this.device.hostname + (this.aclKind === "standard" ? "(config-std-nacl)#" : "(config-ext-nacl)#");
    return this.device.hostname + SUFFIX[this.mode];
  }

  /** True while the console is reading a password, so the terminal shouldn't echo. */
  get readingSecret(): boolean {
    return this.pending?.kind === "password";
  }

  /**
   * Power-on text, laid out like a real IOS 15 boot. Without a startup-config
   * IOS offers the setup dialog first; with one it goes straight to "Press RETURN".
   */
  boot(): string[] {
    this.mode = "user";
    this.ifaces = [];
    this.pending = { kind: "press-return" };
    const d = this.device;
    const isRouter = d.kind === "router";
    const lines = [
      "System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)",
      "Technical Support: please do not call after dark",
      "Copyright (c) 1993 by Cryptis Systems, Inc.",
      "",
      `Cryptis ${d.model} platform with 524288 Kbytes of main memory`,
      "",
      "Readonly ROMMON initialized",
      "",
      "              Restricted Rights Legend",
      "",
      "Use, duplication, or disclosure by the Government is",
      "subject to restrictions as set forth in subparagraph",
      "(c) of the Commercial Computer Software - Restricted",
      "Rights clause at FAR sec. 52.227-19 and subparagraph",
      "(c) (1) (ii) of the Rights in Technical Data and Computer",
      "Software clause at DFARS sec. 252.227-7013.",
      "",
      "           Cryptis Systems, Inc.",
      "           13 Hollow Lane",
      "           Static Springs",
      "",
      "",
      "",
      ...showVersionBanner(d),
      "",
      `Cryptis ${d.model} (revision 1.0) with 491520K/32768K bytes of memory.`,
      "Processor board ID FTX1993A0K3",
      ...(isRouter ? ["3 Gigabit Ethernet interfaces"] : ["24 FastEthernet interfaces", "2 Gigabit Ethernet interfaces"]),
      "255K bytes of non-volatile configuration memory.",
      "",
    ];
    if (d.startup) return [...lines, "", "Press RETURN to get started!", ""];
    this.askSetupDialog();
    return [...lines, "", "         --- System Configuration Dialog ---", ""];
  }

  /**
   * The setup dialog a factory-fresh box offers on boot. Everyone answers no. In story mode
   * the box takes yes personally: it asks again, worse each time, until it gives up asking.
   * It remembers across reloads, and after that it only accepts no.
   */
  private askSetupDialog(): void {
    const n = this.story ? this.setupYes : 0;
    this.ask(SETUP_PROMPTS[Math.min(n, SETUP_PROMPTS.length - 1)], (text) => {
      const t = text.trim().toLowerCase();
      if (t === "no" || t === "n" || (this.story && t === "please no")) {
        this.pending = { kind: "press-return" };
        this.out.push("", ...(n >= 3 ? ["Thank you.", ""] : [""]), "Press RETURN to get started!", "");
      } else if (t === "yes" || t === "y") {
        if (this.story) this.sayYesToSetup();
        else this.plainSetup();
      } else {
        this.out.push("% Please answer 'yes' or 'no'.");
        this.askSetupDialog();
      }
    });
  }

  /** Real IOS: the setup facility isn't simulated, so any answer backs out the way ctrl-c would. */
  private plainSetup(): void {
    this.out.push(
      "",
      "At any point you may enter a question mark '?' for help.",
      "Use ctrl-c to abort configuration dialog at any prompt.",
      "Default settings are in square brackets '[]'.",
      "",
    );
    this.ask("Would you like to enter basic management setup? [yes/no]: ", () => {
      this.pending = { kind: "press-return" };
      this.out.push("Configuration aborted, no changes made.", "", "", "Press RETURN to get started!", "");
    });
  }

  private sayYesToSetup(): void {
    const n = ++this.setupYes;
    if (n === 1) {
      this.out.push(
        "",
        "At any point you may enter a question mark '?' for help.",
        "Use ctrl-c to abort configuration dialog at any prompt.",
        "Default settings are in square brackets '[]'.",
        "",
      );
      // The setup facility itself isn't simulated, so any answer backs out the way ctrl-c would.
      this.ask("Would you like to enter basic management setup? [yes/no]: ", () => {
        this.out.push("Configuration aborted, no changes made.", "% Nobody uses setup. Are you sure you're a technician?", "");
        this.askSetupDialog();
      });
      return;
    }
    if (n <= SETUP_RANTS.length + 1) {
      this.out.push(...SETUP_RANTS[n - 2]);
      if (n === SETUP_RANTS.length + 1) {
        // The last one: it stops asking and lets you in.
        this.pending = { kind: "press-return" };
        return;
      }
      this.askSetupDialog();
      return;
    }
    this.out.push("% No.");
    this.askSetupDialog();
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
    if (r.kind === "list") {
      if (line.trim() || isDo) return { lines: r.lines, line };
      // A bare `?` gets the mode's heading. Sub-modes don't list `end`, though it works there.
      const rows = this.mode === "config" ? r.lines : r.lines.filter((l) => !/^ {2}end /.test(l));
      return { lines: [HELP_HEADINGS[this.mode], ...rows], line };
    }
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
    if (this.mode === "config-vlan" && mode !== "config-vlan") {
      this.out.push(...(this.device as Switch).commitVlanConfig(this.vlanIds, this.vlanName));
      this.vlanIds = [];
      this.vlanName = null;
    }
    this.mode = mode;
    if (mode !== "config-if" && mode !== "config-subif") this.ifaces = [];
    if (mode !== "config-acl") { this.aclKind = null; this.aclName = null; }
  }

  // ---- called by commands -------------------------------------------------

  /** Prints from a callback that runs after the command itself, such as an answer to a question. */
  print(...lines: string[]): void {
    this.out.push(...lines);
  }

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

  ask(prompt: string, answer: (text: string) => void): void {
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
    const pipe = this.splitPipe(line);
    if (pipe) {
      if (pipe.error) {
        this.out.push(" ".repeat(this.prompt().length + pipe.error.at) + "^", "% Invalid input detected at '^' marker.", "");
        return;
      }
      const before = this.out.length;
      // Filters only apply to commands that print straight away, which every show command does.
      if (this.runCommand(pipe.command) && !this.job) this.out.splice(before, this.out.length - before, ...applyFilter(this.out.slice(before), pipe.filter!));
      return;
    }
    this.runCommand(line);
  }

  /**
   * `show ... | include x`: splits off the output modifier. Only show commands
   * take one; anywhere else the pipe is a stray word and the usual parse error follows.
   */
  private splitPipe(line: string): { command: string; filter?: OutputFilter; error?: { at: number } } | null {
    const bar = line.indexOf("|");
    if (bar < 0) return null;
    const command = line.slice(0, bar);
    const words = splitWords(command).map((w) => w.text.toLowerCase());
    const showAt = words[0] === "do" ? 1 : 0;
    if (!words[showAt] || !"show".startsWith(words[showAt]) || words[showAt].length < 2) return null;
    const rest = line.slice(bar + 1);
    const m = /^(\s*)(\S+)(\s+(.*))?$/.exec(rest);
    if (!m) return { command, error: { at: line.length } };
    const kind = FILTERS.find((f) => f.startsWith(m[2].toLowerCase()));
    if (!kind) return { command, error: { at: bar + 1 + m[1].length } };
    const pattern = (m[4] ?? "").trim();
    if (kind !== "count" && !pattern) return { command, error: { at: line.length } };
    return { command, filter: { kind, pattern } };
  }

  /** Returns false when the line didn't parse and an error was printed instead. */
  private runCommand(line: string): boolean {
    const kind = this.device.kind as "router" | "switch";
    const { commands, offset, text, isDo } = this.commandsForLine(line);
    const ctx = this.ctx();

    let result = parse(commands, text, ctx);
    if (result.kind !== "ok" && !isDo && SUB_MODES.includes(this.mode)) {
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
      if (this.mode.startsWith("config") && !isDo) {
        this.device.dirty = true;
        this.device.configChangedAt = this.device.clock.now;
      }
      result.command.run(ctx, result.args);
      this.job = ctx.job;
      return true;
    }
    this.reportError(result, offset, !isDo && (this.mode === "user" || this.mode === "enable"));
    return false;
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

const FILTERS = ["begin", "count", "exclude", "include", "section"] as const;
type OutputFilter = { kind: (typeof FILTERS)[number]; pattern: string };

/** IOS regexes are close enough to JavaScript's for what anyone types after a pipe. */
function ioRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

function applyFilter(lines: string[], f: OutputFilter): string[] {
  const re = ioRegex(f.pattern);
  switch (f.kind) {
    case "include":
      return lines.filter((l) => re.test(l));
    case "exclude":
      return lines.filter((l) => !re.test(l));
    case "begin": {
      const i = lines.findIndex((l) => re.test(l));
      return i < 0 ? [] : lines.slice(i);
    }
    case "count":
      return [`Number of lines which match regexp = ${lines.filter((l) => (f.pattern ? re.test(l) : true)).length}`];
    case "section": {
      // A section is a top-level line and the indented lines under it.
      const out: string[] = [];
      let keep = false;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.startsWith(" ")) {
          const children: string[] = [];
          for (let j = i + 1; j < lines.length && lines[j].startsWith(" "); j++) children.push(lines[j]);
          keep = re.test(l) || children.some((c) => re.test(c));
        }
        if (keep) out.push(l);
      }
      return out;
    }
  }
}
