import Phaser from "phaser";
import { audio } from "./audio";
import { crt } from "./crt";
import { installGrime } from "./grime";
import { applyOptions, readOptions, showLoading, showTitle } from "./menu";
import { RoomScene } from "./room-scene";
import { events, Story } from "./story";
import { Ui } from "./ui";

installGrime();
const ui = new Ui();
// The dialogue console starts with a little growth on it, and the haunting spreads it.
ui.overgrow(0.3);
events.on("haunt", () => ui.overgrow(1, 6000));

const story = new Story(ui);
applyOptions(readOptions(), ui);
crt.on("soft");

/** Where a loaded game puts you: beside the coffee machine in Bob's office, where you saved. */
const COFFEE_SPOT = { x: 14, y: 12 };

// The title screen first. Its click is also the one the browser needs before it allows sound.
const choice = await showTitle(ui);
window.focus();
audio.start();
const loading = showLoading(choice.kind === "load" ? "RESTORING SESSION" : "CLOCKING IN", 1800);
// Let the loading screen paint before a saved game's networks replay.
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
if (choice.kind === "load") {
  story.restore(choice.save);
  if (story.has("haunt")) ui.overgrow(1);
}
let opened!: () => void;
const gate = new Promise<void>((r) => (opened = r));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "stage",
  width: 15 * 64,
  height: 10 * 64,
  backgroundColor: "#0b0c0a",
  pixelArt: true,
  physics: { default: "arcade", arcade: { debug: new URLSearchParams(location.search).has("debug") } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: new RoomScene(story, ui, { at: choice.kind === "load" ? COFFEE_SPOT : undefined, gate }),
});
game.events.once(Phaser.Core.Events.READY, () =>
  void loading.finish().then(() => {
    crt.fade(900);
    opened();
  }),
);

// The game is letterboxed, so tell CSS where the picture sits. The work order pins to its corner, not the window's.
function trackFrame(): void {
  const r = game.canvas.getBoundingClientRect();
  const root = document.documentElement.style;
  root.setProperty("--game-top", `${Math.max(0, r.top)}px`);
  root.setProperty("--game-right", `${Math.max(0, innerWidth - r.right)}px`);
}
game.events.once(Phaser.Core.Events.READY, trackFrame);
game.scale.on(Phaser.Scale.Events.RESIZE, trackFrame);
window.addEventListener("resize", () => requestAnimationFrame(trackFrame));

// Copy every fourth frame into a tiny canvas behind the game. CSS blows it up, blurs and darkens it.
// It has to be read right after rendering, while the WebGL picture is still there.
const ambient = document.getElementById("ambient") as HTMLCanvasElement;
const actx = ambient.getContext("2d")!;
ambient.width = 96;
ambient.height = 64;
let frame = 0;
game.events.on(Phaser.Core.Events.POST_RENDER, () => {
  if (frame++ % 4 === 0) actx.drawImage(game.canvas, 0, 0, ambient.width, ambient.height);
});

// Real time drives the network, so link lights and spanning tree take as long as they really do.
let last = performance.now();
function tick(now: number): void {
  // Whichever job you're on. A job you've left stands still.
  story.job.net.clock.advance(Math.min(1000, now - last));
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The work order ticks itself off as the network starts working. It's rebuilt when you take a new job.
const tasksEl = document.getElementById("tasks")!;
let shown: typeof story.job | null = null;
let rows: { li: HTMLLIElement; task: (typeof story.job.tasks)[number] }[] = [];
let wasDone = new Map<(typeof rows)[number], boolean>();
function showJob(): void {
  const job = (shown = story.job);
  document.querySelector("#wo-stub .wo-title")!.textContent = `Work order #${job.workOrder.number}`;
  document.querySelector("#wo-stub .wo-where")!.textContent = job.workOrder.client;
  document.querySelector("#wo-body p")!.textContent = job.workOrder.place;
  rows = job.tasks.map((task) => {
    const li = document.createElement("li");
    li.textContent = task.text;
    li.className = task.done ? "task" : "flavor";
    return { li, task };
  });
  tasksEl.replaceChildren(...rows.map((r) => r.li));
  // Only tasks that tick off after this point get a "done" note.
  wasDone = new Map(rows.map((r) => [r, !!r.task.done?.()]));
}
showJob();
const workOrder = document.getElementById("work-order")!;
const stub = document.getElementById("wo-stub")!;
const body = document.getElementById("wo-body")!;
const count = document.getElementById("wo-count")!;
// The work order is folded to its stub. J or a click unfolds the task list.
const unfold = (open: boolean) => {
  body.hidden = !open;
  stub.setAttribute("aria-expanded", String(open));
};
// Don't take focus on click, so a terminal you're typing in keeps the keyboard.
stub.addEventListener("mousedown", (e) => e.preventDefault());
stub.addEventListener("click", () => unfold(body.hidden));
window.addEventListener("keydown", (e) => {
  if ((e.key === "j" || e.key === "J") && !ui.typing) unfold(body.hidden);
  if ((e.key === "m" || e.key === "M") && !ui.typing) audio.toggleMute();
  // F1 radios Walter for a hint, even from a laptop or PC where Q would just type a q.
  if (e.key === "F1") {
    e.preventDefault();
    story.callWalter();
  }
  // The book eats its own keys (G closes it), so only a G nobody else used opens it.
  if ((e.key === "g" || e.key === "G") && !e.defaultPrevented && !ui.busy) story.openGrimoire();
});
// The key hint learns G once you have the book.
events.on("grimoire", () => (document.getElementById("key-grimoire")!.hidden = false));
/** Pops a short "done" note by the stub when a task ticks itself off. */
const toast = (text: string) => {
  const p = document.createElement("p");
  p.id = "wo-toast";
  p.textContent = `✓ ${text}`;
  document.getElementById("wo-toast")?.remove();
  workOrder.appendChild(p);
  window.setTimeout(() => p.remove(), 3000);
};
window.setInterval(() => {
  if (story.job !== shown) showJob();
  workOrder.hidden = !story.has("job");
  const real = rows.filter((r) => r.task.done);
  count.textContent = `${real.filter((r) => r.task.done!()).length}/${real.length}`;
  for (const r of rows) {
    const done = !!r.task.done?.();
    r.li.classList.toggle("done", done);
    if (done && !wasDone.get(r) && !workOrder.hidden) toast(r.task.text);
    wasDone.set(r, done);
  }
  story.tick();
  ui.refresh();
}, 250);

// The dev panel of shortcuts for testing (jump rooms, finish a job, haunt now) is always there
// under npm run dev, never in a real build unless the address has ?dev. ?nodev hides it.
const params = new URLSearchParams(location.search);
if ((import.meta.env.DEV || params.has("dev")) && !params.has("nodev")) void import("./dev").then((m) => m.installDevTools(story, ui));

// ?debug shows collision boxes and lets the console reach the game.
if (location.search.includes("debug")) Object.assign(window, { story, ui, game, audio });
