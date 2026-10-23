import { audio } from "./audio";
import { parseLine, renderRuns } from "./markup";
import { describeSave, readSave, type SaveData } from "./save";
import { pick } from "./script";
import { TEXT_SPEEDS, type Ui } from "./ui";

/**
 * The screens around the game: the title (New Game, Load Game, Options), the options panel and
 * the loading screen. Plain HTML over the page, shown before the Phaser game starts.
 */

export interface Options {
  /** 0 to 1. */
  music: number;
  sound: number;
  text: keyof typeof TEXT_SPEEDS;
  /** The CRT roll, flicker and scanlines over the picture. */
  effects: boolean;
}

const OPTIONS_KEY = "time-to-live:options";
const DEFAULTS: Options = { music: 1, sound: 1, text: "normal", effects: true };

export function readOptions(): Options {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Partial<Options>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeOptions(o: Options): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    // Options that can't be stored still apply until the page closes.
  }
}

export function applyOptions(o: Options, ui: Ui): void {
  audio.setVolume(o.music, o.sound);
  ui.typeMs = TEXT_SPEEDS[o.text];
  document.body.classList.toggle("no-effects", !o.effects);
}

export type TitleChoice = { kind: "new" } | { kind: "load"; save: SaveData };

const TEXT_LABELS: Record<Options["text"], string> = { slow: "Slow", normal: "Normal", fast: "Fast" };

/** Shows the title screen until you start a new game or load the saved one. */
export function showTitle(ui: Ui): Promise<TitleChoice> {
  const save = readSave();
  const options = readOptions();
  const root = document.createElement("div");
  root.id = "title";
  root.innerHTML = `
    <img class="art" src="assets/screens/title.webp" alt="Time To Live. Every packet has a hop limit." />
    <nav class="menu" aria-label="Main menu">
      <button data-act="new">New Game</button>
      <button data-act="load" ${save ? "" : "disabled"}>Load Game<small>${save ? describeSave(save) : "No saved game"}</small></button>
      <button data-act="options">Options</button>
    </nav>
    <form class="options" hidden>
      <h2>Options</h2>
      <label>Music <input type="range" name="music" min="0" max="1" step="0.05" /></label>
      <label>Sound <input type="range" name="sound" min="0" max="1" step="0.05" /></label>
      <label>Text speed
        <select name="text">${Object.entries(TEXT_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      </label>
      <label class="check"><input type="checkbox" name="effects" /> Screen effects</label>
      <button type="button" data-act="back">Back</button>
    </form>
    <p class="hint">↑ ↓ choose · Enter select</p>`;
  document.body.appendChild(root);

  const menu = root.querySelector<HTMLElement>(".menu")!;
  const form = root.querySelector<HTMLFormElement>(".options")!;
  const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;
  field<HTMLInputElement>("music").value = String(options.music);
  field<HTMLInputElement>("sound").value = String(options.sound);
  field<HTMLSelectElement>("text").value = options.text;
  field<HTMLInputElement>("effects").checked = options.effects;
  form.addEventListener("input", () => {
    options.music = Number(field<HTMLInputElement>("music").value);
    options.sound = Number(field<HTMLInputElement>("sound").value);
    options.text = field<HTMLSelectElement>("text").value as Options["text"];
    options.effects = field<HTMLInputElement>("effects").checked;
    applyOptions(options, ui);
    writeOptions(options);
  });

  const buttons = () => Array.from(root.querySelectorAll<HTMLElement>(form.hidden ? ".menu button:not([disabled])" : ".options input, .options select, .options button"));
  const showOptions = (open: boolean) => {
    form.hidden = !open;
    menu.hidden = open;
    buttons()[0]?.focus();
  };
  // The first button with focus, so Enter works straight away.
  requestAnimationFrame(() => buttons()[0]?.focus());

  return new Promise((resolve) => {
    const finish = (choice: TitleChoice) => {
      window.removeEventListener("keydown", onKey, true);
      root.classList.add("leaving");
      window.setTimeout(() => root.remove(), 500);
      resolve(choice);
    };
    root.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "new") finish({ kind: "new" });
      if (act === "load" && save) finish({ kind: "load", save });
      if (act === "options") showOptions(true);
      if (act === "back") showOptions(false);
    });
    // Up and down move through the menu (left and right still move a slider); Escape backs out
    // of the options.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = buttons();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const step = e.key === "ArrowDown" ? 1 : -1;
        list[(at + step + list.length) % list.length]?.focus();
      }
      if (e.key === "Escape" && !form.hidden) showOptions(false);
      // Keep the game's keys (E, M, J...) from reaching anything else while the title is up.
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/** The ping that runs across the bottom of the loading screen. */
const PING = ["Type escape sequence to abort.", "Sending 5, 100-byte ICMP Echos to 192.168.1.66, timeout is 2 seconds:"];

/** The posters a loading screen cycles through. Each loading screen starts on the next one. */
const POSTERS = ["assets/screens/loading.webp", "assets/screens/title.webp", "assets/screens/poster-montage.webp"];
/** How long each poster holds before it crossfades to the next. */
const POSTER_MS = 2600;
let nextPoster = 0;
/** Which loading tip is next. They come from script/dialogue.md, in order, looping. */
let nextTip = Math.floor(Math.random() * 100);

/**
 * The loading screen, over everything until `finish` is called: the posters crossfading, a ping
 * along the bottom and a help tip in the corner. It stays up for at least `minMs`, and `finish`
 * gives it a beat (the ping completes) before it fades.
 */
export function showLoading(heading: string, minMs = 0): { finish(): Promise<void> } {
  const root = document.createElement("div");
  root.id = "loading";
  const first = nextPoster++;
  const posters = POSTERS.map((_, i) => POSTERS[(first + i) % POSTERS.length]);
  root.innerHTML = `
    ${posters.map((src, i) => `<img class="art${i === 0 ? " on" : ""}" src="${src}" alt="" />`).join("")}
    <div class="ping" role="status">
      <p class="head"></p>
      <p>${PING.join("<br>")}</p>
      <p class="bangs"></p>
    </div>
    <aside class="tip"><b>TIP</b><span></span></aside>`;
  root.querySelector(".head")!.textContent = heading;
  renderRuns(root.querySelector<HTMLElement>(".tip span")!, parseLine(pick("loading-tips", nextTip++)[0]?.text ?? ""));
  document.body.appendChild(root);
  const arts = Array.from(root.querySelectorAll<HTMLElement>(".art"));
  let shownArt = 0;
  const cycle = window.setInterval(() => {
    arts[shownArt].classList.remove("on");
    shownArt = (shownArt + 1) % arts.length;
    arts[shownArt].classList.add("on");
  }, POSTER_MS);
  const bangs = root.querySelector<HTMLElement>(".bangs")!;
  // A timeout first, then replies, like the first ping after ARP.
  const marks = [".", "!", "!", "!", "!"];
  let n = 0;
  const timer = window.setInterval(() => {
    bangs.textContent = marks.slice(0, ++n % (marks.length + 3)).join("");
  }, 300);
  const shown = performance.now();
  return {
    finish: () =>
      new Promise((resolve) => {
        window.setTimeout(
          () => {
            window.clearInterval(timer);
            bangs.innerHTML = `!!!!!<br>Success rate is 100 percent (5/5), round-trip min/avg/max = 1/3/14 ms`;
            // A beat on the finished ping, then the fade.
            window.setTimeout(() => {
              root.classList.add("leaving");
              window.setTimeout(() => {
                window.clearInterval(cycle);
                root.remove();
                resolve();
              }, 600);
            }, 900);
          },
          Math.max(0, minMs - (performance.now() - shown)),
        );
      }),
  };
}
