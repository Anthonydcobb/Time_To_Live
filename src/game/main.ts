import Phaser from "phaser";
import { audio } from "./audio";
import { crt } from "./crt";
import { installGrime } from "./grime";
import { RoomScene } from "./room-scene";
import { events, Story } from "./story";
import { Ui } from "./ui";

installGrime();
const ui = new Ui();
// The dialogue console starts with a little growth on it, and the haunting spreads it.
ui.overgrow(0.3);
events.on("haunt", () => ui.overgrow(1, 6000));

// The page needs one click before it gets the keyboard, especially inside a frame.
const start = document.getElementById("start")!;
crt.on("soft");
start.addEventListener("click", () => {
  start.remove();
  crt.fade(900);
  window.focus();
  // Browsers only allow sound after a click, so this is where it starts.
  audio.start();
});
const story = new Story(ui);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "stage",
  width: 15 * 64,
  height: 10 * 64,
  backgroundColor: "#0b0c0a",
  pixelArt: true,
  physics: { default: "arcade", arcade: { debug: new URLSearchParams(location.search).has("debug") } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: new RoomScene(story, ui),
});

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
const net = story.job.net;
let last = performance.now();
function tick(now: number): void {
  net.clock.advance(Math.min(1000, now - last));
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The work order ticks itself off as the network starts working.
const tasksEl = document.getElementById("tasks")!;
const rows = story.job.tasks.map((task) => {
  const li = document.createElement("li");
  li.textContent = task.text;
  li.className = task.done ? "task" : "flavor";
  tasksEl.appendChild(li);
  return { li, task };
});
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
});
/** Pops a short "done" note by the stub when a task ticks itself off. */
const toast = (text: string) => {
  const p = document.createElement("p");
  p.id = "wo-toast";
  p.textContent = `✓ ${text}`;
  document.getElementById("wo-toast")?.remove();
  workOrder.appendChild(p);
  window.setTimeout(() => p.remove(), 3000);
};
const wasDone = new Map(rows.map((r) => [r, !!r.task.done?.()]));
window.setInterval(() => {
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

// ?dev adds a panel of shortcuts for testing: jump rooms, finish job 1, haunt now.
if (new URLSearchParams(location.search).has("dev")) void import("./dev").then((m) => m.installDevTools(story, ui));

// ?debug shows collision boxes and lets the console reach the game.
if (location.search.includes("debug")) Object.assign(window, { story, ui, game, audio });
