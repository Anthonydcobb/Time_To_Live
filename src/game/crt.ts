/**
 * An old-TV look laid over the whole screen: scanlines, dark corners, a faint tint. It's off
 * during normal play. The start screen holds it on softly; horror events turn it up to
 * "haunted" (a rolling bar, a picture that jitters, colours pulling apart) and then let it
 * fade out slowly afterwards, as if the screen hasn't quite recovered.
 *
 *   crt.on("soft")      // hold it, e.g. while a menu is open
 *   crt.on("haunted")   // hold it at full strength during an event
 *   crt.fade(8000)      // ease out from wherever it is
 */
export type CrtMode = "soft" | "haunted";

const SOFT = 0.5;
/** Above this level a haunted screen also jitters and splits its colours. */
const JITTER_ABOVE = 0.7;

/** Pulls the red channel left and the rest right, then adds them back together. */
const SPLIT_SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="crt-split" color-interpolation-filters="sRGB">
    <feOffset in="SourceGraphic" dx="-2" result="l"/>
    <feColorMatrix in="l" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>
    <feOffset in="SourceGraphic" dx="2" result="r"/>
    <feColorMatrix in="r" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan"/>
    <feBlend in="red" in2="cyan" mode="screen"/>
  </filter>
</svg>`;

let root: HTMLElement | null = null;
let mode: CrtMode = "soft";
let level = 0;
let anim = 0;

function el(): HTMLElement {
  if (root) return root;
  root = document.createElement("div");
  root.id = "crt";
  root.hidden = true;
  root.innerHTML = `<div class="roll"></div><div class="flicker"></div>`;
  document.body.appendChild(root);
  document.body.insertAdjacentHTML("beforeend", SPLIT_SVG);
  return root;
}

function set(value: number): void {
  const r = el();
  level = value;
  r.hidden = value <= 0.001;
  r.classList.toggle("haunted", mode === "haunted");
  r.style.setProperty("--crt", value.toFixed(3));
  document.body.classList.toggle("crt-jitter", mode === "haunted" && value > JITTER_ABOVE);
}

export const crt = {
  /** Turns the effect on at `m` and holds it there until `fade` is called. */
  on(m: CrtMode): void {
    cancelAnimationFrame(anim);
    mode = m;
    set(m === "soft" ? SOFT : 1);
  },

  /** Eases the effect out over `ms`: slow to start, slow to finish, so it lingers. */
  fade(ms: number): void {
    cancelAnimationFrame(anim);
    const from = level;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      set(from * 0.5 * (1 + Math.cos(Math.PI * p)));
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  },
};
