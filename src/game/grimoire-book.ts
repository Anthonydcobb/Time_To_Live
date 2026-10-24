/**
 * The grimoire as a book you can open (G): a two-page spread with four tabs. Incantations are
 * worked examples of each job's commands, written as rituals. Found Notes is every note you've
 * read, pinned in. Topology is a sketch of each site's network that fills in as you build it.
 * Site Logs is a page per finished job, and what was wrong there.
 *
 * The book only draws what it's given; the story decides what's in it (`BookContents`).
 */
import { formatIpv4 } from "../sim/addr";
import { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import type { Device, Network } from "../sim/network";
import type { Point } from "../web/topology";

export interface Note {
  /** How it looks pinned in: a sticky note, a scrap of paper, an index card or a Polaroid. */
  kind: "sticky" | "scrap" | "card" | "polaroid";
  /** Where you found it. */
  from: string;
  text: string;
}

/** Every note there is to find. The story adds one by id when you read it. */
export const NOTES: Record<string, Note> = {
  "bob-sticky": { kind: "sticky", from: "Bob's monitor", text: "At the Cryptis quarterly. Sell the upgrade. Everybody needs the upgrade. -B" },
  "bellwether": { kind: "card", from: "A drawer label, Bob's office", text: "BELLWETHER\n(the drawer is empty)" },
  "wo1-pen": { kind: "scrap", from: "Work order #0001, in pen", text: "Do not restock the back cooler." },
  "finch-calendar": { kind: "scrap", from: "Quik-Stop back office", text: "Desk calendar, October 1987. Every day crossed off, even the ones that haven't happened." },
  "wo2-pen": { kind: "scrap", from: "Work order #0002, in pen", text: "Dryer 4 is not a customer." },
  "gus-log": { kind: "card", from: "Gus's shift log, newest entry", text: "DRYER 4 WON'T STOP ASKING FOR AN ADDRESS.\n0.0.0.0" },
  "lostfound": { kind: "polaroid", from: "Lost & found, Spin Cycle Eternal", text: "this room. from inside." },
  "guestbook": { kind: "scrap", from: "Restroom guest book", text: "Gus. Gus. Gus. Gus. Gus. Gus. Gus. Gus. Gus. Gus." },
  "wo3-pen": { kind: "scrap", from: "Work order #0003, in pen", text: "Front desk and X-ray never share a network. Dr. Marrow was very clear." },
  "den-book": { kind: "card", from: "Appointment book, Marrow Family Dentistry", text: "Every slot after 6 PM is full.\nEvery name is in the same handwriting.\nThe last one is yours." },
  "den-jars": { kind: "card", from: "Shelf label, the packing room", text: "SPARES. SORTED BY OWNER.\nDO NOT MIX." },
  "den-crates": { kind: "scrap", from: "Shipping label, the packing room", text: "QUIK-STOP FOREVER. ATTN: MRS. FINCH. FRAGILE. KEEP COOL." },
};

interface Ritual {
  /** The work order that teaches it. It's written in once you take that job. */
  job: string;
  name: string;
  what: string;
  lines: string[];
  margin: string;
}

const RITUALS: Ritual[] = [
  {
    job: "0001",
    name: "Rite of Naming",
    what: "hostname, secrets and the console",
    lines: ["enable", "configure terminal", "hostname R1", "enable secret ********", "line console 0", " password ********", " login"],
    margin: "A thing with no name answers to anyone. Name it, then lock the door behind you.",
  },
  {
    job: "0001",
    name: "Rite of Awakening",
    what: "an address on an interface",
    lines: ["interface gi0/0", " ip address 192.168.1.1 255.255.255.0", " no shutdown"],
    margin: "Every port is born asleep. Two negatives wake it. Do not ask why.",
  },
  {
    job: "0001",
    name: "Rite of Remembering",
    what: "saving the configuration",
    lines: ["copy running-config startup-config"],
    margin: "Running is what it thinks. Startup is what it remembers. Make it remember you.",
  },
  {
    job: "0001",
    name: "Binding a Vessel",
    what: "a fixed address on a PC",
    lines: ["C:\\> ipconfig 192.168.1.10 255.255.255.0 192.168.1.1"],
    margin: "Address, mask, gateway. The gateway is the way out. Choose it carefully.",
  },
  {
    job: "0001",
    name: "Divination of Links",
    what: "is anything listening?",
    lines: ["show ip interface brief", "C:\\> ping 192.168.1.1"],
    margin: "If the first ping falls, that is ARP finding its way. If they all fall, something is in the way.",
  },
  {
    job: "0002",
    name: "Fencing the Low Names",
    what: "addresses DHCP must never give away",
    lines: ["ip dhcp excluded-address 192.168.20.1 192.168.20.20"],
    margin: "Keep the low numbers for things that must stay where they are put.",
  },
  {
    job: "0002",
    name: "Summoning the Pool of Names",
    what: "DHCP on the router",
    lines: ["ip dhcp pool LAUNDRY", " network 192.168.20.0 255.255.255.0", " default-router 192.168.20.1"],
    margin: "Once the pool is open, anything that asks is answered. Anything.",
  },
  {
    job: "0002",
    name: "Asking for a Name",
    what: "a PC asks for a lease",
    lines: ["C:\\> ipconfig /renew", "C:\\> ipconfig"],
    margin: "A PC that asked once and was ignored will sulk until you make it ask again.",
  },
  {
    job: "0002",
    name: "Reading the Ledger",
    what: "who holds a lease",
    lines: ["show ip dhcp binding"],
    margin: "Count the leases. Count them again. There is never a lease for .0.",
  },
  {
    job: "0003",
    name: "Dividing the House",
    what: "VLANs on a switch",
    lines: ["vlan 10", " name STAFF", "vlan 20", " name XRAY", "interface fa0/3", " switchport mode access", " switchport access vlan 20"],
    margin: "One switch, two houses. What lives in one cannot hear the other. It can still feel it through the wall.",
  },
  {
    job: "0003",
    name: "The Carrying Line",
    what: "a trunk",
    lines: ["interface gi0/1", " switchport mode trunk", "show interfaces trunk"],
    margin: "A trunk carries every house at once, each frame marked with where it belongs. Check the marks.",
  },
  {
    job: "0003",
    name: "The Router on a Stick",
    what: "subinterfaces, one per VLAN",
    lines: ["interface gi0/0.20", " encapsulation dot1Q 20", " ip address 192.168.20.1 255.255.255.0"],
    margin: "One cable, many doors. The router stands at every one of them and lets the houses speak.",
  },
  {
    job: "0003",
    name: "Counting the Houses",
    what: "which VLANs exist",
    lines: ["show vlan brief"],
    margin: "Count the houses. You built two. The defaults are always there. There should be nothing else.",
  },
];

/** What happened on each job, for its page in the site logs. */
const LOGS: Record<string, { did: string; odd: string }> = {
  "0001": {
    did: "Cabled the rack. Named R1 and S1, locked their consoles, woke Gi0/0, saved both. Register at .10, back office at .11. Every ping answered.",
    odd: "Fa0/24 came up on its own after the job was done. Nothing is plugged into Fa0/24. The sign on the way home said 4,219.",
  },
  "0002": {
    did: "Woke Gi0/0, fenced off .1 to .20, opened a pool. The printer holds .5. The kiosk and office PC asked and were answered.",
    odd: "show ip dhcp binding listed a third lease for a few seconds: 192.168.20.0, a dryer's MAC, expiring Oct 14 1974. You can't lease .0.",
  },
  "0003": {
    did: "Made VLAN 10 (STAFF) and VLAN 20 (XRAY), trunked S1 to R1, gave R1 a subinterface and a pool for each. The front desk pinged the X-ray through the router.",
    odd: "show vlan brief listed VLAN 1974 for a few seconds: active, no ports, and nobody made it. Then the packing room door was open.",
  },
};

/** A job's site, as far as the book cares: its network and where its gear sits. */
export interface Site {
  number: string;
  name: string;
  net: Network;
  layout: Record<string, Point>;
  devices: Device[];
  done: boolean;
}

export interface BookContents {
  /** Ids into NOTES, in the order you found them. */
  notes: string[];
  /** Every job you've taken, oldest first. */
  sites: Site[];
}

const TABS = ["Incantations", "Found Notes", "Topology", "Site Logs"] as const;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A fixed wobble for each pen stroke, so the sketch doesn't change every time you open it. */
function wobble(seed: string): number {
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) | 0;
  return ((n >>> 0) % 1000) / 1000 - 0.5;
}

export class GrimoireBook {
  readonly el: HTMLElement;
  private tab = 0;
  private spread = 0;
  private pages: HTMLElement[][] = [];
  private contents: BookContents = { notes: [], sites: [] };
  private onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = h(`
      <div id="grimoire" hidden>
        <div class="book">
          <div class="page left"></div>
          <div class="page right"></div>
          <div class="page measure" aria-hidden="true"></div>
          <nav class="tabs"></nav>
        </div>
        <p class="book-keys"><kbd>←</kbd> <kbd>→</kbd> turn the page · <kbd>1</kbd>–<kbd>4</kbd> tabs · <kbd>Esc</kbd> close</p>
      </div>
    `);
    parent.appendChild(this.el);
    const nav = this.el.querySelector(".tabs")!;
    TABS.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.addEventListener("click", () => this.show(i));
      nav.appendChild(b);
    });
    this.el.querySelector(".page.left")!.addEventListener("click", () => this.turn(-1));
    this.el.querySelector(".page.right")!.addEventListener("click", () => this.turn(1));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(contents: BookContents, onClose: () => void): void {
    this.contents = contents;
    this.onClose = onClose;
    this.el.hidden = false;
    this.show(this.tab);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  /** Keys while the book is open. Returns true if it used the key. */
  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" || e.key === "g" || e.key === "G") this.close();
    else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.turn(-1);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.turn(1);
    else if (e.key >= "1" && e.key <= String(TABS.length)) this.show(Number(e.key) - 1);
    else return false;
    return true;
  }

  private show(tab: number): void {
    this.tab = tab;
    this.spread = 0;
    this.el.querySelectorAll(".tabs button").forEach((b, i) => b.classList.toggle("on", i === tab));
    const items = [this.renderIncantations, this.renderNotes, this.renderTopology, this.renderLogs][tab].call(this);
    this.pages = this.paginate(items);
    this.draw();
  }

  private turn(by: number): void {
    const last = Math.max(0, Math.ceil(this.pages.length / 2) - 1);
    const next = Math.min(last, Math.max(0, this.spread + by));
    if (next === this.spread) return;
    this.spread = next;
    this.draw();
  }

  private draw(): void {
    const kind = ["rituals", "notes", "sketches", "logs"][this.tab];
    const fill = (side: "left" | "right", i: number) => {
      const page = this.el.querySelector<HTMLElement>(`.page.${side}`)!;
      page.className = `page ${side} ${kind}`;
      page.replaceChildren(...(this.pages[i] ?? []));
      const folio = document.createElement("span");
      folio.className = "folio";
      folio.textContent = this.pages[i] ? String(i + 1) : "";
      page.appendChild(folio);
      page.classList.toggle("can-turn", side === "left" ? this.spread > 0 : i + 1 < this.pages.length);
    };
    fill("left", this.spread * 2);
    fill("right", this.spread * 2 + 1);
  }

  /** Lays items out page by page, starting a new page whenever the next one doesn't fit. */
  private paginate(items: HTMLElement[]): HTMLElement[][] {
    const measure = this.el.querySelector<HTMLElement>(".page.measure")!;
    measure.className = `page measure ${["rituals", "notes", "sketches", "logs"][this.tab]}`;
    measure.replaceChildren();
    const pages: HTMLElement[][] = [[]];
    for (const item of items) {
      measure.appendChild(item);
      if (measure.scrollHeight > measure.clientHeight + 1 && measure.childElementCount > 1) {
        pages.push([]);
        measure.replaceChildren(item);
      }
      pages[pages.length - 1].push(item);
    }
    measure.replaceChildren();
    return pages;
  }

  private blank(text: string): HTMLElement[] {
    return [h(`<p class="blank">${esc(text)}</p>`)];
  }

  private renderIncantations(): HTMLElement[] {
    const taken = new Set(this.contents.sites.map((s) => s.number));
    const rituals = RITUALS.filter((r) => taken.has(r.job));
    if (!rituals.length) return this.blank("The pages are blank, and slightly warm.");
    return [
      h(`<header><h2>Cryptis Incantations</h2><p>IOS rituals, as they were taught</p></header>`),
      ...rituals.map((r, i) =>
        h(`
          <section class="ritual">
            <h3>Ritual ${ROMAN[i]} · ${esc(r.name)}</h3>
            <p class="what">${esc(r.what)}</p>
            <div class="rite">
              <pre>${r.lines.map(esc).join("\n")}</pre>
              <p class="margin">${esc(r.margin)}</p>
            </div>
          </section>
        `),
      ),
    ];
  }

  private renderNotes(): HTMLElement[] {
    const notes = this.contents.notes.map((id) => NOTES[id]).filter(Boolean);
    if (!notes.length) return this.blank("Nothing pinned here yet. Read what people leave lying around.");
    return [
      h(`<header><h2>Collected Notes &amp; Scraps</h2></header>`),
      ...notes.map((n, i) =>
        h(`
          <figure class="note ${n.kind}" style="--tilt: ${(wobble(n.from) * 5).toFixed(1)}deg; --nudge: ${i % 2 ? 6 : 0}px">
            ${n.kind === "polaroid" ? `<div class="snap"></div>` : ""}
            <p>${esc(n.text).replace(/\n/g, "<br>")}</p>
            <figcaption>${esc(n.from)}</figcaption>
          </figure>
        `),
      ),
    ];
  }

  private renderTopology(): HTMLElement[] {
    if (!this.contents.sites.length) return this.blank("No sites yet.");
    return this.contents.sites.map((s) => {
      const box = h(`<section class="sketch"><h3>${esc(s.name)}</h3></section>`);
      box.insertAdjacentHTML("beforeend", sketch(s));
      return box;
    });
  }

  private renderLogs(): HTMLElement[] {
    const done = this.contents.sites.filter((s) => s.done && LOGS[s.number]);
    if (!done.length) return this.blank("No jobs finished yet.");
    return done.map((s) =>
      h(`
        <section class="log">
          <h3>Site log · work order #${s.number}</h3>
          <p class="client">${esc(s.name)}</p>
          <p>${esc(LOGS[s.number].did)}</p>
          <p class="odd">${esc(LOGS[s.number].odd)}</p>
          <p class="stamp">CLOSED</p>
        </section>
      `),
    );
  }
}

/** A device's address as the sketch writes it, or nothing if it hasn't got one. */
function addressOf(d: Device): string {
  if (d instanceof IosDevice) {
    const ip = d.managementAddress();
    return ip == null ? "" : formatIpv4(ip);
  }
  const ip = (d as Pc).ip;
  return ip == null ? "" : formatIpv4(ip);
}

/** A pen stroke from a to b that bows a little, drawn twice like a quick sketch. */
function stroke(a: Point, b: Point, seed: string, cls: string): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const bow = wobble(seed) * 16;
  const cx = mx + ((a.y - b.y) / len) * bow;
  const cy = my + ((b.x - a.x) / len) * bow;
  const again = wobble(seed + "'") * 3;
  return `<path class="${cls}" d="M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}"/><path class="${cls} ghost" d="M${a.x + again} ${a.y - again} Q${cx + again} ${cy} ${b.x - again} ${b.y + again}"/>`;
}

function icon(d: Device): string {
  switch (d.kind) {
    case "router":
      return `<circle r="22"/><path d="M-11 -4 L11 -4 M5 -9 L11 -4 L5 1 M11 4 L-11 4 M-5 -1 L-11 4 L-5 9"/>`;
    case "switch":
      return `<rect x="-30" y="-15" width="60" height="30" rx="3"/><path d="M-16 -5 L16 -5 M10 -10 L16 -5 L10 0 M16 5 L-16 5 M-10 0 L-16 5 L-10 10"/>`;
    default:
      return d.id === "PRN"
        ? `<rect x="-20" y="-12" width="40" height="22" rx="2"/><path d="M-12 -12 L-12 -22 L12 -22 L12 -12 M-12 4 L12 4"/>`
        : `<rect x="-20" y="-18" width="40" height="27" rx="2"/><path d="M-5 9 L-7 16 L7 16 L5 9"/>`;
  }
}

/**
 * A pen sketch of a site's network: every piece of gear where the job's layout puts it, in
 * pencil until it has an address, and a line for every cable that's plugged in. A cable to
 * something that isn't on the job's list runs off the edge of the page.
 */
function sketch(site: Site): string {
  const at = (d: Device) => site.layout[d.id];
  const known = new Set(site.devices.filter(at));
  // Fit the drawing to the gear, with room for icons and labels round the edge.
  const xs = [...known].map((d) => at(d).x);
  const ys = [...known].map((d) => at(d).y);
  const [left, right, top, bottom] = [Math.min(...xs) - 90, Math.max(...xs) + 90, Math.min(...ys) - 40, Math.max(...ys) + 70];
  const parts: string[] = [];
  const seen = new Set<unknown>();
  for (const d of known) {
    for (const p of d.ports) {
      if (p.kind !== "ethernet" || !p.peer || seen.has(p)) continue;
      seen.add(p).add(p.peer);
      const a = at(d);
      const other = p.peer.device;
      if (known.has(other)) {
        parts.push(stroke(a, at(other), p.name + other.id, "cable"));
        continue;
      }
      // Something the job doesn't know about. The pen goes off the page toward it.
      const out = { x: right + 60, y: a.y + 40 };
      parts.push(stroke(a, out, p.name, "cable stray"));
      parts.push(`<text class="stray" x="${out.x - 70}" y="${out.y - 22}">${esc(p.shortName)} → ?</text>`);
    }
  }
  for (const d of known) {
    const { x, y } = at(d);
    const addr = addressOf(d);
    parts.push(`
      <g class="node ${addr ? "inked" : "pencil"}" transform="translate(${x} ${y})">
        ${icon(d)}
        <text class="name" y="38">${esc(d.hostname)}</text>
        <text class="addr" y="54">${addr ? esc(addr) : "?"}</text>
      </g>`);
  }
  return `<svg viewBox="${left} ${top} ${right - left} ${bottom - top}" role="img" aria-label="Sketch of ${esc(site.name)}'s network">${parts.join("")}</svg>`;
}

/** A short line by the corner when something new goes into the book. */
export function bookToast(text: string): void {
  document.getElementById("grimoire-toast")?.remove();
  const p = document.createElement("p");
  p.id = "grimoire-toast";
  p.textContent = text;
  document.body.appendChild(p);
  window.setTimeout(() => p.remove(), 3500);
}
