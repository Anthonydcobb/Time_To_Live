import Phaser from "phaser";
import { RoomScene } from "./room-scene";
import { Story } from "./story";
import { Ui } from "./ui";

const ui = new Ui();

// The page needs one click before it gets the keyboard, especially inside a frame.
const start = document.getElementById("start")!;
start.addEventListener("click", () => {
  start.remove();
  window.focus();
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
const count = document.getElementById("wo-count")!;
// J opens and closes the work order. It stays open while a laptop is up, since that's when you need it.
let expanded = true;
window.addEventListener("keydown", (e) => {
  if ((e.key === "j" || e.key === "J") && !ui.typing) expanded = !expanded;
});
window.setInterval(() => {
  workOrder.hidden = !story.has("job");
  workOrder.classList.toggle("collapsed", !expanded && !ui.typing);
  const real = rows.filter((r) => r.task.done);
  count.textContent = `${real.filter((r) => r.task.done!()).length}/${real.length}`;
  for (const { li, task } of rows) li.classList.toggle("done", !!task.done?.());
  story.tick();
  ui.refresh();
}, 250);

// ?debug shows collision boxes and lets the console reach the game.
if (location.search.includes("debug")) Object.assign(window, { story, ui, game });
