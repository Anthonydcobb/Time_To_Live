import Phaser from "phaser";
import { macAllocatorState, parseIpv4 as ip, setMacAllocator } from "../sim/addr";
import { Pc } from "../sim/devices/pc";
import { BASICS, Grimoire } from "../sim/grimoire";
import { cornerStore } from "../sim/scenarios/corner-store";
import { laundromat } from "../sim/scenarios/laundromat";
import type { Scenario } from "../sim/scenarios/types";
import { audio } from "./audio";
import { showLoading } from "./menu";
import { bookToast, NOTES, type BookContents } from "./grimoire-book";
import type { RoomId } from "./rooms";
import { writeSave, type SaveData } from "./save";
import { NetRecorder } from "./save-log";
import type { SiteId } from "./town-map";
import { pick, runAction, scene, useStory } from "./script";
import type { Line, Ui } from "./ui";

/** Scene events: "goto" (room), "flicker", "blackout" and "lights", "haunt". */
export const events = new Phaser.Events.EventEmitter();

const PC_HINT = "On a PC: ipconfig 192.168.1.10 255.255.255.0 192.168.1.1   ·   Esc closes the laptop";
const DHCP_HINT = "ipconfig /renew asks the router for a lease   ·   ipconfig shows what you got   ·   Esc closes";
const PRINTER_HINT = "Fixed address: ipconfig 192.168.20.5 255.255.255.0 192.168.20.1   ·   Esc closes";
const IOS_HINT = "? lists commands   ·   Tab completes   ·   Esc closes the laptop";

/** Whether a typed line is show ip dhcp binding, abbreviated any way IOS allows ("sh ip dh b"). */
function isShowDhcpBinding(line: string): boolean {
  const w = line.trim().toLowerCase().split(/\s+/);
  const starts = (word: string | undefined, full: string, min: number) => !!word && word.length >= min && full.startsWith(word);
  // "do show ..." works from config mode too.
  if (w[0] === "do") w.shift();
  return w.length === 4 && starts(w[0], "show", 2) && w[1] === "ip" && starts(w[2], "dhcp", 2) && starts(w[3], "binding", 1);
}

/**
 * The slice: who says what, and when. It owns each job's network and reads it to decide
 * what happens next. Job 1 is the corner store; job 2, the laundromat, starts from the board.
 */
export class Story {
  readonly store = cornerStore({ cabled: false });
  /** Job 2, once you've taken it off the board. */
  private wash: ReturnType<typeof laundromat> | null = null;
  /** Everything done to each job's network, for saving. */
  private readonly storeLog: NetRecorder;
  private washLog: NetRecorder | null = null;
  /** Where the MAC allocator stood when job 2 was built, so a load rebuilds it with the same MACs. */
  private washMacs = 0;
  /** Plugged into S1 Fa0/24 when the job is done. The cable goes into the wall. */
  readonly phantom = new Pc("PHANTOM", "?", "666666666666");
  room: RoomId = "office";
  private readonly flags = new Set<string>();
  /** Everything you've learned carries from job to job. */
  private readonly grimoire: Grimoire;
  private garyTip = 0;
  private finchLine = 0;
  private gusLine = 0;
  /** Where R1's command history stood when Walter asked for show ip dhcp binding. */
  private bindingFrom = 0;
  private told = new Set<string>();
  /** Notes you've read, in order. They're pinned into the grimoire, even ones read before you had it. */
  private readonly notes: string[] = [];

  constructor(private readonly ui: Ui) {
    this.store.net.add(this.phantom);
    this.grimoire = new Grimoire([...BASICS, ...this.store.incantations]);
    const { r1, s1, register, office } = this.store;
    // Stage cues in the script, like (LIGHTS FLICKER), fire scene events as the line types out;
    // its #set, #clear and #give change the story's flags as the conversation reaches them.
    const cue = (event: string) => {
      if (!runAction(event)) events.emit(event);
    };
    ui.onCue = cue;
    useStory({ has: (f) => this.flags.has(f), set: (f, on) => (on ? this.flags.add(f) : this.flags.delete(f)) }, cue);
    this.wire([r1, s1]);
    ui.attach(this.store.net, [r1, s1, register, office], this.store.layout);
    // After attach, whose consoles boot the same way on every page load.
    this.storeLog = new NetRecorder(this.store.net);
  }

  /** The job you're on now: its network, tasks and work order. */
  get job(): Scenario {
    return this.wash ?? this.store;
  }

  /** Gives consoles the shared grimoire and Story Mode (the setup dialog gets angrier each time you say yes). */
  private wire(devices: { console: { grimoire: Grimoire | null; story: boolean } }[]): void {
    for (const d of devices) {
      d.console.grimoire = this.grimoire;
      d.console.story = true;
    }
  }

  /** Takes work order #0002: builds the laundromat's network and points the laptop at it. */
  takeLaundromat(): void {
    if (this.wash) return;
    this.washMacs = macAllocatorState();
    const job = laundromat();
    for (const i of job.incantations) this.grimoire.teach(i);
    this.wire([job.r1, job.s1]);
    this.ui.attach(job.net, [job.r1, job.s1, job.kiosk, job.office, job.printer], job.layout);
    // The last real step is a look, not a change: Walter wants the lease list checked. It sits
    // above the flavor line and ticks off when the story sees the command (see tickLaundromat).
    job.tasks.splice(job.tasks.length - 1, 0, {
      id: "binding",
      text: "Check who has a lease: show ip dhcp binding on the router.",
      done: () => this.flags.has("checked"),
    });
    this.wash = job;
    this.washLog = new NetRecorder(job.net);
    this.flags.add("job2");
  }

  /** Everything needed to pick up from here: the story, and what was done to each network. */
  snapshot(): SaveData {
    return {
      version: 1,
      savedAt: Date.now(),
      room: this.room,
      flags: [...this.flags],
      told: [...this.told],
      notes: [...this.notes],
      lines: { gary: this.garyTip, finch: this.finchLine, gus: this.gusLine },
      bindingFrom: this.bindingFrom,
      store: this.storeLog.save(),
      wash: this.washLog ? { macs: this.washMacs, net: this.washLog.save() } : null,
    };
  }

  /**
   * Picks up a saved game on a freshly loaded page, before the first room is shown: the story's
   * flags, then each network rebuilt by replaying what was done to it.
   */
  restore(save: SaveData): void {
    for (const f of save.flags) this.flags.add(f);
    for (const t of save.told) this.told.add(t);
    this.notes.push(...save.notes);
    this.garyTip = save.lines.gary;
    this.finchLine = save.lines.finch;
    this.gusLine = save.lines.gus;
    this.bindingFrom = save.bindingFrom;
    this.storeLog.replay(save.store);
    if (save.wash) {
      setMacAllocator(save.wash.macs);
      this.wash = null;
      this.takeLaundromat();
      this.washLog!.replay(save.wash.net);
    }
    this.ui.clearTerminals();
    // What the haunts left behind keeps going.
    if (this.flags.has("haunt")) {
      this.ui.bindCable(this.store.s1.port("FastEthernet0/24"));
      this.phantomHellos();
    }
    if (this.flags.has("done2")) this.ui.beingStage = 2;
    if (this.flags.has("grimoire")) events.emit("grimoire");
  }

  /** Once spanning tree lets it through, the phantom says hello to the register now and then. */
  private phantomHellos(): void {
    const hello = () => {
      if (this.phantom.nic.peer) this.phantom.shell.execute("ping 192.168.1.10");
    };
    window.setTimeout(hello, 40_000);
    window.setInterval(hello, 90_000);
  }

  /** Whether the work order line with this id is done right now. */
  private done(id: string): boolean {
    return !!this.store.tasks.find((t) => t.id === id)?.done?.();
  }

  has(flag: string): boolean {
    return this.flags.has(flag);
  }

  /** Called when a room finishes loading. */
  enter(room: RoomId): void {
    this.room = room;
    // The apparition's TV lines and drone hang over the store until you leave it.
    if (room !== "shop") this.ui.endLinger();
    if (room === "office" && !this.flags.has("intro")) {
      this.flags.add("intro");
      this.ui.say(scene("office-arrive"));
    }
    if (room === "shop" && !this.flags.has("arrived")) {
      this.flags.add("arrived");
      this.ui.say(scene("shop-arrive"));
    }
    if (room === "office" && this.flags.has("done") && !this.flags.has("home")) {
      this.flags.add("home");
      this.ui.say(scene("home-job1"));
    }
    if (room === "laundromat" && !this.flags.has("arrived2")) {
      this.flags.add("arrived2");
      this.ui.say(scene("wash-arrive"));
    }
    if (room === "office" && this.flags.has("done2") && !this.flags.has("home2")) {
      this.flags.add("home2");
      this.ui.say(scene("home-job2"), () => this.flags.add("ask-grimoire"));
    }
  }

  /** Press E on a prop. */
  interact(id: string): void {
    const { r1, s1, register, office } = this.store;
    const ui = this.ui;
    // Close-ups that change after a look (like Dryer 4) only play their first look once.
    this.flags.add(`seen:${this.room}:${id}`);
    if (this.room === "laundromat") return this.interactLaundromat(id);
    switch (`${this.room}:${id}`) {
      // ---- home base ----
      case "office:walkie":
        if (!this.flags.has("walkie")) {
          this.flags.add("walkie");
          events.emit("walkie");
          // The lights go out as you pick it up. Walter shouts at Gary in the dark, and the lights
          // come back with a hiss under them before he starts his welcome as if nothing happened.
          events.emit("blackout");
          ui.hold(900, () =>
            ui.say(
              scene("walkie-blackout"),
              () => {
                events.emit("lights");
                ui.hold(800, () => this.walterIntro());
              },
            ),
          );
        } else ui.say(scene("walkie-again"));
        return;
      case "office:board":
        if (this.flags.has("home") && !this.flags.has("job2")) {
          ui.say(
            scene("board-wo2"),
            () => {
              this.note("wo2-pen");
              this.takeLaundromat();
              events.emit("job");
            },
          );
          return;
        }
        if (this.flags.has("job")) {
          ui.say(scene("board-empty"));
          return;
        }
        ui.say(
          scene("board-wo1"),
          () => {
            this.note("wo1-pen");
            this.flags.add("job");
            events.emit("job");
          },
        );
        return;
      case "office:gary":
        audio.garyBang();
        if (!this.flags.has("gary")) {
          this.flags.add("gary");
          ui.say(scene("gary-meet"));
        } else if (!this.flags.has("gary2")) {
          this.flags.add("gary2");
          ui.say(scene("gary-meet2"));
        } else ui.say(pick("gary-tips", this.garyTip++));
        return;
      case "office:photo":
        ui.say(scene("photo"));
        return;
      case "office:desk":
        if (this.flags.has("ask-grimoire") && !this.flags.has("grimoire")) return this.findGrimoire();
        ui.say(scene("desk-sticky"), () => this.note("bob-sticky"));
        return;
      case "office:coffee":
        // The save point: a cup of coffee saves the game.
        ui.say(scene("coffee"), () =>
          ui.choose(scene("coffee-ask")[0], [
            {
              label: "Drink some coffee",
              run: () => {
                writeSave(this.snapshot());
                ui.say(scene("coffee-drink"));
              },
            },
            { label: "Leave it", run: () => {} },
          ]),
        );
        return;
      case "office:cabinet":
        ui.say(scene("cabinet"), () => this.note("bellwether"));
        return;
      case "office:exit":
        if (!this.flags.has("walkie")) ui.say(scene("exit-no-walkie"));
        else if (!this.flags.has("job")) ui.say(scene("exit-no-ticket"));
        else {
          const go: Partial<Record<SiteId, () => void>> = { quikstop: () => this.travel("shop") };
          if (this.flags.has("job2")) go.laundromat = () => this.travel("laundromat");
          ui.openTownMap("bobs", go);
        }
        return;

      // ---- the shop ----
      case "shop:finch":
      case "shop:counter":
        return this.talkToFinch();
      case "shop:register":
        ui.openLaptop(register, "PC0 · Register", PC_HINT);
        return;
      case "shop:office":
        ui.openLaptop(office, "PC1 · Back Office", PC_HINT);
        return;
      case "shop:desk":
        ui.say(scene("shop-desk"), () => this.note("finch-calendar"));
        return;
      case "shop:rack":
        ui.choose(scene("shop-rack")[0], [
          { label: "Cable the back of the rack", run: () => ui.openPanel([r1, s1, register, office]) },
          { label: `Console into R1 (${r1.model})`, run: () => ui.openLaptop(r1, `R1 · ${r1.model} · console`, IOS_HINT) },
          { label: `Console into S1 (${s1.model})`, run: () => ui.openLaptop(s1, `S1 · ${s1.model} · console`, IOS_HINT) },
          { label: "Never mind", run: () => {} },
        ]);
        return;
      case "shop:cooler":
        if (this.flags.has("haunt")) {
          ui.say(scene("cooler-haunted"));
        } else {
          ui.say(scene("cooler"));
        }
        return;
      case "shop:shelf1":
      case "shop:shelf2":
        audio.teethJar();
        ui.say(scene("shelves"));
        return;
      case "shop:jack":
        if (!this.flags.has("haunt")) {
          ui.say(scene("jack"));
          return;
        }
        ui.choose(scene("jack-haunted")[0], [
          {
            label: "Pull it out",
            run: () => ui.apparition(() => ui.say(scene("jack-pull"))),
          },
          { label: "Leave it", run: () => {} },
        ]);
        return;
      case "shop:exit":
        if (this.flags.has("done")) ui.openTownMap("quikstop", { bobs: () => this.travel("office") });
        else ui.say(scene("shop-exit-early"));
        return;
    }
  }

  /** Press E on something in the laundromat. */
  private interactLaundromat(id: string): void {
    const job = this.wash;
    const ui = this.ui;
    if (!job) return;
    const { r1, s1, kiosk, office, printer } = job;
    switch (id) {
      case "gus":
      case "counter":
        return this.talkToGus();
      case "rack":
        ui.choose(scene("wash-rack")[0], [
          { label: `Console into R1 (${r1.model})`, run: () => ui.openLaptop(r1, `R1 · ${r1.model} · console`, IOS_HINT) },
          { label: `Console into S1 (${s1.model})`, run: () => ui.openLaptop(s1, `S1 · ${s1.model} · console`, IOS_HINT) },
          { label: "Check the cables", run: () => ui.openPanel([r1, s1, kiosk, office, printer]) },
          { label: "Never mind", run: () => {} },
        ]);
        return;
      case "kiosk":
        ui.openLaptop(kiosk, "PC0 · Change kiosk", DHCP_HINT);
        return;
      case "office":
        ui.openLaptop(office, "PC1 · Gus's office", DHCP_HINT);
        return;
      case "printer":
        ui.openLaptop(printer, "PRN · Printer", PRINTER_HINT, { printer: true });
        return;
      case "backdoor":
        if (!this.flags.has("keys")) {
          ui.say(scene("backdoor-locked"));
          return;
        }
        this.flags.add("open:laundromat:backdoor");
        events.emit("open", "backdoor");
        ui.say(scene("backdoor-open"));
        return;
      case "desk":
        ui.say(scene("wash-desk"));
        return;
      case "logbook":
        ui.say(scene("logbook"), () => this.note("gus-log"));
        return;
      case "archive":
        ui.say(scene("archive"));
        return;
      case "dryer4":
        if (this.flags.has("seen-dryer4")) {
          ui.say(scene("dryer4-again"));
          return;
        }
        this.flags.add("seen-dryer4");
        ui.say(scene("dryer4-first"));
        return;
      case "dryers":
        ui.say(scene("dryers"));
        return;
      case "washers":
        ui.say(scene("washers"));
        return;
      case "lostfound":
        ui.say(scene("lostfound"), () => this.note("lostfound"));
        return;
      case "change":
        ui.say(scene("change"));
        return;
      case "soap":
        ui.say(scene("soap"));
        return;
      case "toilet":
        ui.say(scene("toilet"), () => this.note("guestbook"));
        return;
      case "exit":
        if (this.flags.has("done2")) ui.openTownMap("laundromat", { bobs: () => this.travel("office"), quikstop: () => this.travel("shop") });
        else ui.say(scene("wash-exit-early"));
        return;
    }
  }

  private talkToGus(): void {
    const ui = this.ui;
    if (!this.flags.has("gus")) {
      this.flags.add("gus");
      ui.say(scene("gus-meet"));
      this.flags.add("keys");
      return;
    }
    if (this.flags.has("haunt2")) {
      ui.say(scene("gus-haunted"));
      return;
    }
    ui.say(pick("gus-idle", this.gusLine++));
  }

  private talkToFinch(): void {
    if (!this.flags.has("finch")) {
      this.flags.add("finch");
      this.ui.say(scene("finch-meet"));
      return;
    }
    if (this.flags.has("haunt")) {
      this.ui.say(scene("finch-haunted"));
      return;
    }
    this.ui.say(pick("finch-idle", this.finchLine++));
  }

  /** Walter's welcome, once the lights are back after you pick up the walkie. */
  private walterIntro(): void {
    this.ui.say(scene("walkie-intro"));
  }

  /** Q: Walter's hint for wherever you are. */
  callWalter(): void {
    if (!this.flags.has("walkie")) return;
    const lines = this.wash ? this.laundromatHint(this.wash) : this.storeHint();
    // Over a laptop or PC he comes through on a strip at the top, so you can keep typing.
    if (this.ui.onScreen) this.ui.radio(lines);
    else this.ui.say(lines);
  }

  /** Walter's hint for job 1, by where you are and the first task that isn't done. */
  private storeHint(): Line[] {
    const done = (id: string) => this.done(id);
    if (this.flags.has("home")) return scene("hint-home");
    if (!this.flags.has("job")) return scene("hint-board");
    if (this.room === "office" && !this.flags.has("done")) return scene("hint-front-door");
    if (this.flags.has("done")) return scene("hint-done");
    if (!done("cable")) return scene("hint-cable");
    if (!done("r1-name")) return scene("hint-r1-name");
    if (!done("r1-secret")) return scene("hint-r1-secret");
    if (!done("r1-console")) return scene("hint-r1-console");
    if (!done("router")) return scene("hint-router");
    if (!done("r1-save")) return scene("hint-r1-save");
    if (!done("s1-name")) return scene("hint-s1-name");
    if (!done("s1-secret")) return scene("hint-s1-secret");
    if (!done("s1-console")) return scene("hint-s1-console");
    if (!done("s1-save")) return scene("hint-s1-save");
    if (!done("register")) return scene("hint-register");
    if (!done("office")) return scene("hint-office");
    if (!done("ping-router")) return scene("hint-ping-router");
    return scene("hint-ping-pc");
  }

  /** Walter's hint for job 2, by the first task that isn't done. */
  private laundromatHint(job: Scenario): Line[] {
    const ok = (i: number) => !!job.tasks[i].done?.();
    if (this.flags.has("grimoire")) return scene("hint2-grimoire");
    if (this.flags.has("ask-grimoire")) return scene("hint2-ask-grimoire");
    if (this.flags.has("done2")) return scene("hint2-done");
    if (this.room !== "laundromat") return scene("hint2-travel");
    if (!this.flags.has("keys")) return scene("hint2-keys");
    if (!this.flags.has("open:laundromat:backdoor")) return scene("hint2-backdoor");
    if (!ok(0)) return scene("hint2-router");
    if (!ok(1)) return scene("hint2-excluded");
    if (!ok(2)) return scene("hint2-pool");
    if (!ok(3)) return scene("hint2-printer");
    if (!ok(4)) return scene("hint2-renew");
    if (!ok(5)) return scene("hint2-ping");
    return scene("hint2-binding");
  }

  /** Watches the network a few times a second and reacts as tasks get done. */
  tick(): void {
    // Walter's on the radio over a laptop or PC once you have the walkie.
    this.ui.radioCall = this.flags.has("walkie") ? () => this.callWalter() : null;
    if (this.wash) return this.tickLaundromat(this.wash);
    const done = (id: string) => this.done(id);
    const once = (id: string, lines: Line[]) => {
      if (this.told.has(id) || !done(id)) return;
      this.told.add(id);
      this.ui.say(lines);
    };
    once("cable", scene("done-cable"));
    once("r1-name", scene("done-r1-name"));
    once("r1-save", scene("done-r1-save"));
    once("s1-console", scene("done-s1-console"));
    once("router", scene("done-router"));
    if (done("register") && done("office")) once("office", scene("done-pcs"));
    once("ping-router", scene("done-ping-router"));
    if (this.store.tasks.every((t) => !t.done || t.done()) && !this.flags.has("haunt")) this.haunt();
  }

  /** The job's done, so something else plugs in. */
  private haunt(): void {
    this.flags.add("haunt");
    const { net, s1 } = this.store;
    // The last task ticks off and the lights stutter.
    events.emit("flicker");
    window.setTimeout(() => {
      events.emit("flicker");
      this.phantom.configure(ip("192.168.1.66"), ip("255.255.255.0"), null);
      net.connect(this.phantom.nic, s1.port("FastEthernet0/24"));
      // It doesn't come out. Trying, at the rack or at the wall, gets you the apparition.
      this.ui.bindCable(s1.port("FastEthernet0/24"));
      events.emit("haunt");
      this.phantomHellos();
      this.ui.say(scene("haunt-job1"), () => this.flags.add("done"));
    }, 1500);
  }

  private tickLaundromat(job: ReturnType<typeof laundromat>): void {
    const ok = (i: number) => !!job.tasks[i].done?.();
    const once = (i: number, lines: Line[]) => {
      if (this.told.has(`wash${i}`) || !ok(i)) return;
      this.told.add(`wash${i}`);
      this.ui.say(lines);
    };
    once(0, scene("wash-done-router"));
    once(2, scene("wash-done-pool"));
    once(4, scene("wash-done-leases"));
    // Once the network work is done, Walter asks for one last look at the lease list.
    const networkDone = job.tasks.every((t) => t.id === "binding" || !t.done || t.done());
    if (networkDone && !this.flags.has("ask-binding")) {
      this.flags.add("ask-binding");
      this.bindingFrom = job.r1.console.history.length;
      this.ui.say(scene("wash-ask-binding"));
    }
    if (this.flags.has("ask-binding") && !this.flags.has("checked")) {
      const typed = job.r1.console.history.slice(this.bindingFrom);
      if (typed.some(isShowDhcpBinding)) {
        this.flags.add("checked");
        // Give the real table a moment on screen first.
        window.setTimeout(() => this.hauntLaundromat(job), 1400);
      }
    }
  }

  /**
   * Job 2's haunt. Under the real leases in show ip dhcp binding, a third one statics in: the
   * network address itself, leased to a dryer's MAC, expiring in 1974. Then it's gone.
   */
  private hauntLaundromat(job: ReturnType<typeof laundromat>): void {
    this.flags.add("haunt2");
    const ghost = `${"192.168.20.0".padEnd(20)}${"0166.6666.6666.04".padEnd(24)}${"Oct 14 1974 03:14 AM".padEnd(24)}Automatic`;
    this.ui.ghostLine(
      job.r1,
      ghost,
      () => events.emit("flicker"),
      () => {
        events.emit("haunt");
        this.ui.say(
          scene("haunt-job2"),
          () => {
            this.flags.add("done2");
            // Whatever is on the other end of Fa0/24 has grown since the store.
            this.ui.beingStage = 2;
            const card = this.ui.showCard(
              `<p class="big">Work order #0002 complete</p>
               <p>LEASES ISSUED <b>2</b></p>
               <p>CUSTOMER SATISFACTION <b>ETERNAL</b></p>
               <p class="vanish">BOUNDARY INTEGRITY <b>99.6%</b></p>`,
              undefined,
              4000,
            );
            window.setTimeout(() => card.querySelector(".vanish")?.classList.add("gone"), 2500);
          },
        );
      },
    );
  }

  /** Pins a note into the grimoire. Notes read before you have the book wait for it. */
  private note(id: keyof typeof NOTES): void {
    if (this.notes.includes(id)) return;
    this.notes.push(id);
    if (this.flags.has("grimoire")) bookToast(`Pinned into the grimoire: ${NOTES[id].from}`);
  }

  /** Bob's bottom drawer, after the laundromat. The cover's eyes are shut. Mostly. */
  private findGrimoire(): void {
    const ui = this.ui;
    ui.say(scene("grimoire-drawer"), () => {
      ui.glimpse("assets/cards/grimoire-asleep.webp", "assets/cards/grimoire-awake.webp");
      ui.say(
        [...scene("grimoire-find"), ...(this.flags.has("walkie") ? scene("grimoire-find-walter") : []), ...scene("grimoire-got")],
        () => {
          this.flags.add("grimoire");
          events.emit("grimoire");
          if (this.notes.length) bookToast(`${this.notes.length} note${this.notes.length === 1 ? "" : "s"} you found are pinned inside.`);
        },
      );
    });
  }

  /** G: the grimoire, if you have it. Closing it the first time ends the slice. */
  openGrimoire(): void {
    if (!this.flags.has("grimoire")) return;
    this.ui.openBook(this.bookContents(), () => {
      if (this.flags.has("slice-end")) return;
      this.flags.add("slice-end");
      this.ui.showCard(`<p class="big">End of the laundromat slice</p><p>Thanks for playing the grey box. Press E to keep walking around.</p>`);
    });
  }

  private bookContents(): BookContents {
    const { store, wash } = this;
    const sites: BookContents["sites"] = [
      { number: store.workOrder.number, name: store.workOrder.client, net: store.net, layout: store.layout, devices: [store.r1, store.s1, store.register, store.office], done: this.flags.has("done") },
    ];
    if (wash) {
      sites.push({ number: wash.workOrder.number, name: wash.workOrder.client, net: wash.net, layout: wash.layout, devices: [wash.r1, wash.s1, wash.kiosk, wash.office, wash.printer], done: this.flags.has("done2") });
    }
    return { notes: [...this.notes], sites: this.flags.has("job") ? sites : [] };
  }

  /**
   * A trip across town is a loading screen: the posters, a ping and a tip, and the town's
   * population, which goes up by one after each haunted job. It lifts a beat after the room is
   * ready, and the room's story waits for it.
   */
  private travel(to: RoomId): void {
    const pop = (4218 + (this.flags.has("done") ? 1 : 0) + (to === "office" && this.flags.has("done2") ? 1 : 0)).toLocaleString("en-US");
    const loading = showLoading(`WELCOME TO STATIC SPRINGS · POP. ${pop}`);
    let lift!: () => void;
    const gate = new Promise<void>((r) => (lift = r));
    events.once("room-ready", () => void loading.finish().then(lift));
    events.emit("goto", to, gate);
  }
}
