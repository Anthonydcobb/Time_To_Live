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

  constructor(parent: HTMLElement) {
    this.el = h(`
      <div id="townmap" hidden>
        <div class="sheet">
          <img src="assets/ui/town-map.webp" alt="Map of Static Springs" />
          <div class="spots"></div>
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
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /**
   * Opens the map at `here`. `go` lists the places you can travel to now and what happens
   * when you pick one; `onCancel` runs if you close the map instead.
   */
  open(here: SiteId, go: Partial<Record<SiteId, () => void>>, onCancel: () => void): void {
    this.here = here;
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
    if (!this.isOpen) return;
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
    const go = this.go[site.id];
    if (!go) return this.describe(site);
    this.el.hidden = true;
    this.onCancel = null;
    go();
  }

  private caption(text: string): void {
    this.el.querySelector(".caption")!.textContent = text;
  }
}
