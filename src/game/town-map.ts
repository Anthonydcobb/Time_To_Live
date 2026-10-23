/**
 * The town map you get when you leave a building: Ant's foggy seaside map of Static Springs
 * with a clickable spot on every place. Places you can travel to right now light up;
 * everything else just tells you about itself. The CLOSE MAP button (over the map's painted
 * key) or Esc keeps you put.
 */
export type SiteId =
  | "bobs" | "quikstop" | "laundromat" | "dentist" | "library" | "funeral" | "crematorium" | "townhall"
  | "hospital" | "radio" | "hotel" | "garage" | "docks" | "tunnel";

interface Site {
  id: SiteId;
  name: string;
  /** Position on the map image, as fractions of its width and height: left, top, right, bottom. */
  box: [number, number, number, number];
  /** What hovering it says when you can't go there. */
  note: string;
}

const SITES: Site[] = [
  { id: "bobs", name: "Bob's Bandwidth & Bloodletting", box: [0.29, 0.495, 0.396, 0.665], note: "Home base. The coffee is always warm." },
  { id: "laundromat", name: "Spin Cycle Eternal · job 2", box: [0.396, 0.48, 0.477, 0.64], note: "No work order yet. The dryers are running anyway." },
  { id: "quikstop", name: "Quik-Stop Forever · job 1", box: [0.477, 0.455, 0.57, 0.6], note: "Mrs. Finch's corner store." },
  { id: "dentist", name: "Dentist's Office · job 3", box: [0.57, 0.46, 0.627, 0.56], note: "No work order yet. Someone inside is still smiling." },
  { id: "tunnel", name: "The Tunnel", box: [0.632, 0.45, 0.69, 0.545], note: "The road to Bellwether. The sign says it's closed. The sign has always said that." },
  { id: "townhall", name: "Town Hall & Sheriff · job 6", box: [0.207, 0.3, 0.316, 0.45], note: "No work order yet. The flag is at half-mast. It always is." },
  { id: "library", name: "Library · job 4", box: [0.323, 0.285, 0.405, 0.42], note: "No work order yet. Every book is checked out to the same name." },
  { id: "hospital", name: "Hospital · job 8", box: [0.31, 0.175, 0.41, 0.28], note: "No work order yet. Visiting hours ended in 1974." },
  { id: "garage", name: "The Old Garage", box: [0.428, 0.195, 0.48, 0.282], note: "The bay door is shut. It's warm to the touch." },
  { id: "funeral", name: "Funeral Home · job 5", box: [0.14, 0.1, 0.29, 0.29], note: "No work order yet. They'll call. They always do." },
  { id: "crematorium", name: "Crematorium · job 5", box: [0.1, 0.73, 0.23, 0.86], note: "The other half of the funeral home's job. The fog doesn't go in." },
  { id: "hotel", name: "The Void-View Hotel · job 9", box: [0.56, 0.15, 0.695, 0.355], note: "No work order yet. Vacancy: yes. Checkout: no." },
  { id: "radio", name: "Radio Station & Lighthouse · job 7", box: [0.712, 0.11, 0.79, 0.37], note: "No work order yet. The beam sweeps the sea for something. The tower hums the same note as the fridges." },
  { id: "docks", name: "The Docks", box: [0.26, 0.69, 0.57, 0.9], note: "The boats come back. Not always with the same people." },
];

/** The CLOSE MAP button, laid over the key painted in the bottom-right corner of the map. */
const CLOSE_BOX: [number, number, number, number] = [0.853, 0.762, 0.97, 0.945];

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
    close.innerHTML = "CLOSE MAP<small>Esc</small>";
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

  /** Picking a place closes the map; the trip itself is a loading screen (Story.travel). */
  private pick(site: Site): void {
    const go = this.go[site.id];
    if (!go) return this.describe(site);
    this.onCancel = null;
    this.el.hidden = true;
    go();
  }

  private caption(text: string): void {
    this.el.querySelector(".caption")!.textContent = text;
  }
}
