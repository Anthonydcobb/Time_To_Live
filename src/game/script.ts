/// <reference types="vite/client" />
import raw from "../../script/dialogue.md?raw";
import { parseLine, visibleLength } from "./markup";
import type { Line } from "./ui";

/**
 * The script: every line of dialogue, read from script/dialogue.md. The story asks for scenes by
 * name; the words live in the Markdown so they can be rewritten without touching code. Under
 * `npm run dev`, saving the file swaps the new lines in while the game keeps running.
 *
 * Besides lines, a scene can hold story tags (`#set`, `#if`, `#goto`...) that the game acts on,
 * and `((notes))` for whoever works on the code, which the game never shows.
 */

/** Script names that get a fuller tag on screen. */
const SPEAKERS: Record<string, string> = {
  WALTER: "WALTER (walkie)",
  GARY: "GARY (through the door)",
};
const MOODS: Record<string, 0 | 1 | 2> = { calm: 0, paranoid: 1, frantic: 2 };

/** Stage cues in capitals, like `(LIGHTS FLICKER)`, and the scene event each one fires. */
const CUES: Record<string, string> = {
  "LIGHTS FLICKER": "flicker",
  FLICKER: "flicker",
  "LIGHTS OUT": "blackout",
  "LIGHTS ON": "lights",
};
/** A cue: capitals in brackets. Lower-case brackets are ordinary words, or notes for people. */
const CUE = /\(([A-Z][A-Z !.'-]*)\)/g;

/** `Name: text` or `Name (mood): text`, up to three words of name, in any case. */
const SPOKEN = /^([A-Za-z][A-Za-z0-9.'&-]*(?: [A-Za-z0-9.'&-]+){0,2})\s*(?:\((calm|paranoid|frantic)\))?:\s+(.+)$/;

/** A flag name: letters, digits, dashes, colons. The story's own flags, like `walkie`, work too. */
const FLAG = /^[A-Za-z0-9:_-]+$/;

/** Tags that change the story. Played in order, between the lines around them. */
type Act = { act: "set" | "clear" | "give"; flag: string };
/** `#if flag` (or `#if not flag`) ... `#else` ... `#end`. */
type Branch = { if: string; not: boolean; then: Node[]; else: Node[] };
/** `#goto scene`: plays that scene instead of the rest of this one. */
type Goto = { goto: string };
/** A stage cue alone on a line: fires as the next line starts. */
type Cue = { cue: string };
export type Node = Line | Act | Branch | Goto | Cue;

/** A `((note))` or an unknown `#tag`, for whoever works on the code. The game ignores it. */
export interface Note {
  line: number;
  text: string;
}

export interface ParsedScript {
  scenes: Map<string, Node[]>;
  /** `((notes))` and `#ideas`, in the order they appear. */
  notes: Note[];
  /** Lines that couldn't be read, with their line numbers. */
  errors: string[];
}

export function parseScript(text: string): ParsedScript {
  const scenes = new Map<string, Node[]>();
  const notes: Note[] = [];
  const errors: string[] = [];
  const gotos: { at: string; id: string }[] = [];
  let root: Node[] | null = null;
  /** The `#if` blocks we're inside, innermost last. */
  let open: { branch: Branch; inElse: boolean; at: string }[] = [];
  /** A `((note))` that runs onto the next lines. */
  let note: { line: number; text: string } | null = null;
  let fenced = false;
  const here = (): Node[] => {
    const top = open[open.length - 1];
    return top ? (top.inElse ? top.branch.else : top.branch.then) : root!;
  };
  const closeScene = () => {
    for (const o of open) errors.push(`${o.at}: #if ${o.branch.if} has no #end`);
    open = [];
  };
  /** Takes the cues out of a line's text, remembering how far into the typing each one fires. */
  const withCues = (text: string): Line => {
    const cues: { at: number; event: string }[] = [];
    let out = "";
    let last = 0;
    for (const m of text.matchAll(CUE)) {
      const event = CUES[m[1].trim()];
      // Capitals that aren't a cue, like "TEETH (ASSORTED)", are just words.
      if (!event) continue;
      out += text.slice(last, m.index);
      last = m.index + m[0].length;
      cues.push({ at: visibleLength(parseLine(out)), event });
    }
    out = (out + text.slice(last)).replace(/\s{2,}/g, " ").trim();
    return cues.length ? { text: out, cues } : { text: out };
  };
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const at = `line ${i + 1}`;
    if (rawLine.trim().startsWith("```")) {
      fenced = !fenced;
      return;
    }
    // Examples in the how-to, in code blocks or `backticks`, are neither notes nor lines.
    if (fenced) return;
    let line = rawLine;
    if (note) {
      const end = line.indexOf("))");
      if (end < 0) {
        note.text += " " + line.trim();
        return;
      }
      notes.push({ line: note.line, text: (note.text + " " + line.slice(0, end)).trim() });
      note = null;
      line = line.slice(end + 2);
    }
    line = line
      .replace(/`[^`]*`/g, (code) => (root ? code : ""))
      .replace(/\(\((.*?)\)\)/g, (_, said: string) => {
        notes.push({ line: i + 1, text: said.trim() });
        return "";
      });
    const start = line.indexOf("((");
    if (start >= 0) {
      note = { line: i + 1, text: line.slice(start + 2) };
      line = line.slice(0, start);
    }
    line = line.trim();
    if (rawLine.trim().startsWith("## ")) {
      closeScene();
      const id = rawLine.trim().slice(3).trim();
      if (scenes.has(id)) errors.push(`${at}: scene "${id}" appears twice`);
      root = [];
      scenes.set(id, root);
      return;
    }
    // A chapter heading ends the scene; anything outside a scene is notes for people.
    if (/^#+\s/.test(line)) {
      closeScene();
      root = null;
      return;
    }
    if (!line) return;
    const tag = /^#([A-Za-z]+)\b\s*(.*)$/.exec(line);
    if (tag) {
      const [, name, rest] = tag;
      const word = name.toLowerCase();
      const known = ["set", "clear", "give", "if", "else", "end", "goto"].includes(word);
      // An unknown tag, like `#idea Gary knocks back`, is a note for us.
      if (!known) {
        notes.push({ line: i + 1, text: line });
        return;
      }
      if (!root) {
        errors.push(`${at}: #${word} is outside a scene`);
        return;
      }
      const arg = rest.trim();
      if (word === "else" || word === "end") {
        const top = open[open.length - 1];
        if (!top) errors.push(`${at}: #${word} without an #if`);
        else if (word === "end") open.pop();
        else if (top.inElse) errors.push(`${at}: a second #else for one #if`);
        else top.inElse = true;
        return;
      }
      if (word === "if") {
        const m = /^(not\s+|!)?(\S+)$/.exec(arg);
        if (!m || !FLAG.test(m[2])) {
          errors.push(`${at}: expected "#if flag" or "#if not flag", got: ${line}`);
          return;
        }
        const branch: Branch = { if: m[2], not: !!m[1], then: [], else: [] };
        here().push(branch);
        open.push({ branch, inElse: false, at });
        return;
      }
      if (word === "goto") {
        if (!arg) errors.push(`${at}: #goto needs a scene name`);
        else {
          here().push({ goto: arg });
          gotos.push({ at, id: arg });
        }
        return;
      }
      if (!FLAG.test(arg)) {
        errors.push(`${at}: expected "#${word} name", got: ${line}`);
        return;
      }
      here().push({ act: word as Act["act"], flag: arg });
      return;
    }
    if (!root) return;
    if (/^\(.*\)$/.test(line)) {
      // A known cue alone on a line fires as the next line starts; anything else is a note.
      const event = CUES[line.slice(1, -1).trim()];
      if (event) here().push({ cue: event });
      return;
    }
    if (line.startsWith(">")) {
      here().push(withCues(line.slice(1).trim()));
      return;
    }
    const m = SPOKEN.exec(line);
    if (!m) {
      errors.push(`${at}: expected "NAME: text" or "> narration", got: ${line}`);
      return;
    }
    const [, rawName, mood, said] = m;
    const name = rawName.toUpperCase();
    here().push({ who: SPEAKERS[name] ?? name, ...withCues(said), ...(mood ? { mood: MOODS[mood] } : {}) });
  });
  closeScene();
  if (note) errors.push(`line ${(note as Note).line}: a (( note has no ))`);
  for (const g of gotos) if (!scenes.has(g.id)) errors.push(`${g.at}: #goto ${g.id}, but there's no scene "${g.id}"`);
  for (const [id, nodes] of scenes) if (!nodes.length) errors.push(`scene "${id}" has no lines`);
  return { scenes, notes, errors };
}

/** What the script can see and change of the story: its flags. */
export interface Flags {
  has(flag: string): boolean;
  set(flag: string, on: boolean): void;
}

/** Actions travel with the lines as cue events like this one, and run when the line plays. */
const ACTION = /^#(set|clear|give) (.+)$/;

/**
 * Turns a scene into the lines to play now: `#if`s are decided with the flags as they'll stand
 * at that point in the scene, and `#goto`s are followed. `#set` and the like run as the
 * conversation reaches them: after the line before, or as the first line starts. `run` takes
 * any that have no line to ride on.
 */
export function playScene(scenes: Map<string, Node[]>, id: string, flags: Flags, run: (event: string) => void): Line[] {
  const out: Line[] = [];
  /** Flags this scene will have changed by the current point. */
  const ahead = new Map<string, boolean>();
  const has = (f: string) => ahead.get(f) ?? flags.has(f);
  /** Cues and actions waiting for the next line to start. */
  let pending: string[] = [];
  const onNext = (event: string) => pending.push(event);
  const afterLast = (event: string) => {
    const last = out[out.length - 1];
    if (last) (last.after ??= []).push(event);
    else onNext(event);
  };
  /** Plays nodes in order; false once a #goto has taken over. */
  const walk = (nodes: Node[], depth: number): boolean => {
    for (const n of nodes) {
      if ("text" in n) {
        const line: Line = { ...n };
        if (pending.length) line.cues = [...pending.map((event) => ({ at: 0, event })), ...(n.cues ?? [])];
        pending = [];
        out.push(line);
      } else if ("act" in n) {
        ahead.set(n.flag, n.act !== "clear");
        afterLast(`#${n.act} ${n.flag}`);
      } else if ("cue" in n) onNext(n.cue);
      else if ("if" in n) {
        if (!walk(has(n.if) !== n.not ? n.then : n.else, depth)) return false;
      } else {
        const next = scenes.get(n.goto);
        // A scene that loops back on itself forever would hang the game.
        if (next && depth < 20) walk(next, depth + 1);
        return false;
      }
    }
    return true;
  };
  walk(scenes.get(id) ?? [], 0);
  // Whatever's left over runs as the conversation ends, or straight away if nothing's said.
  const last = out[out.length - 1];
  if (last && pending.length) (last.after ??= []).push(...pending);
  else pending.forEach(run);
  return out;
}

/** Runs a `#set`/`#clear`/`#give` that came back from a line. False if `event` is a stage cue. */
export function runAction(event: string, flags: Flags = state): boolean {
  const m = ACTION.exec(event);
  if (!m) return false;
  // There's no inventory yet, so an item you're given is a flag, like the laundromat's keys.
  flags.set(m[2], m[1] !== "clear");
  return true;
}

let parsed = load(raw);
let state: Flags = { has: () => false, set: () => {} };
/** Fires a cue or action with no line to ride on; the story points this where the lines' cues go. */
let fire: (event: string) => void = (event) => runAction(event);

function load(text: string): ParsedScript {
  const result = parseScript(text);
  for (const e of result.errors) console.error(`script/dialogue.md ${e}`);
  return result;
}

/**
 * Points the script at the story's flags, so `#if` can read them and `#set` change them, and
 * at whatever plays the lines' cues.
 */
export function useStory(flags: Flags, cue: (event: string) => void): void {
  state = flags;
  fire = cue;
}

/** The `((notes))` and `#ideas` in the script right now. */
export function scriptNotes(): Note[] {
  return parsed.notes;
}

/** A scene's lines, as they'd play right now. A missing scene shows its name on screen rather than nothing. */
export function scene(id: string): Line[] {
  if (!parsed.scenes.has(id)) {
    console.error(`script/dialogue.md has no scene "${id}"`);
    return [{ text: `(missing scene: ${id})` }];
  }
  return playScene(parsed.scenes, id, state, fire);
}

/** Idle chatter: the nth line of a scene, looping. */
export function pick(id: string, n: number): Line[] {
  const lines = scene(id);
  return lines.length ? [lines[n % lines.length]] : [];
}

if (import.meta.hot) {
  import.meta.hot.accept("../../script/dialogue.md?raw", (mod) => {
    if (mod) parsed = load(mod.default as string);
  });
}
