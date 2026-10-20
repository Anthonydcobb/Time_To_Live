import Phaser from "phaser";
import { parseIpv4 as ip } from "../sim/addr";
import { Pc } from "../sim/devices/pc";
import { BASICS, Grimoire } from "../sim/grimoire";
import { cornerStore } from "../sim/scenarios/corner-store";
import type { RoomId } from "./rooms";
import type { Line, Ui } from "./ui";

/** Scene events: "goto" (room), "flicker", "haunt". */
export const events = new Phaser.Events.EventEmitter();

const W = "WALTER (walkie)";
const G = "GARY (through the door)";
const F = "MRS. FINCH";
const PC_HINT = "On a PC: ipconfig 192.168.1.10 255.255.255.0 192.168.1.1   ·   Esc closes the laptop";
const IOS_HINT = "? lists commands   ·   Tab completes   ·   Esc closes the laptop";

const GARY_TIPS: Line[][] = [
  [{ who: G, text: "Remember, no shutdown turns an interface on. Two negatives! I think that's sort of charming." }],
  [{ who: G, text: "If the first ping drops a packet, that's usually just ARP finding its way. Try it again before you worry." }],
  [{ who: G, text: "Is Walter being mean about me again? That's all right. He's had a long year. A long lot of years." }],
  [{ who: G, text: "Save your work with copy running-config startup-config. Things that aren't saved don't really stay." }],
  [{ who: G, text: "show ip interface brief is my favorite. Everything you need on one screen, and nobody yells." }],
];

/**
 * The corner store slice: who says what, and when. It owns the job's
 * network and reads it to decide what happens next.
 */
export class Story {
  readonly job = cornerStore({ cabled: false });
  /** Plugged into S1 Fa0/24 when the job is done. The cable goes into the wall. */
  readonly phantom = new Pc("PHANTOM", "?", "666666666666");
  room: RoomId = "office";
  private readonly flags = new Set<string>();
  private garyTip = 0;
  private finchLine = 0;
  private told = new Set<string>();

  constructor(private readonly ui: Ui) {
    this.job.net.add(this.phantom);
    const grimoire = new Grimoire([...BASICS, ...this.job.incantations]);
    const { r1, s1, register, office } = this.job;
    r1.console.grimoire = grimoire;
    s1.console.grimoire = grimoire;
    // Story Mode: the setup dialog gets angrier each time you say yes.
    r1.console.story = true;
    s1.console.story = true;
    ui.attach(this.job.net, [r1, s1, register, office], this.job.layout);
  }

  /** Whether the work order line with this id is done right now. */
  private done(id: string): boolean {
    return !!this.job.tasks.find((t) => t.id === id)?.done?.();
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
        ],
        () =>
          this.ui.showCard(
            `<p class="big">End of the corner store slice</p><p>Thanks for playing the grey box. Press E to keep walking around.</p>`,
          ),
      );
    }
  }

  /** Press E on a prop. */
  interact(id: string): void {
    const { r1, s1, register, office } = this.job;
    const ui = this.ui;
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
        ui.say([{ text: "A sticky note on Bob's monitor: \"At the Cryptis quarterly. Sell the upgrade. Everybody needs the upgrade. -B\"" }]);
        return;
      case "office:coffee":
        ui.say([{ text: "The coffee machine is warm and full. It isn't plugged in." }]);
        return;
      case "office:cabinet":
        ui.say([{ text: "Invoices, all paid in full, all from addresses on Elm and Elm. The bottom drawer is labeled BELLWETHER and is empty." }]);
        return;
      case "office:exit":
        if (!this.flags.has("walkie")) ui.say([{ text: "You should grab the walkie-talkie off the charger first." }]);
        else if (!this.flags.has("job")) ui.say([{ who: W, text: "Whoa whoa whoa. No ticket, no trip. Job board, kid. Over." }]);
        else ui.openTownMap("bobs", { quikstop: () => this.travel("shop") }, { haunted: this.flags.has("haunt") });
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
        ui.say([{ text: "A desk calendar, still on October 1987. Every day is crossed off, including the ones that haven't happened." }]);
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
            { text: "An Ethernet cable runs out the back of it and into the wall. You didn't put it there. Nobody did." },
          ]);
        } else {
          ui.say([{ text: "BACK COOLER. A handwritten sign: DO NOT RESTOCK. Inside is milk dated October 1987. It's very cold." }]);
        }
        return;
      case "shop:shelf1":
      case "shop:shelf2":
        ui.say([{ text: "Canned soup, motor oil, and a jar of something labeled TEETH (ASSORTED). Reasonably priced." }]);
        return;
      case "shop:jack":
        ui.say([{ text: "A wall jack. According to the work order, nothing in the shop uses it." }]);
        return;
      case "shop:exit":
        if (this.flags.has("done")) ui.openTownMap("quikstop", { bobs: () => this.travel("office") }, { haunted: this.flags.has("haunt") });
        else ui.say([{ who: W, text: "Leaving already? The ticket's not done, kid. Mrs. Finch is counting on you. So is... no one else. Over." }]);
        return;
    }
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
    const done = (id: string) => this.done(id);
    let text: string;
    if (!this.flags.has("job")) text = "The JOB BOARD, kid. The big cork thing on the wall. Over.";
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

  /** Watches the network a few times a second and reacts as tasks get done. */
  tick(): void {
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
    if (this.job.tasks.every((t) => !t.done || t.done()) && !this.flags.has("haunt")) this.haunt();
  }

  /** The job's done, so something else plugs in. */
  private haunt(): void {
    this.flags.add("haunt");
    const { net, s1 } = this.job;
    window.setTimeout(() => {
      events.emit("flicker");
      this.phantom.configure(ip("192.168.1.66"), ip("255.255.255.0"), null);
      net.connect(this.phantom.nic, s1.port("FastEthernet0/24"));
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

  private travel(to: RoomId): void {
    const pop = to === "office" && this.flags.has("done") ? "4,219" : "4,218";
    this.ui.showCard(`<p class="sign">WELCOME TO<br>STATIC SPRINGS</p><p class="sign small">POP. ${pop}</p>`, () => events.emit("goto", to), 1500);
  }
}
