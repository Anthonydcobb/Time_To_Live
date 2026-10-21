import { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import type { Device } from "../sim/network";
import { JOBS } from "../sim/scenarios";
import { TopologyView } from "./topology";
import { BASICS, Grimoire, type Book } from "../sim/grimoire";
import { TerminalView, iosSession, pcSession } from "./terminal";

// ---- wire up the corner store ----------------------------------------------

// ?job=2 picks the job; the dropdown reloads the page with it.
const jobId = new URLSearchParams(location.search).get("job") ?? JOBS[0].id;
const job = JOBS.find((j) => j.id === jobId) ?? JOBS[0];
const store = job.build();
const jobSelect = document.getElementById("job") as HTMLSelectElement;
for (const j of JOBS) jobSelect.add(new Option(j.name, j.id, false, j === job));
jobSelect.addEventListener("change", () => {
  location.search = `?job=${jobSelect.value}`;
});
const wo = store.workOrder;
document.getElementById("wo-number")!.textContent = `Work order #${wo.number}`;
document.getElementById("wo-client")!.textContent = `${wo.client},`;
document.getElementById("wo-place")!.textContent = wo.place;
document.getElementById("wo-notes")!.textContent = wo.notes;
document.getElementById("wo-hint")!.textContent = wo.hint;
const grimoire = new Grimoire([...BASICS, ...store.incantations]);
const tabsEl = document.getElementById("tabs")!;
const tasksEl = document.getElementById("tasks")!;
const termsEl = document.getElementById("terminals")!;
const topology = new TopologyView(store.net, store.layout, document.getElementById("topology")!, (d) => select(d));

const views = new Map<Device, TerminalView>();
const buttons = new Map<Device, HTMLButtonElement>();

for (const device of store.net.devices) {
  if (device instanceof IosDevice) device.console.grimoire = grimoire;
  const session = device instanceof IosDevice ? iosSession(device) : pcSession(device as Pc);
  const view = new TerminalView(device, session, termsEl);
  views.set(device, view);
  device.onOutput((text) => view.log(text));

  const button = document.createElement("button");
  button.setAttribute("role", "tab");
  button.addEventListener("click", () => select(device));
  tabsEl.appendChild(button);
  buttons.set(device, button);
}

function select(device: Device): void {
  for (const [d, v] of views) {
    if (d === device) v.show();
    else v.hide();
    buttons.get(d)!.classList.toggle("active", d === device);
    buttons.get(d)!.setAttribute("aria-selected", String(d === device));
  }
  topology.select(device);
}

// Real time drives the simulation: link lights and spanning tree wait for you.
let last = performance.now();
function tick(now: number): void {
  store.net.clock.advance(Math.min(1000, now - last));
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
// The grimoire lists every incantation learned so far, newest highlighted.
const BOOK_NAMES: Record<Book, string> = { exec: "EXEC", config: "config", if: "interface", line: "line", dhcp: "DHCP pool", vlan: "VLAN", acl: "ACL" };
const grimoireEl = document.getElementById("grimoire")!;
function addIncantation(book: Book, words: string[], fresh: boolean): void {
  const li = document.createElement("li");
  li.innerHTML = `<code></code> <span class="book"></span>`;
  li.querySelector("code")!.textContent = words.join(" ");
  li.querySelector(".book")!.textContent = BOOK_NAMES[book];
  if (fresh) li.classList.add("fresh");
  grimoireEl.appendChild(li);
}
for (const text of grimoire.list()) {
  const [book, words] = text.split(": ");
  if (!BASICS.includes(text)) addIncantation(book as Book, words.split(" "), false);
}
grimoire.onLearn((book, words) => addIncantation(book, words, true));

// The work order ticks itself off as the network starts working.
const taskRows = store.tasks.map((task) => {
  const li = document.createElement("li");
  li.textContent = task.text;
  li.className = task.done ? "task" : "flavor";
  tasksEl.appendChild(li);
  return { li, task };
});

function refresh(): void {
  topology.draw();
  for (const [d, b] of buttons) {
    b.textContent = d instanceof IosDevice ? `${d.hostname} · ${d.model}` : `${d.hostname} · PC`;
  }
  for (const { li, task } of taskRows) li.classList.toggle("done", !!task.done?.());
}
window.setInterval(refresh, 250);
refresh();

window.addEventListener("resize", () => views.forEach((v) => v.resize()));
select(store.start);
