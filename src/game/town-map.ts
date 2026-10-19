/**
 * The town map you get when you leave a building: Ant's map of Static Springs with a
 * clickable spot on every place. Places you can travel to right now light up; everything
 * else just tells you about itself. The map's own CLOSE MAP button (or Esc) keeps you put.
 */
export type SiteId =
  | "bobs" | "quikstop" | "laundromat" | "dentist" | "library" | "funeral" | "townhall"
  | "comm" | "hotel" | "church" | "school" | "dogpark" | "outskirts";

interface Site {
  id: SiteId;
  name: string;
  /** Position on the map image, as fractions of its width and height: left, top, right, bottom. */
  box: [number, number, number, number];
  /** What hovering it says when you can't go there. */
  note: string;
}

const SITES: Site[] = [
  { id: "bobs", name: "Bob's Bandwidth & Bloodletting", box: [0.452, 0.735, 0.54, 0.9], note: "Home base. The coffee is always warm." },
  { id: "quikstop", name: "Quik-Stop Forever · job 1", box: [0.58, 0.405, 0.79, 0.625], note: "Mrs. Finch's corner store." },
  { id: "laundromat", name: "24-Hour Laundromat · job 2", box: [0.205, 0.695, 0.35, 0.885], note: "No work order yet. The dryers are running anyway." },
  { id: "dentist", name: "Dentist Office · job 3", box: [0.457, 0.448, 0.573, 0.618], note: "No work order yet. Someone inside is still smiling." },
  { id: "library", name: "Library · job 4", box: [0.225, 0.408, 0.395, 0.618], note: "No work order yet. Every book is checked out to the same name." },
  { id: "funeral", name: "Funeral Home & Crematorium · job 5", box: [0.615, 0.68, 0.73, 0.86], note: "No work order yet. They'll call. They always do." },
  { id: "townhall", name: "Town Hall & Sheriff · job 6", box: [0.055, 0.385, 0.222, 0.627], note: "No work order yet. The flag is at half-mast. It always is." },
  { id: "comm", name: "The Comm · job 7", box: [0.54, 0.7, 0.615, 0.92], note: "No work order yet. The tower hums the same note as the fridges." },
  { id: "hotel", name: "The Void-View Hotel · job 9", box: [0.035, 0.66, 0.2, 0.93], note: "No work order yet. Vacancy: yes. Checkout: no." },
  { id: "church", name: "The Cultric Church & Graveyard", box: [0.135, 0.072, 0.385, 0.358], note: "The doors are chained from the inside." },
  { id: "school", name: "School", box: [0.445, 0.085, 0.66, 0.332], note: "Closed for the year. Which year, it doesn't say." },
  { id: "dogpark", name: "Dog Park & Forest", box: [0.683, 0.116, 0.97, 0.332], note: "The dogs are always there. Nobody has ever seen their owners." },
  { id: "outskirts", name: "The Outskirts", box: [0.735, 0.627, 0.885, 0.93], note: "The road to Bellwether. The sign says it's closed. The sign has always said that." },
];

// ---- the roads, for the van ---------------------------------------------------

/** Map fractions. The long east-west road and the main north-south road, and where they cross. */
const H_ROAD = 0.685;
const V_ROAD = 0.415;
/** Keep right: eastbound and westbound lanes, northbound and southbound lanes. */
const LANE = { east: 0.7, west: 0.672, north: 0.426, south: 0.404 };
/** The map is wider than tall; distances are measured in map widths. */
const ASPECT = 1005 / 1800;

type Pt = [number, number];

/**
 * Where each place meets the road: its lot or driveway (`door`), and the spot on the road
 * it turns in from. Most places sit on the east-west road; the north side is off the main road.
 */
const DRIVEWAYS: Record<SiteId, { door: Pt; road: "H" | "V"; at: number; via?: Pt[] }> = {
  bobs: { door: [0.49, 0.75], road: "H", at: 0.49 },
  quikstop: { door: [0.66, 0.615], road: "H", at: 0.66 },
  laundromat: { door: [0.27, 0.73], road: "H", at: 0.27 },
  dentist: { door: [0.505, 0.635], road: "H", at: 0.505 },
  library: { door: [0.32, 0.635], road: "H", at: 0.32 },
  funeral: { door: [0.665, 0.735], road: "H", at: 0.665 },
  townhall: { door: [0.14, 0.64], road: "H", at: 0.14 },
  comm: { door: [0.585, 0.745], road: "H", at: 0.585 },
  hotel: { door: [0.11, 0.735], road: "H", at: 0.11 },
  church: { door: [0.37, 0.31], road: "V", at: 0.31 },
  school: { door: [0.455, 0.31], road: "V", at: 0.31 },
  dogpark: { door: [0.455, 0.37], road: "V", at: 0.37 },
  // Out past the edge of town, the road bends south toward Bellwether.
  outskirts: { door: [0.8, 0.92], road: "H", at: 0.78, via: [[0.79, 0.8]] },
};

/** The route from one place to another along the roads, driving on the right. */
function route(from: SiteId, to: SiteId): Pt[] {
  const a = DRIVEWAYS[from];
  const b = DRIVEWAYS[to];
  const pts: Pt[] = [a.door];
  const onRoad = (road: "H" | "V", at: number, heading: number): Pt =>
    road === "H" ? [at, heading >= 0 ? LANE.east : LANE.west] : [heading >= 0 ? LANE.south : LANE.north, at];
  // Which way you'll drive along each road decides which lane you pull into.
  const crossing: Pt = [V_ROAD, H_ROAD];
  if (a.road === b.road) {
    const dir = Math.sign(b.at - a.at) || 1;
    pts.push(...(a.via ?? []).slice().reverse(), onRoad(a.road, a.at, dir), onRoad(b.road, b.at, dir), ...(b.via ?? []));
  } else {
    const dirA = a.road === "H" ? Math.sign(V_ROAD - a.at) : Math.sign(H_ROAD - a.at);
    const dirB = b.road === "H" ? Math.sign(b.at - V_ROAD) : Math.sign(b.at - H_ROAD);
    pts.push(...(a.via ?? []).slice().reverse(), onRoad(a.road, a.at, dirA), crossing, onRoad(b.road, b.at, dirB), ...(b.via ?? []));
  }
  pts.push(b.door);
  return pts;
}

const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], (q[1] - p[1]) * ASPECT);
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

/** The CLOSE MAP button painted into the bottom-right corner of the map. */
const CLOSE_BOX: [number, number, number, number] = [0.872, 0.945, 0.98, 0.99];

const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export class TownMap {
  readonly el: HTMLElement;
  private go: Partial<Record<SiteId, () => void>> = {};
  private onCancel: (() => void) | null = null;
  private here: SiteId | null = null;
  private haunted = false;
  /** Set while the van is driving; calling it skips to the end of the trip. */
  private finishDrive: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = h(`
      <div id="townmap" hidden>
        <div class="sheet">
          <img src="assets/ui/town-map.webp" alt="Map of Static Springs" />
          <div class="spots"></div>
          <div class="van follower" hidden><span class="beams"></span></div>
          <div class="van" hidden><span class="beams"></span><img alt="" /></div>
          <p class="caption"></p>
        </div>
      </div>
    `);
    parent.appendChild(this.el);
    const spots = this.el.querySelector(".spots")!;
    const place = (b: HTMLElement, [x0, y0, x1, y1]: number[]) => {
      b.style.left = `${x0 * 100}%`;
      b.style.top = `${y0 * 100}%`;
      b.style.width = `${(x1 - x0) * 100}%`;
      b.style.height = `${(y1 - y0) * 100}%`;
    };
    for (const site of SITES) {
      const b = document.createElement("button");
      b.className = "spot";
      b.dataset.site = site.id;
      b.setAttribute("aria-label", site.name);
      place(b, site.box);
      b.addEventListener("mouseenter", () => this.describe(site));
      b.addEventListener("focus", () => this.describe(site));
      b.addEventListener("click", () => this.pick(site));
      spots.appendChild(b);
    }
    const close = document.createElement("button");
    close.className = "spot close";
    close.setAttribute("aria-label", "Close map");
    place(close, CLOSE_BOX);
    close.addEventListener("click", () => this.cancel());
    spots.appendChild(close);
    // A click anywhere while the van drives skips the trip.
    this.el.addEventListener("click", () => this.finishDrive?.(), true);
  }

  get driving(): boolean {
    return !!this.finishDrive;
  }

  /** E, Space or a click: skip the rest of the drive. */
  skip(): void {
    this.finishDrive?.();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /**
   * Opens the map at `here`. `go` lists the places you can travel to now and what happens
   * when you pick one; `onCancel` runs if you close the map instead.
   */
  open(here: SiteId, go: Partial<Record<SiteId, () => void>>, onCancel: () => void, opts: { haunted?: boolean } = {}): void {
    this.here = here;
    this.haunted = !!opts.haunted;
    this.go = go;
    this.onCancel = onCancel;
    this.el.querySelectorAll<HTMLElement>(".spot[data-site]").forEach((b) => {
      const id = b.dataset.site as SiteId;
      b.classList.toggle("open", !!go[id]);
      b.classList.toggle("here", id === here);
    });
    const options = Object.keys(go);
    this.caption(options.length ? "Click where you're headed. Esc or CLOSE MAP to stay." : "Nowhere to be right now.");
    this.el.hidden = false;
  }

  cancel(): void {
    if (!this.isOpen || this.driving) return;
    this.el.hidden = true;
    const done = this.onCancel;
    this.onCancel = null;
    done?.();
  }

  private describe(site: Site): void {
    if (site.id === this.here) this.caption(`${site.name}. You are here.`);
    else if (this.go[site.id]) this.caption(`${site.name}. Click to go.`);
    else this.caption(`${site.name}. ${site.note}`);
  }

  private pick(site: Site): void {
    if (this.driving) return;
    const go = this.go[site.id];
    if (!go) return this.describe(site);
    this.onCancel = null;
    const arrive = () => {
      this.el.hidden = true;
      this.el.classList.remove("in-transit");
      this.el.querySelectorAll<HTMLElement>(".van").forEach((v) => (v.hidden = true));
      go();
    };
    if (!this.here) return arrive();
    this.drive(route(this.here, site.id), site.name, arrive);
  }

  // ---- the drive ------------------------------------------------------------

  /** Drives the van along `path`, then calls `done`. Skippable. */
  private drive(path: Pt[], name: string, done: () => void): void {
    const lengths = path.slice(1).map((p, i) => dist(path[i], p));
    const total = lengths.reduce((a, b) => a + b, 0);
    const ms = Math.min(3500, Math.max(1400, total * 7000));
    const van = this.el.querySelector<HTMLElement>(".van:not(.follower)")!;
    const follower = this.el.querySelector<HTMLElement>(".van.follower")!;
    van.querySelector("img")!.src = this.haunted ? "assets/ui/van-haunted.webp" : "assets/ui/van-normal.webp";
    // Now and then a trip goes a little wrong.
    const omen = Math.random();
    van.classList.toggle("flicker", omen < 0.25 || this.haunted);
    const followed = omen >= 0.25 && omen < 0.42;
    this.el.classList.add("in-transit");
    this.caption(followed ? `Driving to ${name}... someone's behind you.` : `Driving to ${name}...`);
    van.hidden = false;
    follower.hidden = !followed;

    let facing = path[path.length - 1][0] >= path[0][0] ? 1 : -1;
    const at = (d: number): { p: Pt; dx: number } => {
      let left = Math.max(0, Math.min(total, d));
      for (let i = 0; i < lengths.length; i++) {
        if (left <= lengths[i] || i === lengths.length - 1) {
          const t = lengths[i] ? Math.min(1, left / lengths[i]) : 1;
          const [a, b] = [path[i], path[i + 1]];
          return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dx: b[0] - a[0] };
        }
        left -= lengths[i];
      }
      return { p: path[path.length - 1], dx: 0 };
    };
    const place = (el: HTMLElement, p: Pt, face: number) => {
      el.style.left = `${p[0] * 100}%`;
      el.style.top = `${p[1] * 100}%`;
      // The van is drawn facing left; it keeps its last facing on the north-south road.
      el.style.setProperty("--face", String(face));
    };

    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const here = at(ease(t) * total);
      if (Math.abs(here.dx) > 1e-4) facing = here.dx > 0 ? 1 : -1;
      place(van, here.p, facing);
      if (followed) {
        // Its lights hang back behind you, then are simply gone.
        place(follower, at(ease(t) * total - 0.06).p, facing);
        follower.style.opacity = String(t < 0.15 || t > 0.8 ? 0 : 0.7);
      }
      if (t < 1) frame = requestAnimationFrame(step);
      else finish();
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      this.finishDrive = null;
      done();
    };
    this.finishDrive = finish;
    frame = requestAnimationFrame(step);
  }

  private caption(text: string): void {
    this.el.querySelector(".caption")!.textContent = text;
  }
}
