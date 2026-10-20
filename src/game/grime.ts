/**
 * Wear and tear for pictures: a ragged edge to cut them out with, and a layer of scratches,
 * specks and stains to lay over them. Both are drawn once at startup and handed to CSS as
 * `--rough-edge` (a mask) and `--scratches` (an overlay), so any picture can use them.
 */

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A white rectangle whose edges are chipped and torn, for `mask-image`. */
function roughEdge(): string {
  const r = rng(77);
  const w = 600;
  const h = 600;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const pts: [number, number][] = [];
  /** How far in from the edge at this step: small jitter, with the odd deep chip. */
  const bite = () => 3 + r() * 5 + (r() < 0.06 ? 6 + r() * 12 : 0);
  for (let x = 0; x < w; x += 5) pts.push([x, bite()]);
  for (let y = 0; y < h; y += 5) pts.push([w - bite(), y]);
  for (let x = w; x > 0; x -= 5) pts.push([x, h - bite()]);
  for (let y = h; y > 0; y -= 5) pts.push([bite(), y]);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  return c.toDataURL();
}

/** Thin scratches, dust specks and a couple of stains on a transparent sheet. */
function scratches(): string {
  const r = rng(4242);
  const s = 512;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 3; i++) {
    const g = ctx.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, 60 + r() * 90);
    g.addColorStop(0, "rgba(40,24,16,0.22)");
    g.addColorStop(1, "rgba(40,24,16,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * s;
    const y = r() * s;
    const len = 10 + r() * 90;
    // Mostly up and down, like something dragged across it.
    const a = Math.PI / 2 + (r() - 0.5) * 0.9;
    ctx.strokeStyle = r() < 0.7 ? `rgba(235,225,200,${0.08 + r() * 0.16})` : `rgba(0,0,0,${0.15 + r() * 0.2})`;
    ctx.lineWidth = r() < 0.85 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 12, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = r() < 0.6 ? `rgba(0,0,0,${0.2 + r() * 0.4})` : `rgba(240,230,210,${0.1 + r() * 0.2})`;
    const d = r() < 0.9 ? 1 : 2;
    ctx.fillRect(r() * s, r() * s, d, d);
  }
  return c.toDataURL();
}

/** Draws the textures and publishes them as CSS variables on the page. */
export function installGrime(): void {
  const root = document.documentElement.style;
  root.setProperty("--rough-edge", `url(${roughEdge()})`);
  root.setProperty("--scratches", `url(${scratches()})`);
}
