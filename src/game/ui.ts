import { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import type { IMarker } from "@xterm/xterm";
import { CableError, type Device, type Network, type Port } from "../sim/network";
import { lightFor } from "../web/topology";
import { TerminalView, iosSession, pcSession } from "../web/terminal";
import { apparition, apparitionPlaying } from "./apparition";
import { audio } from "./audio";
import { crt } from "./crt";
import { GrimoireBook, type BookContents } from "./grimoire-book";
import { LaptopScreen } from "./laptop-screen";
import { parseLine, renderRuns, visibleLength, type Run } from "./markup";
import { TownMap, type SiteId } from "./town-map";
import { PcScreen } from "./pc-screen";
import { Overgrowth } from "./overgrowth";
import { ROOMS } from "./rooms";
import type { Point } from "../web/topology";

/** One line of dialogue. `who` is printed above it. */
export interface Line {
  who?: string;
  text: string;
  /** Which of the speaker's portraits to show: 0 calm, 1 paranoid, 2 frantic. Default 0. */
  mood?: 0 | 1 | 2;
  /** Scene events to fire once this many characters have typed out, like a flicker mid-sentence. */
  cues?: { at: number; event: string }[];
  /** Cues to fire once the line's been read and you move on, like a `#set` in the script. */
  after?: string[];
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
  // The laundromat's night manager, on shift since 1974.
  GUS: { busts: ["assets/portraits/gus-bust.webp"] },
};

export interface Choice {
  label: string;
  run: () => void;
}

interface Entry extends Line {
  then?: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Images fetched and decoded up front, kept alive so the browser keeps them cached. */
const preloaded = new Map<string, HTMLImageElement>();
function preload(src: string): void {
  if (preloaded.has(src)) return;
  const img = new Image();
  img.src = src;
  img.decode().catch(() => undefined);
  preloaded.set(src, img);
}

/**
 * Shows `src` in `img`, but only once it has decoded. Until then the element stays hidden,
 * so it never shows the previous speaker's picture while the new one loads.
 */
function showImage(img: HTMLImageElement, src: string): void {
  if (img.dataset.src === src && !img.hidden) return;
  img.dataset.src = src;
  img.hidden = true;
  img.src = src;
  img
    .decode()
    .catch(() => undefined)
    .then(() => {
      if (img.dataset.src === src) img.hidden = false;
    });
}

function hideImage(img: HTMLImageElement): void {
  img.hidden = true;
  delete img.dataset.src;
}

const NOISE = "░▒▓█▚▞▖▗▘▝";

/** `text` with all but `shown` (0 to 1) of its characters turned to static. Gaps mostly stay gaps. */
function staticOf(text: string, shown: number): string {
  return [...text]
    .map((ch) => {
      if (Math.random() < shown) return ch;
      if (ch === " " && Math.random() < 0.7) return " ";
      return NOISE[Math.floor(Math.random() * NOISE.length)];
    })
    .join("");
}

/** Leftovers burned into the console's screen, half-visible behind whatever is being said. */
const GHOST_WORDS = [
  "dust", "static", "no route to host", "ttl exceeded", "bellwether", "who is there",
  "0.0.0.0", "%LINK-3-UPDOWN", "packet loss", "it hears you", "request timed out", "%%",
  "arp: incomplete", "keepalive", "do not unplug", "4,218", "echo", "carrier lost",
];

/** Scatters a few ghost words across the screen, each fading in and out on its own clock. */
function haunt(el: HTMLElement): void {
  const words = [...GHOST_WORDS].sort(() => Math.random() - 0.5).slice(0, 6);
  el.replaceChildren(
    ...words.map((w, i) => {
      const s = document.createElement("span");
      s.textContent = w;
      // Alternate sides so they hug the edges and stay clear of the middle of the text.
      s.style.left = i % 2 ? `${62 + Math.random() * 26}%` : `${Math.random() * 18}%`;
      s.style.top = `${4 + Math.random() * 84}%`;
      s.style.animationDelay = `${-Math.random() * 7}s`;
      s.style.animationDuration = `${5 + Math.random() * 5}s`;
      return s;
    }),
  );
}
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
  /** Fires a line's cues; the story points this at its scene events. */
  onCue: (event: string) => void = () => {};
  /** How many of the current line's cues have fired. */
  private cued = 0;
  /** True while `hold` keeps you still. */
  private held = false;
  private typed = 0;
  private typer = 0;
  /** The current line split into plain text and keywords, and how many characters it shows. */
  private runs: Run[] = [];
  private length = 0;
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
  private readonly pcScreen = new PcScreen(document.body);
  private readonly laptopScreen = new LaptopScreen(document.body);
  private readonly townMap = new TownMap(document.body);
  private readonly book = new GrimoireBook(document.body);
  /** Growth creeping over the dialogue console; it spreads as the town goes wrong. */
  private readonly growth = new Overgrowth(document.querySelector<HTMLElement>("#dialogue .console")!);
  /** Cables that won't come out. */
  private readonly bound = new Set<Port>();

  constructor() {
    for (const set of Object.values(PORTRAITS)) [...(set.busts ?? []), set.sheet].forEach((src) => src && preload(src));
    for (const room of Object.values(ROOMS)) room.props.forEach((p) => p.card && preload(p.card));
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    $("panel-close").addEventListener("click", () => this.closePanel());
    $("laptop-close").addEventListener("click", () => this.closeLaptop());
    window.addEventListener("resize", () => {
      if (this.pcScreen.isOpen) this.pcScreen.resize();
      else if (this.laptopScreen.isOpen) this.laptopScreen.resize();
      else this.screen?.resize();
    });
  }

  /** Freezes you for a moment (the lights going out, say), then runs `then`. */
  hold(ms: number, then: () => void): void {
    this.held = true;
    window.setTimeout(() => {
      this.held = false;
      then();
    }, ms);
  }

  get busy(): boolean {
    return !!(this.held || this.current || this.choices || this.card || this.screen || this.panelOpen || this.townMap.isOpen || this.book.isOpen || apparitionPlaying());
  }

  /** Whether a terminal or the port panel has the keyboard. */
  get typing(): boolean {
    return !!(this.screen || this.panelOpen);
  }

  // ---- dialogue -------------------------------------------------------------

  say(lines: Line[], then?: () => void): void {
    // A scene can come out empty, when the script's #if skips all of it; carry straight on.
    if (!lines.length) return then?.();
    lines.forEach((l, i) => this.queue.push({ ...l, then: i === lines.length - 1 ? then : undefined }));
    if (!this.busy) this.showNext();
  }

  private showNext(): void {
    const next = this.queue.shift();
    audio.walkie(isWalter(next));
    if (!next) {
      audio.typing(false);
      $("dialogue").hidden = true;
      this.hideCloseUp();
      hideImage($("bust"));
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
    this.runs = parseLine(next.text);
    this.length = visibleLength(this.runs);
    this.setLights(next, this.runs);
    haunt($("ghost"));
    this.typed = 0;
    this.cued = 0;
    window.clearInterval(this.typer);
    this.typer = window.setInterval(() => {
      this.typed += 2;
      this.renderLine();
      if (this.typed >= this.length) window.clearInterval(this.typer);
    }, TYPE_MS);
    this.renderLine();
  }

  /** The town map: pick where to go from the places in `go`, or close it to stay put. */
  openTownMap(here: SiteId, go: Partial<Record<SiteId, () => void>>, opts: { haunted?: boolean } = {}): void {
    const done = () => {
      this.closedAt = performance.now();
      this.showNext();
    };
    const wrapped = Object.fromEntries(Object.entries(go).map(([id, fn]) => [id, () => (done(), fn!())]));
    this.townMap.open(here, wrapped, done, opts);
  }

  /** The grimoire, open on whatever tab it was last left on. */
  openBook(contents: BookContents, then?: () => void): void {
    this.book.open(contents, () => {
      this.closedAt = performance.now();
      then?.();
      if (!this.busy) this.showNext();
    });
  }

  /** How overgrown the dialogue console is, 0 to 1, easing there over `ms`. */
  overgrow(level: number, ms = 0): void {
    this.growth.grow(level, ms);
  }

  /**
   * Shows an illustrated close-up until the dialogue it goes with closes. With `gone`, the
   * picture holds for a moment, tears up like a bad TV signal, and comes back as `gone`.
   */
  showCloseUp(src: string, gone?: string): void {
    const img = $<HTMLImageElement>("closeup");
    this.stopGlitch();
    showImage(img, src);
    if (!gone) return;
    preload(gone);
    this.tear(img, src, gone, 1600);
  }

  /** Like a close-up that tears into `gone`, except it tears back after `holdMs`. You saw it. Probably. */
  glimpse(src: string, other: string, holdMs = 700): void {
    const img = $<HTMLImageElement>("closeup");
    this.stopGlitch();
    showImage(img, src);
    preload(other);
    this.tear(img, src, other, 1600, () => this.tear(img, other, src, holdMs));
  }

  /** After `ms`, if `from` is still showing, the close-up tears like a bad TV signal into `to`. */
  private tear(img: HTMLImageElement, from: string, to: string, ms: number, then?: () => void): void {
    const at = (ms: number, fn: () => void) => this.glitchTimers.push(window.setTimeout(fn, ms));
    at(ms, () => {
      if (img.dataset.src !== from) return;
      $("closeup-wrap").classList.add("glitch");
      audio.crackle(true);
      // Swap mid-tear, while the static hides it. It's preloaded, so it's ready to paint.
      at(450, () => {
        img.dataset.src = to;
        img.src = to;
      });
      at(800, () => {
        $("closeup-wrap").classList.remove("glitch");
        then?.();
      });
    });
  }

  hideCloseUp(): void {
    this.stopGlitch();
    hideImage($("closeup"));
  }

  private glitchTimers: number[] = [];
  private stopGlitch(): void {
    this.glitchTimers.forEach((t) => clearTimeout(t));
    this.glitchTimers = [];
    $("closeup-wrap").classList.remove("glitch");
  }

  private showPortrait(line: Line): void {
    const mood = line.mood ?? 0;
    const set = line.who ? PORTRAITS[line.who] : undefined;
    const bust = set?.busts?.[mood];
    const sheet = bust ? undefined : set?.sheet;
    $("frame").hidden = !bust && !sheet;
    const img = $<HTMLImageElement>("bust");
    if (bust) showImage(img, bust);
    else hideImage(img);
    const el = $("portrait");
    el.hidden = !sheet;
    if (!sheet) return;
    el.style.backgroundImage = `url(${sheet})`;
    el.style.backgroundPosition = `${mood * 50}% 0`;
  }

  private renderLine(): void {
    if (!this.current) return;
    renderRuns($("line"), this.runs, this.typed);
    const cues = this.current.cues ?? [];
    while (this.cued < cues.length && cues[this.cued].at <= this.typed) this.onCue(cues[this.cued++].event);
    const typing = this.typed < this.length;
    $("more").hidden = typing;
    $("dialogue").classList.toggle("typing", typing);
    audio.typing(typing);
  }

  /** The console's status lights: RX/TX blinks while text comes in, LINK/ERR for the radio and anything wrong. */
  private setLights(line: Line, runs: Run[]): void {
    const box = $("dialogue");
    box.classList.toggle("walkie", isWalter(line));
    box.classList.toggle("err", runs.some((r) => r.cls === "warn"));
  }

  private advance(): void {
    const c = this.current;
    if (!c) return;
    if (this.typed < this.length) {
      this.typed = this.length;
      window.clearInterval(this.typer);
      this.renderLine();
      return;
    }
    this.current = null;
    c.after?.forEach((event) => this.onCue(event));
    c.then?.();
    if (!this.current && !this.choices && !this.screen && !this.panelOpen) this.showNext();
    // Walter holds the channel open across his lines; whatever interrupts the talk closes it.
    else if (!this.choices) audio.walkie(isWalter(this.current ?? undefined));
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
    const runs = parseLine(prompt.text);
    renderRuns($("line"), runs);
    this.setLights(prompt, runs);
    $("dialogue").classList.remove("typing");
    haunt($("ghost"));
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
    hideImage($("bust"));
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
  attach(net: Network, devices: Device[], layout: Record<string, Point> = {}): void {
    this.net = net;
    const screen = $("laptop-screen");
    for (const d of devices) {
      const session = d instanceof IosDevice ? iosSession(d) : pcSession(d as Pc);
      const view = new TerminalView(d, session, screen);
      this.views.set(d, view);
      d.onOutput((text) => view.log(text));
    }
    this.laptopScreen.attach(net, layout, this.views, devices);
  }

  openLaptop(device: Device, title: string, hint: string, opts: { printer?: boolean } = {}): void {
    const view = this.views.get(device);
    if (!view) return;
    if (device instanceof IosDevice) {
      // Routers and switches: the B&B field laptop on the console cable, with a topology map.
      this.screen = view;
      this.laptopScreen.open(device, title, hint, () => {
        this.screen = null;
        this.closedAt = performance.now();
        (document.activeElement as HTMLElement | null)?.blur();
        this.showNext();
      });
      return;
    }
    if (device.kind === "pc") {
      // PCs get their own screen: Cryptis NetOS, with the terminal as its Command Prompt.
      this.screen = view;
      this.pcScreen.open(device as Pc, view, title, hint, () => {
        this.screen = null;
        this.closedAt = performance.now();
        (document.activeElement as HTMLElement | null)?.blur();
        this.showNext();
      }, opts);
      return;
    }
    $("laptop-title").textContent = title;
    $("laptop-hint").textContent = hint;
    $("laptop").hidden = false;
    this.screen = view;
    view.show();
  }

  closeLaptop(): void {
    if (!this.screen) return;
    if (this.pcScreen.isOpen) return this.pcScreen.close();
    if (this.laptopScreen.isOpen) return this.laptopScreen.close();
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
    if (p.peer && (this.bound.has(p) || this.bound.has(p.peer))) {
      this.flash("It won't come out. Something on the other end is holding on.");
      this.apparition();
      return;
    }
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

  /**
   * A line that statics into a device's terminal under the last output, flickers, and statics
   * back out, leaving nothing behind. `onPeak` runs while it's flickering; `onGone` runs once
   * it's gone (or straight away if the terminal is busy).
   */
  ghostLine(device: Device, text: string, onPeak: () => void, onGone: () => void): void {
    const view = this.views.get(device);
    if (!view?.insertAbove(staticOf(text, 0), (marker) => this.haunt(view.term, marker, text, onPeak, onGone))) onGone();
  }

  /** Plays a ghost line's static in, flicker and static out on the marked line. */
  private haunt(term: TerminalView["term"], marker: IMarker, text: string, onPeak: () => void, onGone: () => void): void {
    // Rewrites the marked line in place, as long as it's still on screen. The empty write waits
    // for anything already sent (the player's typing) to land, so the cursor is where it looks.
    const draw = (line: string | null) =>
      term.write("", () => {
        const buf = term.buffer.active;
        const up = buf.baseY + buf.cursorY - marker.line;
        if (marker.isDisposed || up <= 0 || up >= term.rows) return;
        // Save the cursor, go up, rewrite (or delete) the line, come back.
        if (line !== null) term.write(`\x1b7\x1b[${up}A\r\x1b[2K${line}\x1b8`);
        else term.write(`\x1b7\x1b[${up}A\x1b[M\x1b8\x1b[A`);
      });
    const steps: [number, () => void][] = [];
    let t = 0;
    const at = (ms: number, fn: () => void) => steps.push([(t += ms), fn]);
    // In: the static resolves into the line.
    for (const shown of [0.15, 0.35, 0.55, 0.75, 0.9, 1]) at(90, () => draw(staticOf(text, shown)));
    // Hold, with a couple of drop-outs and the lights going.
    at(900, () => draw(staticOf(text, 0.4)));
    at(80, () => draw(text));
    at(700, () => {
      onPeak();
      draw(staticOf(text, 0.2));
    });
    at(120, () => draw(text));
    // Out: back to static, then nothing.
    for (const shown of [0.7, 0.45, 0.2, 0]) at(600 / 4, () => draw(staticOf(text, shown)));
    at(120, () => {
      draw(null);
      term.write("", () => marker.dispose());
      onGone();
    });
    for (const [ms, fn] of steps) window.setTimeout(fn, ms);
  }

  /** Marks a cable that can't be pulled out: clicking either end gets the apparition instead. */
  bindCable(port: Port): void {
    this.bound.add(port);
  }

  /** Which stage of the being the apparition shows, 1 to 4. The story raises it job by job. */
  beingStage = 1;

  /** Static, and something in it. Input waits until it's over. */
  apparition(then?: () => void): void {
    crt.on("haunted");
    apparition(() => {
      // The screen doesn't snap back: the CRT look lingers while you walk around again.
      crt.fade(8000);
      this.closedAt = performance.now();
      then?.();
    }, this.beingStage);
  }

  /** Shows a message in place of the usual hint until the next click. */
  private flash(text: string): void {
    this.hintHeld = true;
    $("panel-hint").textContent = text;
  }

  // ---- keys -----------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const confirm = e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter";
    if (apparitionPlaying()) {
      // Nothing gets through while it's on screen.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.book.isOpen) {
      // The book has the keyboard; G closing it mustn't reach the game and open it again.
      if (this.book.key(e)) e.preventDefault();
      return;
    }
    if (this.townMap.isOpen) {
      if (this.townMap.driving && confirm) {
        e.preventDefault();
        this.townMap.skip();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.townMap.cancel();
      }
      return;
    }
    if (e.key === "Escape" && (this.screen || this.panelOpen)) {
      e.preventDefault();
      e.stopPropagation();
      if (this.pcScreen.isOpen && this.pcScreen.back()) return;
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
