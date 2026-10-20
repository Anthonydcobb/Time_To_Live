/**
 * Roots, dead cables and moss creeping over the dialogue console, drawn as chunky pixels on a
 * canvas laid over its edges. How much has grown is a level from 0 (bare metal) to 1 (the
 * console half swallowed). Every piece has its own threshold and grows along its length as the
 * level passes it, so raising the level slowly looks like the growth crawling out.
 *
 * The layout comes from a fixed seed, so the same level always looks the same.
 */

/** How far the growth may spill past the console's edges, in CSS pixels. */
const PAD = 26;
/** CSS pixels per drawn pixel. */
const PX = 3;
/** Level it takes a piece to go from nothing to fully grown. */
const SPREAD = 0.18;

const ROOT = ["#1f1418", "#3a2329", "#563640"];
const CABLE = ["#18191b", "#2e3034", "#4c4f55"];
const MOSS = ["#3c461a", "#5b6a24", "#86983a"];
const WIRES = ["#c8463a", "#3a7ac8", "#d89a3a", "#c8c8c0"];

type Edge = "top" | "right" | "bottom" | "left";

/** Something crawling along the console's outline. */
interface Strand {
  kind: "root" | "cable";
  edge: Edge;
  /** Where on its edge it starts, 0..1, and how far round the outline it runs, 0..1. */
  t: number;
  length: number;
  width: number;
  wobble: number;
  phase: number;
  /** How far it bows away from the edge in the middle. */
  sag: number;
  frayed: boolean;
  /** Short shoots curling in over the metal: where along the strand, how long, which way. */
  shoots: { f: number; len: number; curl: number }[];
  at: number;
}

/** A cable hanging off the bottom edge: slung between two points, or one cut end dangling. */
interface Hang {
  a: number;
  b: number;
  drop: number;
  at: number;
}

interface Moss {
  edge: Edge;
  t: number;
  size: number;
  drips: number[];
  at: number;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(): { strands: Strand[]; hangs: Hang[]; moss: Moss[] } {
  const r = rng(1331);
  /** Mostly the top and right, where the concept's growth comes in. */
  const edge = (): Edge => (r() < 0.55 ? "top" : r() < 0.5 ? "right" : r() < 0.6 ? "bottom" : "left");
  const strands: Strand[] = [];
  for (let i = 0; i < 18; i++) {
    const cable = r() < 0.35;
    strands.push({
      kind: cable ? "cable" : "root",
      edge: edge(),
      t: r(),
      length: 0.08 + r() * 0.2,
      width: cable ? 2 : 2 + Math.round(r() * 2),
      wobble: 1 + r() * 3,
      phase: r() * 10,
      sag: cable ? 3 + r() * 6 : r() * 3,
      frayed: cable && r() < 0.6,
      shoots: cable ? [] : Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ f: r(), len: 4 + r() * 9, curl: r() < 0.5 ? -1 : 1 })),
      at: i < 2 ? 0 : r() * 0.85,
    });
  }
  const hangs: Hang[] = [];
  for (let i = 0; i < 5; i++) {
    const a = 0.05 + r() * 0.85;
    const slung = r() < 0.5;
    hangs.push({ a, b: slung ? Math.min(1, a + 0.06 + r() * 0.15) : a, drop: slung ? 4 + r() * 6 : 6 + r() * 9, at: 0.3 + r() * 0.65 });
  }
  const moss: Moss[] = [];
  for (let i = 0; i < 16; i++) {
    const e = edge();
    moss.push({
      edge: e,
      // Keep the top-right corner clear: the status lights live there.
      t: e === "top" ? r() * 0.8 : e === "right" ? 0.3 + r() * 0.7 : r(),
      size: 2 + r() * 4,
      drips: Array.from({ length: Math.floor(r() * 3) }, () => 2 + r() * 10),
      at: 0.15 + r() * 0.85,
    });
  }
  return { strands, hangs, moss };
}

export class Overgrowth {
  private readonly canvas = document.createElement("canvas");
  private readonly pieces = layout();
  private level = 0;
  private anim = 0;

  constructor(private readonly host: HTMLElement) {
    this.canvas.className = "growth";
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
    new ResizeObserver(() => this.draw()).observe(host);
  }

  /** Sets how overgrown the console is, easing there over `ms`. */
  grow(to: number, ms = 0): void {
    cancelAnimationFrame(this.anim);
    const from = this.level;
    const start = performance.now();
    const step = (now: number) => {
      const p = ms ? Math.min(1, (now - start) / ms) : 1;
      this.level = from + (to - from) * p;
      this.draw();
      if (p < 1) this.anim = requestAnimationFrame(step);
    };
    step(start);
  }

  private draw(): void {
    const w = this.host.offsetWidth;
    const h = this.host.offsetHeight;
    if (!w || !h) return;
    const cw = Math.ceil((w + 2 * PAD) / PX);
    const ch = Math.ceil((h + 2 * PAD) / PX);
    const c = this.canvas;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);

    // The console's outline in drawn pixels, walked clockwise from the top-left corner.
    const pad = PAD / PX;
    const bw = w / PX;
    const bh = h / PX;
    const perim = 2 * (bw + bh);
    const edgeStart: Record<Edge, number> = { top: 0, right: bw, bottom: bw + bh, left: 2 * bw + bh };
    const edgeLen: Record<Edge, number> = { top: bw, right: bh, bottom: bw, left: bh };
    /** A position on an edge as a fraction of the whole outline. */
    const onEdge = (e: Edge, t: number) => (edgeStart[e] + t * edgeLen[e]) / perim;
    /** A point on the outline, pushed `out` pixels outward (negative is in over the panel). */
    const at = (s: number, out: number): [number, number] => {
      let d = (((s % 1) + 1) % 1) * perim;
      if (d < bw) return [pad + d, pad - out];
      d -= bw;
      if (d < bh) return [pad + bw + out, pad + d];
      d -= bh;
      if (d < bw) return [pad + bw - d, pad + bh + out];
      d -= bw;
      return [pad - out, pad + bh - d];
    };
    // The status lights in the top-right corner stay readable: nothing grows in over them.
    const lightsX = pad + bw - 120 / PX;
    const lightsY = pad + 56 / PX;
    const dot = (x: number, y: number, size: number, colour: string) => {
      if (x > lightsX && x < pad + bw - 1 && y > pad + 1 && y < lightsY) return;
      ctx.fillStyle = colour;
      ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    };
    /** A shaded line of pixels: dark underside, body, and a fleck of highlight now and then. */
    const stroke = (pts: [number, number][], width: number, colours: string[]) => {
      pts.forEach(([x, y]) => dot(x, y + 1, width + 1, colours[0]));
      pts.forEach(([x, y], i) => {
        dot(x, y, width, colours[1]);
        if (i % 3 === 0) dot(x, y - Math.floor(width / 2), 1, colours[2]);
      });
    };
    const fray = ([x, y]: [number, number]) => WIRES.forEach((wc, k) => dot(x + (k - 1.5) * 1.5, y + 2 + (k % 2), 1, wc));
    const grown = (t: number) => Math.max(0, Math.min(1, (this.level - t) / SPREAD));

    for (const s of this.pieces.strands) {
      const g = grown(s.at);
      if (!g) continue;
      const start = onEdge(s.edge, s.t);
      const total = Math.max(1, s.length * perim);
      const steps = Math.ceil(total * g);
      const pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const along = i / total;
        const out = Math.sin(s.phase + (i / perim) * 90) * s.wobble + Math.sin(Math.PI * along) * s.sag;
        pts.push(at(start + i / perim, out));
      }
      stroke(pts, s.width, s.kind === "root" ? ROOT : CABLE);
      // Roots send shoots curling in over the metal once they've reached that far.
      for (const sh of s.shoots) {
        const i = Math.floor(sh.f * total);
        if (i >= pts.length) continue;
        const sg = Math.min(1, (pts.length - i) / 12);
        const n = Math.round(sh.len * sg);
        const shoot: [number, number][] = [];
        for (let j = 0; j <= n; j++) {
          const [x, y] = at(start + (i + j * 0.4 * sh.curl) / perim, -j * 0.8 + Math.sin(j * 0.7) * 1.2);
          shoot.push([x, y]);
        }
        stroke(shoot, 1, ROOT);
      }
      if (s.frayed && g === 1) fray(pts[pts.length - 1]);
    }

    // Cables hanging off the bottom: slung in a loop, or a cut end dangling.
    for (const hg of this.pieces.hangs) {
      const g = grown(hg.at);
      if (!g) continue;
      const pts: [number, number][] = [];
      if (hg.a === hg.b) {
        const [x, y] = at(onEdge("bottom", hg.a), 0);
        for (let j = 0; j <= Math.round(hg.drop * g); j++) pts.push([x + Math.sin(j * 0.5) * 0.8, y + j]);
        stroke(pts, 2, CABLE);
        if (g === 1) fray(pts[pts.length - 1]);
      } else {
        const a = onEdge("bottom", hg.a);
        const b = onEdge("bottom", hg.b);
        const n = Math.ceil(Math.abs(b - a) * perim * g);
        for (let j = 0; j <= n; j++) {
          const u = j / Math.max(1, Math.abs(b - a) * perim);
          pts.push(at(a + (b - a) * u, Math.sin(Math.PI * u) * hg.drop));
        }
        stroke(pts, 2, CABLE);
      }
    }

    for (const m of this.pieces.moss) {
      const g = grown(m.at);
      if (!g) continue;
      const [x, y] = at(onEdge(m.edge, m.t), 1);
      const size = Math.max(1, Math.round(m.size * g));
      for (let k = 0; k < size * 3; k++) {
        const a = (k / (size * 3)) * Math.PI * 2;
        const r = size * (0.5 + 0.5 * Math.abs(Math.sin(a * 3 + m.t * 40)));
        dot(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, 2, MOSS[k % 3 === 0 ? 2 : 1]);
      }
      dot(x, y, size, MOSS[0]);
      // Slime running down from it.
      for (const [k, len] of m.drips.entries()) {
        const dx = x + (k - 0.5) * size;
        const n = Math.round(len * g);
        for (let j = 0; j < n; j++) dot(dx, y + j, 1, MOSS[1]);
        if (n) dot(dx, y + n, 2, MOSS[2]);
      }
    }
  }
}
