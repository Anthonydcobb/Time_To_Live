import type { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import { parseIpv4 as ip } from "../sim/addr";
import type { Job } from "../sim/job";
import { events, type Story } from "./story";
import type { Ui } from "./ui";

/**
 * Developer shortcuts, loaded only with `?dev` in the address. A small panel (toggle with `)
 * jumps between rooms and skips ahead, so you can check the end of a job without playing it.
 * "Finish job 1" types the real commands into the real devices, so everything after it,
 * the haunt included, happens exactly as it would for a player.
 */

/** The password the dev shortcuts set and answer with. */
const PW = "dev";

/** The parts of Story and Ui the shortcuts reach into. Dev-only, so it skips their privacy. */
interface StoryInternals {
  flags: Set<string>;
  /** Walter's one-time reactions already given. */
  told: Set<string>;
  haunt(): void;
}
interface UiInternals {
  current: unknown;
  queue: unknown[];
  card: unknown;
}

/** Answers whatever the console is waiting on: press RETURN, the setup dialog, passwords, confirms. */
function settle(d: IosDevice): void {
  for (let i = 0; i < 8; i++) {
    const p = d.console.prompt();
    if (p.includes("[yes/no")) d.console.input("no");
    else if (p === "") d.console.input("");
    else if (p.startsWith("Password")) d.console.input(PW);
    else if (p.includes("[confirm]") || p.includes("Destination filename")) d.console.input("");
    else return;
  }
}

function type(d: IosDevice, lines: string[]): void {
  settle(d);
  for (const line of lines) {
    d.console.input(line);
    settle(d);
  }
}

function finish(net: { clock: { advance(ms: number): void } }, job: Job | undefined): void {
  for (let i = 0; job && !job.done && i < 120; i++) net.clock.advance(1000);
}

export function installDevTools(story: Story, ui: Ui): void {
  const s = story as unknown as StoryInternals;
  const u = ui as unknown as UiInternals;
  const { net, r1, s1, register, office } = story.job as typeof story.job & { register: Pc; office: Pc };

  const closeDialogue = () => {
    u.current = null;
    u.queue = [];
    u.card = null;
    document.querySelectorAll<HTMLElement>("#dialogue, #card, #closeup").forEach((e) => (e.hidden = true));
  };

  const skipIntro = () => {
    for (const f of ["intro", "walkie", "job"]) s.flags.add(f);
    events.emit("walkie");
    closeDialogue();
  };

  const go = (room: "office" | "shop") => {
    closeDialogue();
    events.emit("goto", room);
  };

  const finishJob1 = () => {
    skipIntro();
    // Skip Walter's running commentary; the haunt's own lines still play.
    for (const t of story.job.tasks) if (t.id) s.told.add(t.id);
    // Cables: router to switch, both PCs into the switch.
    if (!r1.port("Gi0/0").peer) net.connect(r1.port("Gi0/0"), s1.port("Gi0/1"));
    if (!register.nic.peer) net.connect(register.nic, s1.port("Fa0/1"));
    if (!office.nic.peer) net.connect(office.nic, s1.port("Fa0/2"));
    // The router, then the switch, the same way a player would.
    type(r1, ["enable", "configure terminal", "hostname R1", `enable secret ${PW}`, "line console 0", `password ${PW}`, "login", "exit",
      "interface gigabitEthernet0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end", "copy running-config startup-config"]);
    type(s1, ["enable", "configure terminal", "hostname S1", `enable secret ${PW}`, "line console 0", `password ${PW}`, "login", "end",
      "copy running-config startup-config"]);
    register.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
    office.configure(ip("192.168.1.11"), ip("255.255.255.0"), ip("192.168.1.1"));
    // Past spanning tree's listening and learning, then the pings.
    net.clock.advance(35_000);
    finish(net, register.shell.execute("ping 192.168.1.1").job);
    finish(net, office.shell.execute("ping 192.168.1.1").job);
    finish(net, register.shell.execute("ping 192.168.1.11").job);
    closeDialogue();
  };

  const panel = document.createElement("div");
  panel.id = "devtools";
  panel.innerHTML = `
    <strong>DEV</strong> <span class="keyhint">\` hides</span>
    <div class="row">
      <button data-act="intro">Skip intro</button>
      <button data-act="office">Go to office</button>
      <button data-act="shop">Go to store</button>
    </div>
    <div class="row">
      <button data-act="job1">Finish job 1</button>
      <button data-act="haunt">Haunt now</button>
      <button data-act="time">+30 s</button>
      <button data-act="close">Close dialogue</button>
    </div>
    <p class="status"></p>
    <p class="note">Job 1 shortcut passwords: <code>${PW}</code></p>
  `;
  document.body.appendChild(panel);
  const actions: Record<string, () => void> = {
    intro: skipIntro,
    office: () => go("office"),
    shop: () => go("shop"),
    job1: finishJob1,
    haunt: () => {
      closeDialogue();
      if (!story.has("haunt")) s.haunt();
    },
    time: () => net.clock.advance(30_000),
    close: closeDialogue,
  };
  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (act) actions[act]?.();
    (document.activeElement as HTMLElement | null)?.blur();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "`" && !ui.typing) panel.hidden = !panel.hidden;
  });
  const status = panel.querySelector(".status")!;
  window.setInterval(() => {
    const real = story.job.tasks.filter((t) => t.done);
    const doneCount = real.filter((t) => t.done!()).length;
    status.textContent = `room: ${story.room} · tasks ${doneCount}/${real.length} · flags: ${[...s.flags].join(", ") || "none"}`;
  }, 500);
}
