import { audio } from "./audio";

/**
 * What happens when you try to unplug the thing that shouldn't be plugged in: static fills
 * the screen and something too big to take in flickers through it, a few frames at a time,
 * never long enough to see properly. Then it's gone, and the cable is still connected.
 *
 * The figure is one of four painted stages of the same thing, one per job, so it gets worse as
 * the game goes on (`art/concepts/characters/incomprehensible-being-concept.jpg`, cut by
 * `art/source/apparition/cut-being.py`). It's torn into slipped bands each time, so it's never quite the
 * same twice. Until a stage's image has loaded, a procedural shape stands in.
 */
const LENGTH_MS = 2700;

/**
 * Moments the figure shows through the static: start, how long, size, where, how solid. Each
 * one is closer than the last: far off at the edge, then across the room, then most of the
 * screen, then right against the glass with only the top of it in view. The last is a single
 * frame as the static fades, to make you unsure you saw it.
 */
const GLIMPSES = [
  { at: 380, ms: 90, scale: 0.55, x: 0.82, y: 0.58, alpha: 0.4 },
  { at: 760, ms: 70, scale: 1, x: 0.28, y: 0.55, alpha: 0.55 },
  { at: 1080, ms: 150, scale: 1.7, x: 0.55, y: 0.6, alpha: 0.75 },
  { at: 1620, ms: 60, scale: 3.4, x: 0.5, y: 1.15, alpha: 0.9 },
  { at: 2150, ms: 34, scale: 2.2, x: 0.5, y: 0.62, alpha: 0.7 },
];
/** How long the shape stays burned into the screen afterwards, like a bright TV switched off. */
const AFTERIMAGE_MS = 1800;
const WORDS = { at: 1330, ms: 90, text: "IT IS ALREADY CONNECTED" };

/** The painted stages, from the ghost in the wire to the unmaking. */
const STAGES = [1, 2, 3, 4].map((n) => {
  const img = new Image();
  img.src = `assets/apparition/being-${n}.webp`;
  return img;
});

let el: HTMLElement | null = null;

function build(): HTMLElement {
  const root = document.createElement("div");
  root.id = "apparition";
  root.hidden = true;
  root.innerHTML = `<canvas class="static" width="200" height="120"></canvas><canvas class="being" width="420" height="640"></canvas><p class="words"></p>`;
  document.body.appendChild(root);
  return root;
}

/** Draws stage `stage` (1 to 4), torn into bands that have slipped sideways like a bad signal. */
function drawBeing(canvas: HTMLCanvasElement, stage: number): void {
  const img = STAGES[Math.min(STAGES.length, Math.max(1, stage)) - 1];
  if (!img.complete || !img.naturalWidth) return drawShape(canvas);
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const scale = h / img.naturalHeight;
  const dw = img.naturalWidth * scale;
  for (let y = 0; y < h; ) {
    const band = 12 + Math.random() * 70;
    const slip = Math.random() < 0.3 ? (Math.random() - 0.5) * 40 : 0;
    ctx.drawImage(img, 0, y / scale, img.naturalWidth, band / scale, (w - dw) / 2 + slip, y, dw, band);
    y += band;
  }
}

/** A tall wrong shape: a dark mass, roots spilling from it, rings, and too many points of light. */
function drawShape(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const rnd = Math.random;
  // The body: stacked soft shadows, narrow at the top and spreading at the bottom.
  for (let i = 0; i < 9; i++) {
    const y = h * (0.18 + i * 0.08);
    const r = w * (0.12 + i * 0.03) * (0.8 + rnd() * 0.4);
    const g = ctx.createRadialGradient(w / 2 + (rnd() - 0.5) * 20, y, 0, w / 2, y, r);
    g.addColorStop(0, "rgba(6,4,10,0.95)");
    g.addColorStop(0.6, "rgba(10,6,18,0.6)");
    g.addColorStop(1, "rgba(10,6,18,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, y, r, r * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Roots or limbs, too many, spilling down and out of frame.
  ctx.strokeStyle = "rgba(8,5,12,0.85)";
  for (let i = 0; i < 46; i++) {
    const sx = w / 2 + (rnd() - 0.5) * w * 0.25;
    const sy = h * (0.35 + rnd() * 0.3);
    ctx.lineWidth = 1 + rnd() * 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + (rnd() - 0.5) * w * 0.6, sy + h * 0.2, sx + (rnd() - 0.5) * w, h * 0.85, sx + (rnd() - 0.5) * w * 1.4, h + 20);
    ctx.stroke();
  }
  // Long thin arms reaching up past the top.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 + side * w * 0.08, h * 0.3);
    ctx.quadraticCurveTo(w / 2 + side * w * (0.3 + rnd() * 0.3), h * 0.15, w / 2 + side * w * (0.2 + rnd() * 0.4), -20);
    ctx.stroke();
  }
  // Rings around where a head would be.
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(150,90,210,${0.25 - i * 0.05})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.22, w * (0.16 + i * 0.07), h * (0.05 + i * 0.025), (rnd() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Eyes. Not two.
  const eyes = 7 + Math.floor(rnd() * 6);
  for (let i = 0; i < eyes; i++) {
    const x = w / 2 + (rnd() - 0.5) * w * 0.32;
    const y = h * (0.12 + rnd() * 0.22);
    ctx.shadowColor = "rgba(190,240,255,0.9)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(225,250,255,0.95)";
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + rnd() * 3, 1 + rnd() * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/**
 * Plays the apparition over everything, showing stage `stage` of the being, then calls `done`.
 * Input is swallowed while it runs; check `apparitionPlaying` before acting on keys.
 */
export function apparition(done?: () => void, stage = 1): void {
  el ??= build();
  if (!el.hidden) return;
  const root = el;
  const noise = root.querySelector<HTMLCanvasElement>(".static")!;
  const being = root.querySelector<HTMLCanvasElement>(".being")!;
  const words = root.querySelector<HTMLElement>(".words")!;
  drawBeing(being, stage);
  words.textContent = WORDS.text;
  root.hidden = false;
  root.classList.remove("fade");
  audio.burst(LENGTH_MS / 1000);

  const nctx = noise.getContext("2d")!;
  const img = nctx.createImageData(noise.width, noise.height);
  const start = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const t = now - start;
    // Static: grey snow with the odd torn line.
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    if (Math.random() < 0.3) {
      nctx.fillStyle = "rgba(0,0,0,0.7)";
      nctx.fillRect(0, Math.random() * noise.height, noise.width, 2 + Math.random() * 6);
    }
    const glimpse = GLIMPSES.find((g) => t >= g.at && t < g.at + g.ms);
    being.style.opacity = glimpse ? String(Math.min(1, glimpse.alpha + 0.3)) : "0";
    // The snow thins for the instant it's there, so you see its outline and nothing more.
    noise.style.opacity = glimpse ? "0.45" : "0.85";
    if (glimpse) {
      being.style.left = `${glimpse.x * 100}%`;
      being.style.top = `${glimpse.y * 100}%`;
      being.style.transform = `translate(-50%, -50%) scale(${glimpse.scale}) skewX(${(Math.random() - 0.5) * 8}deg)`;
    }
    words.style.opacity = t >= WORDS.at && t < WORDS.at + WORDS.ms ? "1" : "0";
    if (t > LENGTH_MS - 600) root.classList.add("fade");
    if (t < LENGTH_MS) frame = requestAnimationFrame(step);
    else {
      cancelAnimationFrame(frame);
      root.hidden = true;
      root.classList.remove("fade");
      afterimage(being);
      done?.();
    }
  };
  frame = requestAnimationFrame(step);
}

/**
 * Leaves a faint dark ghost of the figure over the middle of the room once the static is gone,
 * and lets it fade. It doesn't block input; it's just there.
 */
function afterimage(being: HTMLCanvasElement): void {
  const ghost = document.createElement("canvas");
  ghost.className = "apparition-after";
  ghost.width = being.width;
  ghost.height = being.height;
  ghost.getContext("2d")!.drawImage(being, 0, 0);
  document.body.appendChild(ghost);
  ghost.animate([{ opacity: 0.35 }, { opacity: 0.2, offset: 0.4 }, { opacity: 0 }], { duration: AFTERIMAGE_MS, easing: "ease-in" })
    .finished.then(() => ghost.remove(), () => ghost.remove());
}

export const apparitionPlaying = () => !!el && !el.hidden;
