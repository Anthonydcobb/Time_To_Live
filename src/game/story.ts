import Phaser from "phaser";
import { parseIpv4 as ip } from "../sim/addr";
import { Pc } from "../sim/devices/pc";
import { BASICS, Grimoire } from "../sim/grimoire";
import { cornerStore } from "../sim/scenarios/corner-store";
import { laundromat } from "../sim/scenarios/laundromat";
import type { Scenario } from "../sim/scenarios/types";
import { bookToast, NOTES, type BookContents } from "./grimoire-book";
import type { RoomId } from "./rooms";
import type { SiteId } from "./town-map";
import type { Line, Ui } from "./ui";

/** Scene events: "goto" (room), "flicker", "haunt". */
export const events = new Phaser.Events.EventEmitter();

const W = "WALTER (walkie)";
const G = "GARY (through the door)";
const F = "MRS. FINCH";
const GUS = "GUS";
const PC_HINT = "On a PC: ipconfig 192.168.1.10 255.255.255.0 192.168.1.1   ·   Esc closes the laptop";
const DHCP_HINT = "ipconfig /renew asks the router for a lease   ·   ipconfig shows what you got   ·   Esc closes";
const PRINTER_HINT = "Fixed address: ipconfig 192.168.20.5 255.255.255.0 192.168.20.1   ·   Esc closes";
const IOS_HINT = "? lists commands   ·   Tab completes   ·   Esc closes the laptop";

const GARY_TIPS: Line[][] = [
  [{ who: G, text: "Remember, no shutdown turns an interface on. Two negatives! I think that's sort of charming." }],
  [{ who: G, text: "If the first ping drops a packet, that's usually just ARP finding its way. Try it again before you worry." }],
  [{ who: G, text: "Is Walter being mean about me again? That's all right. He's had a long year. A long lot of years." }],
  [{ who: G, text: "Save your work with copy running-config startup-config. Things that aren't saved don't really stay." }],
  [{ who: G, text: "show ip interface brief is my favorite. Everything you need on one screen, and nobody yells." }],
];

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
    this.wire([r1, s1]);
    ui.attach(this.store.net, [r1, s1, register, office], this.store.layout);
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
    this.flags.add("job2");
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
    if (room === "office" && !this.flags.has("intro")) {
      this.flags.add("intro");
      this.ui.say([{ text: "The office is empty. Somewhere on a desk, a walkie-talkie crackles." }]);
    }
    if (room === "shop" && !this.flags.has("arrived")) {
      this.flags.add("arrived");
      this.ui.say([
        { who: W, text: "Quik-Stop Forever! Finest gas station without any gas in the county." },
        { who: W, text: "Rack's in the back office. Nothing's plugged in yet, so cable it up first: router to switch, PCs to switch. Then console in and make it SING." },
        { who: W, text: "Then the two PCs. Register up front, other one in back. Over!" },
      ]);
    }
    if (room === "office" && this.flags.has("done") && !this.flags.has("home")) {
      this.flags.add("home");
      this.ui.say(
        [
          { who: W, text: "Job one, DONE! Confetti! Imagine confetti. Bob doesn't pay for real confetti." },
          { who: W, text: "...You didn't see anything weird out there, did you? No? Good. Good." },
          { who: G, text: "You did really well today. I'm proud of you." },
          { who: W, text: "DON'T LISTEN TO HIM. Over." },
          { who: W, text: "Oh, and kid? Fresh ticket on the job board. The laundromat out on Route 9. Gus has been calling since... well. Since. Over." },
        ],
      );
    }
    if (room === "laundromat" && !this.flags.has("arrived2")) {
      this.flags.add("arrived2");
      this.ui.say([
        { who: W, text: "Spin Cycle Eternal! Open twenty-four hours a day, every day, fifty-one years running. Gus has never closed it. Gus has never LEFT it." },
        { who: W, text: "Good news: it's all cabled. Bad news: the PCs want an address *handed* to them, automatic-like. That's DHCP. The router does the handing." },
        { who: W, text: "Rack's in Gus's back office, through the back door. Gus has the keys; he's in his booth. And kid? Don't stare into the dryers. They stare back, and it's awkward for everybody. Over." },
      ]);
    }
    if (room === "office" && this.flags.has("done2") && !this.flags.has("home2")) {
      this.flags.add("home2");
      this.ui.say(
        [
          { who: W, text: "Two for two! You're a natural, kid. A natural what, I haven't decided." },
          { who: W, text: "Bob's going to be thrilled. Bob is going to be... somewhere. Over." },
          { who: G, text: "Did Dryer 4 get an address? I hope it did. Everybody should have somewhere to be." },
          { who: W, text: "Kid. Before you clock out. Two jobs means you've earned the book." },
          { who: W, text: "Bob's desk, bottom drawer. Every tech gets a *grimoire* sooner or later. The incantations are all in it, and whatever you pick up out there goes in it too." },
          { who: W, text: "Don't let it read you first. Over." },
        ],
        () => this.flags.add("ask-grimoire"),
      );
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
          ui.say([
            { who: W, text: "Is this thing on? Course it's on. Everything's on. That's the trouble with everything." },
            { who: W, text: "WELCOME, welcome, welcome, new hire, to Bob's Bandwidth and Bloodletting! Ding ding ding! You have unlocked: a job!" },
            { who: W, text: "Name's Walter. Senior technician. Very senior. Senior like a cheese, kid." },
            { who: W, text: "Bob's not in. Bob's never in. Bob is a concept, like weekends." },
            { who: W, text: "Ticket's on the job board. Go to the store, make the little lights go green. Green is good. Amber is thinking. Off is... we don't talk about off." },
            { who: W, text: "And whatever you hear behind that red door, you do NOT open it. Not that you could. Ha! Ha. Over." },
            { text: "You clip the walkie to your belt. Press Q to call Walter." },
          ]);
        } else ui.say([{ text: "The charger is empty. The walkie is on your belt." }]);
        return;
      case "office:board":
        if (this.flags.has("home") && !this.flags.has("job2")) {
          ui.say(
            [
              { text: "WORK ORDER #0002. Spin Cycle Eternal, the 24-hour laundromat on Route 9. Night manager: Gus." },
              { text: "Everything is cabled. The PCs are set to get an address automatically, but nothing on the router is set up to give them one." },
              { text: "Someone has added in pen: Dryer 4 is not a customer." },
            ],
            () => {
              this.note("wo2-pen");
              this.takeLaundromat();
              events.emit("job");
            },
          );
          return;
        }
        if (this.flags.has("job")) {
          ui.say([{ text: "The board is empty except for a pin with a bit of paper still under it." }]);
          return;
        }
        ui.say(
          [
            { text: "WORK ORDER #0001. Quik-Stop Forever, corner of Elm and Elm. Owner: Mrs. Finch." },
            { text: "The router and switch are in the rack. The cables from both PCs are run to it, but nothing is plugged in or configured." },
            { text: "Someone has added in pen: Do not restock the back cooler." },
          ],
          () => {
            this.note("wo1-pen");
            this.flags.add("job");
            events.emit("job");
          },
        );
        return;
      case "office:gary":
        if (!this.flags.has("gary")) {
          this.flags.add("gary");
          ui.say([
            { text: "You knock. Something on the other side stands up from a very comfortable chair." },
            { who: G, text: "Oh! Hi! You must be the new technician. I'm Gary." },
            { who: G, text: "I'd shake your hand, but the door's locked. It's always locked. That's okay! I've got a nice chair in here." },
            { who: G, text: "Little tip for the store: every device on one network needs an address in the same subnet. You're going to do great." },
            ...(this.flags.has("walkie")
              ? [
                  { who: W, text: "Was that GARY? Don't talk to Gary. Gary knows what he did." },
                  { who: W, text: "...I don't know what he did. But he KNOWS. Over." },
                ]
              : []),
          ]);
        } else ui.say(GARY_TIPS[this.garyTip++ % GARY_TIPS.length]);
        return;
      case "office:photo":
        ui.say([{ text: "EMPLOYEE OF THE MONTH, OCTOBER 1987: Walter. He looks exactly like he sounds. The photo is still warm." }]);
        return;
      case "office:desk":
        if (this.flags.has("ask-grimoire") && !this.flags.has("grimoire")) return this.findGrimoire();
        ui.say([{ text: "A sticky note on Bob's monitor: \"At the Cryptis quarterly. Sell the upgrade. Everybody needs the upgrade. -B\"" }], () => this.note("bob-sticky"));
        return;
      case "office:coffee":
        ui.say([{ text: "The coffee machine is warm and full. It isn't plugged in." }]);
        return;
      case "office:cabinet":
        ui.say([{ text: "Invoices, all paid in full, all from addresses on Elm and Elm. The bottom drawer is labeled *BELLWETHER* and is empty." }], () => this.note("bellwether"));
        return;
      case "office:exit":
        if (!this.flags.has("walkie")) ui.say([{ text: "You should grab the walkie-talkie off the charger first." }]);
        else if (!this.flags.has("job")) ui.say([{ who: W, text: "Whoa whoa whoa. No ticket, no trip. Job board, kid. Over." }]);
        else {
          const go: Partial<Record<SiteId, () => void>> = { quikstop: () => this.travel("shop") };
          if (this.flags.has("job2")) go.laundromat = () => this.travel("laundromat");
          ui.openTownMap("bobs", go, { haunted: this.flags.has("haunt") });
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
        ui.say([{ text: "A desk calendar, still on October 1987. Every day is crossed off, including the ones that haven't happened." }], () => this.note("finch-calendar"));
        return;
      case "shop:rack":
        ui.choose({ text: "The rack hums. A light-blue console cable hangs off the side, waiting for your laptop." }, [
          { label: "Cable the back of the rack", run: () => ui.openPanel([r1, s1, register, office]) },
          { label: `Console into R1 (${r1.model})`, run: () => ui.openLaptop(r1, `R1 · ${r1.model} · console`, IOS_HINT) },
          { label: `Console into S1 (${s1.model})`, run: () => ui.openLaptop(s1, `S1 · ${s1.model} · console`, IOS_HINT) },
          { label: "Never mind", run: () => {} },
        ]);
        return;
      case "shop:cooler":
        if (this.flags.has("haunt")) {
          ui.say([
            { text: "The cooler hums a little louder than before." },
            { text: "An Ethernet cable runs out the back of it and into the wall. You didn't put it there. ~Nobody did.~" },
          ]);
        } else {
          ui.say([{ text: "BACK COOLER. A handwritten sign: DO NOT RESTOCK. Inside is milk dated October 1987. It's very cold." }]);
        }
        return;
      case "shop:shelf1":
      case "shop:shelf2":
        ui.say([{ text: "Canned soup, motor oil, and a jar of something labeled ~TEETH (ASSORTED)~. Reasonably priced." }]);
        return;
      case "shop:jack":
        if (!this.flags.has("haunt")) {
          ui.say([{ text: "A wall jack. According to the work order, nothing in the shop uses it." }]);
          return;
        }
        ui.choose({ text: "A blue cable is seated in the jack. Nobody ran it. ~The plastic is warm.~" }, [
          {
            label: "Pull it out",
            run: () => ui.apparition(() => ui.say([{ text: "The cable is *still in the jack*. Your hand is ~cold to the elbow~." }])),
          },
          { label: "Leave it", run: () => {} },
        ]);
        return;
      case "shop:exit":
        if (this.flags.has("done")) ui.openTownMap("quikstop", { bobs: () => this.travel("office") }, { haunted: this.flags.has("haunt") });
        else ui.say([{ who: W, text: "Leaving already? The ticket's not done, kid. Mrs. Finch is counting on you. So is... no one else. Over." }]);
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
        ui.choose({ text: "Gus's rack. Everything's cabled already, neat as a pin. The labels are typewritten, from 1974." }, [
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
        ui.openLaptop(printer, "PRN · Printer", PRINTER_HINT);
        return;
      case "backdoor":
        if (!this.flags.has("keys")) {
          ui.say([{ text: "BACK OFFICE. EMPLOYEES ONLY. Locked, and it's a heavy old door. Gus will have the key." }]);
          return;
        }
        this.flags.add("open:laundromat:backdoor");
        events.emit("open", "backdoor");
        ui.say([{ text: "The key turns like it's been waiting for you. Behind the door, the hum of a rack and the smell of warm dust." }]);
        return;
      case "desk":
        ui.say([{ text: "Gus's desk. A coffee mug that says WORLD'S OKAYEST MANAGER, still steaming. The coffee is from 1974 too." }]);
        return;
      case "logbook":
        ui.say([
          { text: "GUS'S SHIFT LOG. The first page: 10/14/1974, Gus on shift. All machines spinning." },
          { text: "Every page after it says the same thing, in the same handwriting, with the same pen." },
          { text: "The newest entry is in capitals: DRYER 4 WON'T STOP ASKING FOR AN ADDRESS. ~0.0.0.0~" },
          ...(this.flags.has("walkie")
            ? [{ who: W, text: "Zero-dot-zero-dot-zero-dot-zero. That's what a machine calls itself before anybody's given it a name. Weird thing for a dryer to say. Over." }]
            : []),
        ], () => this.note("gus-log"));
        return;
      case "archive":
        ui.say([{ text: "Boxes of old logbooks, labeled by year. 1974. 1974. 1974. 1974. 1974." }]);
        return;
      case "dryer4":
        if (this.flags.has("seen-dryer4")) {
          ui.say([{ text: "Dryer 4 is still turning. Fog on the glass, clothes going round. *Nothing else.* You're nearly sure." }]);
          return;
        }
        this.flags.add("seen-dryer4");
        ui.say([
          { text: "DRYER 4. A sign taped to it says OUT OF ORDER, in handwriting from 1974. It's running anyway." },
          { text: "There was ~something against the glass~. Now there's only fog, and somebody's clothes going round." },
        ]);
        return;
      case "dryers":
        ui.say([{ text: "Industrial dryers, every one of them running, every one of them empty. The coin slots were taped over a long time ago." }]);
        return;
      case "washers":
        ui.say([{ text: "Top-loaders, back to back. One is full of grey water that isn't moving, even though the drum is." }]);
        return;
      case "lostfound":
        ui.say([{ text: "LOST & FOUND. Socks, cracked glasses, two watches stopped at 3:14, a phone handset. And Polaroids of this room, ~taken from inside the dryers~." }], () => this.note("lostfound"));
        return;
      case "change":
        ui.say([{ text: "CHANGE MACHINE. A light says OUT OF CHANGE. It gives you a quarter anyway. The quarter is warm, and dated 1974." }]);
        return;
      case "soap":
        ui.say([{ text: "Detergent, at 1974 prices. Every box rattles like it's full of something smaller than soap." }]);
        return;
      case "toilet":
        ui.say([{ text: "The restroom. A sign on the door: CUSTOMERS ONLY. The guest book inside has one name in it, over and over. Gus." }], () => this.note("guestbook"));
        return;
      case "exit":
        if (this.flags.has("done2")) ui.openTownMap("laundromat", { bobs: () => this.travel("office"), quikstop: () => this.travel("shop") }, { haunted: true });
        else ui.say([{ who: W, text: "Not yet, kid. Gus has been waiting fifty-one years for somebody to finish a job. Don't make it fifty-two. Over." }]);
        return;
    }
  }

  private talkToGus(): void {
    const ui = this.ui;
    if (!this.flags.has("gus")) {
      this.flags.add("gus");
      ui.say([
        { who: GUS, text: "You're from Bob's. Good. Good. I called it in on... what's today?" },
        { who: GUS, text: "Doesn't matter. The computers keep asking for an address and nobody answers them. I know how they feel." },
        { who: GUS, text: "The kiosk out front, the PC in my office, and the printer. The printer likes its own spot, point five. The others take whatever they're given." },
        { who: GUS, text: "Equipment's in the back office. Here." },
        { text: "Gus slides a ring of keys through the window. One is labeled BACK, in typewriter letters." },
        { who: GUS, text: "Don't mind the dryers. They run on their own. They always have." },
      ]);
      this.flags.add("keys");
      return;
    }
    if (this.flags.has("haunt2")) {
      ui.say([{ who: GUS, text: "Everybody's got an address now. Even the ones that oughtn't. Thank you, kid. Shift's not over, though. It never is." }]);
      return;
    }
    const lines = [
      "Fifty-one years and I've never seen the end of a shift. Funny how that is.",
      "Coffee's in the back if you want it. It's still hot. It's always still hot.",
      "Dryer 4 asks me for an address every night. I tell it I haven't got one to give.",
      "Gave up on the radio in '74. It only ever plays the spin cycle.",
    ];
    ui.say([{ who: GUS, text: lines[this.gusLine++ % lines.length] }]);
  }

  private talkToFinch(): void {
    if (!this.flags.has("finch")) {
      this.flags.add("finch");
      this.ui.say([
        { who: F, text: "Oh good, you're from Bob's! Come in, come in. Mind the puddle. It isn't water, but it's very polite." },
        { who: F, text: "The register and the back office computer can't see each other. Or the router. Or me, frankly." },
        { who: F, text: "All the boxes with the blinking lights are in the back office. The thing that hums is the cooler. Please don't restock the cooler." },
      ]);
      return;
    }
    if (this.flags.has("haunt")) {
      this.ui.say([{ who: F, text: "Oh, don't mind that, dear. The cooler likes to be included. Now, that'll be all, and thank you!" }]);
      return;
    }
    const lines = [
      "Take your time, dear. Time doesn't mind it here.",
      "Would you like a soda? They're from the front cooler. The front one's fine.",
      "My late husband used to say a store's only as good as its network. He said it after he was late, too.",
    ];
    this.ui.say([{ who: F, text: lines[this.finchLine++ % lines.length] }]);
  }

  /** Q: Walter's hint for wherever you are. */
  callWalter(): void {
    if (!this.flags.has("walkie")) return;
    if (this.wash) return this.ui.say([{ who: W, text: this.laundromatHint(this.wash) }]);
    const done = (id: string) => this.done(id);
    let text: string;
    if (this.flags.has("home")) text = "Fresh ticket on the job board, kid. Over.";
    else if (!this.flags.has("job")) text = "The JOB BOARD, kid. The big cork thing on the wall. Over.";
    else if (this.room === "office" && !this.flags.has("done")) text = "Front door, kid. The store won't network itself. It's tried. Over.";
    else if (this.flags.has("done")) text = "You're done! Go home. Don't look at the cooler on the way out. Over.";
    else if (!done("cable")) text = "Cables first! Back of the rack. Router Gi zero slash zero to the switch, and both PC cables into the switch. Amber light means it's thinking about it. Over.";
    else if (!done("r1-name")) text = "Router first, and finish it before you touch anything else. configure terminal, hostname R1. Unnamed things attract attention. Over.";
    else if (!done("r1-secret")) text = "Now lock the door. enable secret, then something only you know. Not 'password'. Gary used 'password'. Over.";
    else if (!done("r1-console")) text = "And the console port. line console 0, password, then login. Otherwise anybody with a blue cable walks right in. Anybody. Over.";
    else if (!done("router")) text = "Router next. In the rack, configure terminal, interface gi0/0, ip address, no shutdown. Incantations, kid! Over.";
    else if (!done("r1-save")) text = "Now save it. copy running-config startup-config. Running config is what it's thinking; startup is what it remembers. Make it remember. Over.";
    else if (!done("s1-name")) text = "Router's done. Switch tab on your laptop, kid. Same three: hostname S1, enable secret, console password. Over.";
    else if (!done("s1-secret")) text = "Enable secret on the switch too. Different from the router's, if you're smart. Over.";
    else if (!done("s1-console")) text = "Switch console: line console 0, password, login. Then the PCs. Over.";
    else if (!done("s1-save")) text = "Save the switch too, same incantation. Then the PCs. Over.";
    else if (!done("register")) text = "The register's at the counter. On a PC it's ipconfig, address, mask, gateway. Over.";
    else if (!done("office")) text = "Now the back office PC. Same deal, point one-one. Over.";
    else if (!done("ping-router")) text = "Ping the router from BOTH PCs. If the first one drops, that's ARP. Not ghosts. Usually. Over.";
    else text = "Last thing: ping one PC from the other. Over.";
    this.ui.say([{ who: W, text }]);
  }

  /** Walter's hint for job 2, by the first task that isn't done. */
  private laundromatHint(job: Scenario): string {
    const ok = (i: number) => !!job.tasks[i].done?.();
    if (this.flags.has("grimoire")) return "Read the book, kid. G. It's better company than Gary. Don't tell him I said that. Over.";
    if (this.flags.has("ask-grimoire")) return "Bob's desk, kid. Bottom drawer. The book's expecting you. Over.";
    if (this.flags.has("done2")) return "You're done! Come on home. And don't take any socks from the lost and found. Over.";
    if (this.room !== "laundromat") return "Route 9, kid. The van's out front. Over.";
    if (!this.flags.has("keys")) return "Gear's behind the back door and Gus has the keys. He's in the booth by the kiosk. Go say hi. Over.";
    if (!this.flags.has("open:laundromat:backdoor")) return "You've got Gus's keys. Back door, top left. Over.";
    if (!ok(0)) return "Router first. interface gi0/0, ip address 192.168.20.1 255.255.255.0, no shutdown. Same as last time, new numbers. Over.";
    if (!ok(1)) return "Now fence off the low addresses so DHCP doesn't hand out the printer's spot. ip dhcp excluded-address 192.168.20.1 192.168.20.20, in global config. Over.";
    if (!ok(2)) return "Now the pool. ip dhcp pool, any name you like, then network 192.168.20.0 255.255.255.0 and default-router 192.168.20.1. That's the router promising to answer. Over.";
    if (!ok(3)) return "The printer doesn't take handouts. On the printer: ipconfig 192.168.20.5 255.255.255.0 192.168.20.1. A fixed address, like a house. Over.";
    if (!ok(4)) return "The PCs asked once, nobody answered, and they sulked. On each one: ipconfig /renew. Over.";
    if (!ok(5)) return "Ping the printer, 192.168.20.5, from both PCs. Over.";
    return "Last thing: on the router, show ip dhcp binding. Make sure it's just our two PCs on the list. Over.";
  }

  /** Watches the network a few times a second and reacts as tasks get done. */
  tick(): void {
    if (this.wash) return this.tickLaundromat(this.wash);
    const done = (id: string) => this.done(id);
    const once = (id: string, lines: Line[]) => {
      if (this.told.has(id) || !done(id)) return;
      this.told.add(id);
      this.ui.say(lines);
    };
    once("cable", [{ who: W, text: "All plugged in! Hear that? That's the sound of lights thinking. Give the switch half a minute to trust everybody. Over." }]);
    once("r1-name", [{ who: W, text: "R1. Nice to meet it. It already knew your name. Over." }]);
    once("r1-save", [{ who: W, text: "Saved! Now R1 remembers you even after a reboot. Everything here remembers. Over." }]);
    once("s1-console", [{ who: W, text: "Locked up tight. Remember those passwords, kid. Writing them on the rack is how Gary started. Over." }]);
    once("router", [{ who: W, text: "Ooh, a green light! I felt that one in my fillings. Now the PCs. Over." }]);
    if (done("register") && done("office")) once("office", [{ who: W, text: "Addresses on both PCs. Look at you, giving things names. Names are boundaries, kid. Boundaries are important. Over." }]);
    once("ping-router", [{ who: W, text: "The router answers! Of course it answers. It's polite. Too polite, some would say. Over." }]);
    if (this.store.tasks.every((t) => !t.done || t.done()) && !this.flags.has("haunt")) this.haunt();
  }

  /** The job's done, so something else plugs in. */
  private haunt(): void {
    this.flags.add("haunt");
    const { net, s1 } = this.store;
    window.setTimeout(() => {
      events.emit("flicker");
      this.phantom.configure(ip("192.168.1.66"), ip("255.255.255.0"), null);
      net.connect(this.phantom.nic, s1.port("FastEthernet0/24"));
      // It doesn't come out. Trying, at the rack or at the wall, gets you the apparition.
      this.ui.bindCable(s1.port("FastEthernet0/24"));
      events.emit("haunt");
      // Once spanning tree lets it through, it says hello to the register now and then.
      const hello = () => {
        if (this.phantom.nic.peer) this.phantom.shell.execute("ping 192.168.1.10");
      };
      window.setTimeout(hello, 40_000);
      window.setInterval(hello, 90_000);
      this.ui.say(
        [
          { text: "The lights flicker. In the back office, a link light clicks on." },
          { who: W, text: "Hm? Fa0/24? Nothing's plugged into twenty-four. You can check the panel if you want. Or don't. I'd don't." },
          { who: W, text: "Anyway! Ticket's DONE! Go tell Mrs. Finch and head home. Over." },
        ],
        () => {
          this.flags.add("done");
          const card = this.ui.showCard(
            `<p class="big">Work order #0001 complete</p>
             <p>NETWORK HEALTH <b>100%</b></p>
             <p>CUSTOMER SATISFACTION <b>EXCELLENT</b></p>
             <p class="vanish">BOUNDARY INTEGRITY <b>99.8%</b></p>`,
            undefined,
            4000,
          );
          window.setTimeout(() => card.querySelector(".vanish")?.classList.add("gone"), 2500);
        },
      );
    }, 1500);
  }

  private tickLaundromat(job: ReturnType<typeof laundromat>): void {
    const ok = (i: number) => !!job.tasks[i].done?.();
    const once = (i: number, lines: Line[]) => {
      if (this.told.has(`wash${i}`) || !ok(i)) return;
      this.told.add(`wash${i}`);
      this.ui.say(lines);
    };
    once(0, [{ who: W, text: "Gi0/0 is up. The router's awake. That's the easy part. Over." }]);
    once(2, [{ who: W, text: "The pool's open! Now anything that asks gets an answer. ANYTHING. ...Ha. Over." }]);
    once(4, [{ who: W, text: "Leases! Both PCs got addresses. show ip dhcp binding on the router lists who's got what. Over." }]);
    // Once the network work is done, Walter asks for one last look at the lease list.
    const networkDone = job.tasks.every((t) => t.id === "binding" || !t.done || t.done());
    if (networkDone && !this.flags.has("ask-binding")) {
      this.flags.add("ask-binding");
      this.bindingFrom = job.r1.console.history.length;
      this.ui.say([
        { who: W, text: "Pings come back, printer's got its spot. Nice work, kid." },
        { who: W, text: "One more thing before you go. On the router: show ip dhcp binding. Make sure it's just our two PCs on the list. Over." },
      ]);
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
          [
            { text: "Every dryer in the place stops at once. In the quiet, one of them starts up again. You don't have to look to know which." },
            { who: W, text: "Kid? Was there a third line on that list just now? Point zero. You can't lease point zero. That's the *network*." },
            { who: W, text: "...No. Two PCs, two leases. That's what the paperwork says, so that's what happened. Ticket's DONE. Tell Gus and come on home. Over." },
          ],
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
    ui.say([{ text: "Bob's desk. The bottom drawer, the one Walter meant, slides open a little before you touch it." }], () => {
      ui.glimpse("assets/cards/grimoire-asleep.webp", "assets/cards/grimoire-awake.webp");
      ui.say(
        [
          { text: "A heavy book, bound in something that isn't leather. A diagram is pressed into the cover: lines, and little shut eyes where the lines meet." },
          { text: "For a second, ~every one of them is open~. Looking at you." },
          { text: "Then they're shut, and they were always shut. It's a book. It's warm, like someone was just holding it." },
          ...(this.flags.has("walkie") ? [{ who: W, text: "Got it? Good. Don't read it in bed. Over." }] : []),
          { text: "You've got the grimoire. Press G to open it." },
        ],
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

  private travel(to: RoomId): void {
    const pop = (4218 + (this.flags.has("done") ? 1 : 0) + (to === "office" && this.flags.has("done2") ? 1 : 0)).toLocaleString("en-US");
    this.ui.showCard(`<p class="sign">WELCOME TO<br>STATIC SPRINGS</p><p class="sign small">POP. ${pop}</p>`, () => events.emit("goto", to), 1500);
  }
}
