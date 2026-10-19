import { IosDevice } from "../sim/devices/ios-device";
import type { Device, Network } from "../sim/network";
import type { TerminalView } from "../web/terminal";
import { TopologyView, type Point } from "../web/topology";

/**
 * The B&B field laptop you plug into a rack's console port: a quieter cousin of the PC's
 * Cryptis NetOS screen. Two tabs, the console and a live topology map (the bench page's
 * diagram). Click a router or switch on the map to move the console to it.
 */
type Tab = "console" | "topology";

/** Where devices the job didn't place go on the map. The phantom PC sits beside S1. */
const EXTRA_LAYOUT: Record<string, Point> = { PHANTOM: { x: 700, y: 245 } };

const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export class LaptopScreen {
  readonly el: HTMLElement;
  private net: Network | null = null;
  private layout: Record<string, Point> = {};
  private views = new Map<Device, TerminalView>();
  /** Devices that are always on the map; anything else shows up once it's cabled in. */
  private known: Device[] = [];
  private device: IosDevice | null = null;
  private view: TerminalView | null = null;
  private viewHome: HTMLElement | null = null;
  private tab: Tab = "console";
  private topology: TopologyView | null = null;
  private signature = "";
  private refresher = 0;
  private timers: number[] = [];
  private onClosed: (() => void) | null = null;
  private hint = "";

  constructor(parent: HTMLElement) {
    this.el = h(`
      <div id="fieldkit" hidden>
        <div class="laptop">
          <div class="lid">
            <span class="cam"></span>
            <div class="lcd">
              <div class="wake">
                <img src="assets/ui/cryptis-sigil.png" alt="" />
                <span>CRYPTIS TERMLINK 2.1</span>
              </div>
              <div class="ui">
                <header>
                  <span class="title"></span>
                  <nav>
                    <button data-tab="console">CONSOLE</button>
                    <button data-tab="topology">TOPOLOGY</button>
                  </nav>
                </header>
                <section data-pane="console"><div class="term-slot"></div></section>
                <section data-pane="topology" hidden><div class="map"></div><p class="legend">● green: forwarding · ● amber: listening/learning · ● red: no link · click a router or switch to console into it</p></section>
                <footer></footer>
              </div>
              <div class="tear"></div>
            </div>
          </div>
          <div class="deck">
            <span class="sticker">B&amp;B FIELD KIT · ASSET 0013</span>
            <div class="keys"></div>
            <div class="pad"></div>
          </div>
        </div>
      </div>
    `);
    parent.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest("[data-tab]")?.getAttribute("data-tab") as Tab | null;
      if (tab) this.show(tab);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** The job's network and terminals, so the map and the device switching work. */
  attach(net: Network, layout: Record<string, Point>, views: Map<Device, TerminalView>, known: Device[]): void {
    this.net = net;
    this.layout = { ...EXTRA_LAYOUT, ...layout };
    this.views = views;
    this.known = known;
  }

  open(device: IosDevice, title: string, hint: string, onClosed: () => void): void {
    this.onClosed = onClosed;
    this.hint = hint;
    this.el.hidden = false;
    this.el.classList.remove("closing", "awake");
    this.el.classList.add("waking");
    this.useDevice(device, title);
    this.show("console");
    this.signature = "";
    this.refresh();
    this.refresher = window.setInterval(() => this.refresh(), 250);
    this.later(() => {
      this.el.classList.remove("waking");
      this.el.classList.add("awake");
      if (this.tab === "console") this.view?.show();
    }, 900);
  }

  close(): void {
    if (!this.isOpen) return;
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    window.clearInterval(this.refresher);
    this.view?.hide();
    this.el.classList.add("closing");
    this.later(() => {
      this.el.hidden = true;
      this.el.classList.remove("closing", "awake", "waking");
      this.release();
      const done = this.onClosed;
      this.onClosed = null;
      done?.();
    }, 260);
  }

  resize(): void {
    if (this.tab === "console") this.view?.resize();
  }

  // ---- console --------------------------------------------------------------

  private useDevice(device: IosDevice, title?: string): void {
    const view = this.views.get(device);
    if (!view) return;
    this.release();
    this.device = device;
    this.view = view;
    this.viewHome = view.el.parentElement;
    this.el.querySelector(".term-slot")!.appendChild(view.el);
    view.term.options.theme = { background: "#0b1014", foreground: "#c9d6cf", cursor: "#ffb000", selectionBackground: "#2a3a40" };
    this.el.querySelector(".title")!.textContent = title ?? `${device.hostname} · ${device.model} · console`;
    this.topology?.select(device);
  }

  /** Puts the borrowed terminal back where it lives. */
  private release(): void {
    if (this.view && this.viewHome) {
      this.view.hide();
      this.viewHome.appendChild(this.view.el);
    }
    this.view = null;
    this.viewHome = null;
  }

  private show(tab: Tab): void {
    this.tab = tab;
    this.el.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
    this.el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    this.el.querySelector("footer")!.textContent = tab === "console" ? this.hint : "The map follows the cables as you plug them in. Esc closes the laptop.";
    if (tab === "console" && !this.el.classList.contains("waking")) this.view?.show();
    else this.view?.hide();
    if (tab === "topology") this.refresh();
  }

  // ---- topology -------------------------------------------------------------

  private onMap(): Device[] {
    const net = this.net;
    if (!net) return [];
    const cabled = (d: Device) => d.ports.some((p) => p.kind === "ethernet" && p.peer);
    return net.devices.filter((d) => this.known.includes(d) || cabled(d));
  }

  /** Rebuilds the map when the cabling changes, otherwise just refreshes its lights. */
  private refresh(): void {
    if (!this.net || this.tab !== "topology") return;
    const devices = this.onMap();
    const sig = devices
      .flatMap((d) => [d.id, ...d.ports.filter((p) => p.kind === "ethernet" && p.peer).map((p) => `${d.id}:${p.shortName}>${p.peer!.device.id}:${p.peer!.shortName}`)])
      .join("|");
    if (sig !== this.signature || !this.topology) {
      this.signature = sig;
      const map = this.el.querySelector<HTMLElement>(".map")!;
      map.replaceChildren();
      // The diagram only reads `devices`, so a filtered view of the network keeps the phantom hidden until it plugs in.
      this.topology = new TopologyView({ devices } as Network, this.layout, map, (d) => this.pick(d));
      if (this.device) this.topology.select(this.device);
    } else {
      this.topology.draw();
    }
  }

  private pick(d: Device): void {
    if (d instanceof IosDevice && this.views.has(d)) {
      this.useDevice(d);
      this.show("console");
    } else {
      this.el.querySelector("footer")!.textContent = d.hostname === "?" ? "THAT ISN'T ONE OF OURS." : "PCs are set up at their own screen, not over the console.";
    }
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
}
