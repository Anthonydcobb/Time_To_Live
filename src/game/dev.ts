import type { IosDevice } from "../sim/devices/ios-device";
import { parseIpv4 as ip } from "../sim/addr";
import type { Job } from "../sim/job";
import type { laundromat } from "../sim/scenarios/laundromat";
import { scriptNotes } from "./script";
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
  wash: ReturnType<typeof laundromat> | null;
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
  const { net, r1, s1, register, office } = story.store;

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
    for (const t of story.store.tasks) if (t.id) s.told.add(t.id);
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

  const takeJob2 = () => {
    for (const f of ["intro", "walkie", "job", "haunt", "done", "home"]) s.flags.add(f);
    events.emit("walkie");
    story.takeLaundromat();
    events.emit("job");
    closeDialogue();
  };

  /**
   * Does job 2's network work the way a player would, then leaves the last task, typing
   * show ip dhcp binding on the router, to you, since that's where the ghost lease shows up.
   */
  const finishJob2 = () => {
    takeJob2();
    const w = s.wash!;
    for (const t of w.tasks) if (t.id) s.told.add(t.id);
    for (let i = 0; i < w.tasks.length; i++) s.told.add(`wash${i}`);
    type(w.r1, ["enable", "configure terminal", "hostname R1", "interface gigabitEthernet0/0",
      "ip address 192.168.20.1 255.255.255.0", "no shutdown", "exit",
      "ip dhcp excluded-address 192.168.20.1 192.168.20.20", "ip dhcp pool LAUNDRY",
      "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "end"]);
    w.printer.shell.execute("ipconfig 192.168.20.5 255.255.255.0 192.168.20.1");
    // Past spanning tree's listening and learning, then the renews and the pings.
    w.net.clock.advance(35_000);
    finish(w.net, w.kiosk.shell.execute("ipconfig /renew").job);
    finish(w.net, w.office.shell.execute("ipconfig /renew").job);
    finish(w.net, w.kiosk.shell.execute("ping 192.168.20.5").job);
    finish(w.net, w.office.shell.execute("ping 192.168.20.5").job);
    closeDialogue();
    events.emit("goto", "laundromat");
  };

  const panel = document.createElement("div");
  panel.id = "devtools";
  panel.innerHTML = `
    <button class="dev-toggle" data-act="fold" title="Fold the dev panel (\`)">DEV</button> <span class="keyhint">\` folds</span>
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
      <button data-act="job2">Job 2</button>
      <button data-act="finish2">Finish job 2</button>
      <button data-act="being">Being 1/4</button>
      <button data-act="grimoire">Grimoire</button>
    </div>
    <p class="status"></p>
    <p class="note">Job 1 shortcut passwords: <code>${PW}</code></p>
  `;
  document.body.appendChild(panel);
  /** Folds the panel down to its DEV tab, and remembers that across reloads. */
  const fold = (folded: boolean) => {
    panel.classList.toggle("folded", folded);
    try {
      localStorage.setItem("ttl-dev-folded", folded ? "1" : "");
    } catch {
      // Storage can be blocked; the panel just starts open next time.
    }
  };
  try {
    fold(localStorage.getItem("ttl-dev-folded") === "1");
  } catch {
    // As above.
  }
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
    // Skips job 1 as if it went fine, takes work order #0002 and drives to the laundromat.
    job2: () => {
      takeJob2();
      events.emit("goto", "laundromat");
    },
    finish2: finishJob2,
    // Plays the apparition with the stage on the button, then moves the button to the next one.
    being: () => {
      ui.apparition();
      ui.beingStage = (ui.beingStage % 4) + 1;
      panel.querySelector('[data-act="being"]')!.textContent = `Being ${ui.beingStage}/4`;
    },
    // Both jobs done and Walter has told you about the book; it's in Bob's desk.
    grimoire: () => {
      if (!s.wash) takeJob2();
      for (const f of ["ask-binding", "checked", "haunt2", "done2", "arrived2", "home2", "ask-grimoire"]) s.flags.add(f);
      closeDialogue();
      go("office");
    },
    fold: () => fold(!panel.classList.contains("folded")),
  };
  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (act) actions[act]?.();
    (document.activeElement as HTMLElement | null)?.blur();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "`" && !ui.typing) fold(!panel.classList.contains("folded"));
  });
  const status = panel.querySelector(".status")!;
  window.setInterval(() => {
    const real = story.job.tasks.filter((t) => t.done);
    const doneCount = real.filter((t) => t.done!()).length;
    const notes = scriptNotes();
    status.textContent = `room: ${story.room} · tasks ${doneCount}/${real.length} · flags: ${[...s.flags].join(", ") || "none"}`
      + ` · script notes for Claude: ${notes.length}`;
    // Hover the status for the notes themselves.
    (status as HTMLElement).title = notes.map((n) => `line ${n.line}: ${n.text}`).join("\n");
  }, 500);
}
