import { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import { CableError, type Device, type Network, type Port } from "../sim/network";
import { lightFor } from "../web/topology";
import { TerminalView, iosSession, pcSession } from "../web/terminal";
import { audio } from "./audio";

/** One line of dialogue. `who` is printed above it. */
export interface Line {
  who?: string;
  text: string;
  /** Which of the speaker's portraits to show: 0 calm, 1 paranoid, 2 frantic. Default 0. */
  mood?: 0 | 1 | 2;
}

/**
 * Portraits by speaker. `busts` are illustrations by mood (calm, paranoid, frantic) shown
 * over the room; a mood without one falls back to `sheet`, three 64 px pixel faces side by side.
 */
const PORTRAITS: Record<string, { busts?: (string | undefined)[]; sheet?: string }> = {
  "MRS. FINCH": { busts: ["assets/portraits/mrs-finch-bust.webp"], sheet: "assets/portraits/mrs-finch.png" },
  // You only ever hear Walter, so his portrait is the radio.
  "WALTER (walkie)": { busts: ["assets/portraits/walter-bust.webp"] },
  // The contractor. She has no spoken lines yet.
  SIMONE: { busts: ["assets/portraits/simone-bust.webp"] },
};

export interface Choice {
  label: string;
  run: () => void;
}

interface Entry extends Line {
  then?: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Walter only ever talks over the radio, so his lines get static. */
const isWalter = (line?: Line) => !!line?.who?.startsWith("WALTER");
const TYPE_MS = 18;

/**
 * Everything drawn in HTML over the game: dialogue, choices, title cards,
 * the laptop terminal and the port panel. While any of it is open, the
 * player can't move.
 */
export class Ui {
  /** When something last closed, so the key that closed it doesn't also trigger the next thing. */
  closedAt = 0;
  private queue: Entry[] = [];
  private current: Entry | null = null;
  private typed = 0;
  private typer = 0;
  private choices: Choice[] | null = null;
  private picked = 0;
  private card: (() => void) | null = null;
  private screen: TerminalView | null = null;
  private panelOpen = false;
  private readonly views = new Map<Device, TerminalView>();
  /** A cable you pulled out on the port panel. Its other end is still plugged in at `far`. */
  private holding: Port | null = null;
  private panelDevices: Device[] = [];
  private readonly portButtons = new Map<Port, HTMLButtonElement>();
  private hintHeld = false;
  private net: Network | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    $("panel-close").addEventListener("click", () => this.closePanel());
    $("laptop-close").addEventListener("click", () => this.closeLaptop());
    window.addEventListener("resize", () => this.screen?.resize());
  }

  get busy(): boolean {
    return !!(this.current || this.choices || this.card || this.screen || this.panelOpen);
  }

  /** Whether a terminal or the port panel has the keyboard. */
  get typing(): boolean {
    return !!(this.screen || this.panelOpen);
  }

  // ---- dialogue -------------------------------------------------------------

  say(lines: Line[], then?: () => void): void {
    lines.forEach((l, i) => this.queue.push({ ...l, then: i === lines.length - 1 ? then : undefined }));
    if (!this.busy) this.showNext();
  }

  private showNext(): void {
    const next = this.queue.shift();
    audio.walkie(isWalter(next));
    if (!next) {
      $("dialogue").hidden = true;
      this.hideCloseUp();
      this.closedAt = performance.now();
      return;
    }
    this.current = next;
    $("dialogue").hidden = false;
    $("choices").hidden = true;
    const who = $("who");
    who.textContent = next.who ?? "";
    who.hidden = !next.who;
    this.showPortrait(next);
    this.typed = 0;
    window.clearInterval(this.typer);
    this.typer = window.setInterval(() => {
      this.typed += 2;
      this.renderLine();
      if (this.typed >= next.text.length) window.clearInterval(this.typer);
    }, TYPE_MS);
    this.renderLine();
  }

  /** Shows an illustrated close-up until the dialogue it goes with closes. */
  showCloseUp(src: string): void {
    const img = $<HTMLImageElement>("closeup");
    if (!img.src.endsWith(src)) img.src = src;
    img.hidden = false;
  }

  hideCloseUp(): void {
    $("closeup").hidden = true;
  }

  private showPortrait(line: Line): void {
    const mood = line.mood ?? 0;
    const set = line.who ? PORTRAITS[line.who] : undefined;
    const bust = set?.busts?.[mood];
    const sheet = bust ? undefined : set?.sheet;
    const img = $<HTMLImageElement>("bust");
    img.hidden = !bust;
    if (bust && !img.src.endsWith(bust)) img.src = bust;
    const el = $("portrait");
    el.hidden = !sheet;
    $("dialogue").classList.toggle("has-portrait", !!sheet);
    if (!sheet) return;
    el.style.backgroundImage = `url(${sheet})`;
    el.style.backgroundPosition = `${mood * 50}% 0`;
  }

  private renderLine(): void {
    if (!this.current) return;
    $("line").textContent = this.current.text.slice(0, this.typed);
    $("more").hidden = this.typed < this.current.text.length;
  }

  private advance(): void {
    const c = this.current;
    if (!c) return;
    if (this.typed < c.text.length) {
      this.typed = c.text.length;
      window.clearInterval(this.typer);
      this.renderLine();
      return;
    }
    this.current = null;
    // Unkey the radio after every line; the next Walter line keys it again, like a real walkie.
    audio.walkie(false);
    c.then?.();
    if (!this.current && !this.choices && !this.screen && !this.panelOpen) this.showNext();
  }

  choose(prompt: Line, options: Choice[]): void {
    this.current = null;
    this.choices = options;
    this.picked = 0;
    audio.walkie(isWalter(prompt));
    $("dialogue").hidden = false;
    $("who").textContent = prompt.who ?? "";
    $("who").hidden = !prompt.who;
    this.showPortrait(prompt);
    $("line").textContent = prompt.text;
    $("more").hidden = true;
    const list = $("choices");
    list.hidden = false;
    list.replaceChildren(
      ...options.map((o, i) => {
        const li = document.createElement("li");
        li.textContent = o.label;
        li.addEventListener("click", () => this.pick(i));
        return li;
      }),
    );
    this.renderChoices();
  }

  private renderChoices(): void {
    Array.from($("choices").children).forEach((li, i) => li.classList.toggle("picked", i === this.picked));
  }

  private pick(i: number): void {
    const options = this.choices;
    if (!options) return;
    this.choices = null;
    $("choices").hidden = true;
    $("dialogue").hidden = true;
    this.hideCloseUp();
    audio.walkie(false);
    this.closedAt = performance.now();
    options[i].run();
    if (!this.current && !this.choices && !this.screen && !this.panelOpen) this.showNext();
  }

  // ---- title cards ----------------------------------------------------------

  /** A full-screen card, like the town sign or the job report. E closes it after `minMs`. */
  showCard(html: string, then?: () => void, minMs = 1200): HTMLElement {
    const el = $("card");
    el.innerHTML = html + `<p class="press">E to continue</p>`;
    el.hidden = false;
    const shownAt = performance.now();
    window.setTimeout(() => el.querySelector(".press")?.classList.add("shown"), minMs);
    this.card = () => {
      if (performance.now() - shownAt < minMs) return;
      el.hidden = true;
      this.card = null;
      this.closedAt = performance.now();
      then?.();
      if (!this.busy) this.showNext();
    };
    return el;
  }

  // ---- laptop ---------------------------------------------------------------

  /** Builds a terminal for every device now, so log messages pile up even before you look. */
  attach(net: Network, devices: Device[]): void {
    this.net = net;
    const screen = $("laptop-screen");
    for (const d of devices) {
      const session = d instanceof IosDevice ? iosSession(d) : pcSession(d as Pc);
      const view = new TerminalView(d, session, screen);
      this.views.set(d, view);
      d.onOutput((text) => view.log(text));
    }
  }

  openLaptop(device: Device, title: string, hint: string): void {
    const view = this.views.get(device);
    if (!view) return;
    $("laptop-title").textContent = title;
    $("laptop-hint").textContent = hint;
    $("laptop").hidden = false;
    this.screen = view;
    view.show();
  }

  closeLaptop(): void {
    if (!this.screen) return;
    this.screen.hide();
    this.screen = null;
    $("laptop").hidden = true;
    this.closedAt = performance.now();
    (document.activeElement as HTMLElement | null)?.blur();
    this.showNext();
  }

  // ---- port panel -----------------------------------------------------------

  openPanel(devices: Device[]): void {
    this.panelDevices = devices;
    this.panelOpen = true;
    $("panel").hidden = false;
    this.buildPanel();
  }

  closePanel(): void {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    $("panel").hidden = true;
    this.closedAt = performance.now();
    this.showNext();
  }

  /** Redraws the port lights. Called a few times a second. */
  refresh(): void {
    if (this.panelOpen) this.updatePanel();
  }

  /** Builds a button per port once; `updatePanel` keeps their lights current. */
  private buildPanel(): void {
    this.portButtons.clear();
    $("panel-body").replaceChildren(
      ...this.panelDevices.map((d) => {
        const box = document.createElement("section");
        box.className = "chassis";
        const h = document.createElement("h3");
        const ports = document.createElement("div");
        ports.className = "ports";
        for (const p of d.ports) ports.appendChild(this.portButton(p));
        box.append(h, ports);
        if (!(d instanceof IosDevice)) box.classList.add("loose");
        return box;
      }),
    );
    this.updatePanel();
  }

  private updatePanel(): void {
    const titles = $("panel-body").querySelectorAll("h3");
    this.panelDevices.forEach((d, i) => {
      titles[i].textContent = d instanceof IosDevice ? `${d.hostname} · ${d.model}` : `Cable from the ${d.hostname} PC, run under the floor`;
    });
    for (const [p, b] of this.portButtons) {
      const light = p.kind === "console" ? "none" : lightFor(p) === "red" ? "off" : lightFor(p);
      b.querySelector(".light")!.className = `light ${light}`;
      b.querySelector(".peer")!.textContent = p.peer ? where(p.peer) : p === this.holding ? "in your hand" : "";
      b.title = p.peer ? `${p.name} → ${where(p.peer)}` : p.name;
      b.classList.toggle("held", p === this.holding);
    }
    if (!this.hintHeld) {
      $("panel-hint").textContent = this.holding
        ? `Holding a cable from ${where(this.holding)}. Click a free port to plug in the other end, or click ${this.holding.shortName} again to let go.`
        : "Click a free port to run a cable from it, then click where the other end goes. Click a plugged-in cable to pull it out.";
    }
  }

  private portButton(p: Port): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `port ${p.kind}`;
    b.innerHTML = `<span class="light"></span><span class="name"></span><span class="peer"></span>`;
    b.querySelector(".name")!.textContent = p.shortName;
    b.addEventListener("click", () => this.clickPort(p));
    this.portButtons.set(p, b);
    return b;
  }

  private clickPort(p: Port): void {
    if (!this.net || p.kind === "console") return;
    if (p === this.holding) {
      this.holding = null;
    } else if (p.peer) {
      if (this.holding) return this.flash("You're already holding a cable.");
      this.holding = p.peer;
      this.net.disconnect(p);
    } else if (this.holding) {
      try {
        this.net.connect(this.holding, p);
        this.holding = null;
      } catch (e) {
        if (e instanceof CableError) return this.flash(e.message);
        throw e;
      }
    } else {
      // A fresh patch cable, plugged in at this end so far.
      this.holding = p;
    }
    this.hintHeld = false;
    this.updatePanel();
  }

  /** Shows a message in place of the usual hint until the next click. */
  private flash(text: string): void {
    this.hintHeld = true;
    $("panel-hint").textContent = text;
  }

  // ---- keys -----------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const confirm = e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter";
    if (e.key === "Escape" && (this.screen || this.panelOpen)) {
      e.preventDefault();
      e.stopPropagation();
      if (this.screen) this.closeLaptop();
      else this.closePanel();
      return;
    }
    if (this.screen || this.panelOpen) return;
    if (this.card) {
      if (confirm || e.key === "Escape") {
        e.preventDefault();
        this.card();
      }
      return;
    }
    if (this.choices) {
      const n = this.choices.length;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") this.picked = (this.picked + n - 1) % n;
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") this.picked = (this.picked + 1) % n;
      else if (!confirm && e.key !== "Escape") return;
      // Keep the key from landing in a terminal that the choice opens.
      e.preventDefault();
      if (confirm) return this.pick(this.picked);
      if (e.key === "Escape") return this.pick(n - 1);
      this.renderChoices();
      return;
    }
    if (this.current && confirm) {
      e.preventDefault();
      this.advance();
    }
  }
}

/** "S1 Fa0/1", or "the wall" for a cable nobody ran. */
function where(p: Port): string {
  return p.device.id === "PHANTOM" ? "the wall" : `${p.device.hostname} ${p.shortName}`;
}
