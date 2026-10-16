// The incantations the player has learned. Commands they haven't learned still
// work if typed in full, but `?` help shows them as runes and Tab won't
// complete them. Jobs teach new ones, and using one correctly learns it too.
import type { Mode } from "./ios/console";

/** Where an incantation is spoken. User and privileged EXEC share one book. */
export type Book = "exec" | "config" | "if" | "line";

export function bookFor(mode: Mode): Book {
  switch (mode) {
    case "user":
    case "enable":
      return "exec";
    case "config":
      return "config";
    case "config-if":
      return "if";
    case "config-line":
      return "line";
  }
}

/** An incantation as written in a job: "if: ip address", "exec: show ip interface brief". */
export function parseIncantation(text: string): { book: Book; words: string[] } {
  const [book, rest] = text.split(":").map((s) => s.trim());
  return { book: book as Book, words: rest.split(/\s+/).filter(Boolean) };
}

const key = (book: Book, words: string[]) => `${book}:${words.join(" ")}`;

/** Commands everyone knows from the first minute: moving between modes. */
export const BASICS = ["exec: enable", "exec: disable", "exec: exit", "exec: logout", "config: exit", "config: end", "if: exit", "if: end", "line: exit", "line: end"];

export type LearnListener = (book: Book, words: string[]) => void;

export class Grimoire {
  private readonly learned = new Map<string, { book: Book; words: string[] }>();
  private readonly listeners = new Set<LearnListener>();

  constructor(incantations: string[] = BASICS) {
    for (const i of incantations) this.teach(i);
  }

  /** Learns an incantation written as "book: words". Returns false if it was already known. */
  teach(incantation: string): boolean {
    const { book, words } = parseIncantation(incantation);
    return this.learn(book, words);
  }

  learn(book: Book, words: string[]): boolean {
    // Arguments ("*") at the end aren't part of the incantation itself.
    const trimmed = [...words];
    while (trimmed[trimmed.length - 1] === "*") trimmed.pop();
    if (!trimmed.length || this.covers(book, trimmed)) return false;
    this.learned.set(key(book, trimmed), { book, words: trimmed });
    for (const l of this.listeners) l(book, trimmed);
    return true;
  }

  /**
   * Whether a keyword at this path reads plainly. True if the path leads toward
   * something learned ("show ip" when "show ip interface brief" is known) or
   * lies inside something learned ("interface * description" when "interface" is).
   */
  knows(book: Book, path: string[]): boolean {
    for (const l of this.learned.values()) {
      if (l.book !== book) continue;
      if (startsWith(l.words, path) || startsWith(path, l.words)) return true;
    }
    return false;
  }

  /** All learned incantations as "book: words", in the order they were learned. */
  list(): string[] {
    return [...this.learned.values()].map((l) => `${l.book}: ${l.words.join(" ")}`);
  }

  onLearn(listener: LearnListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True if the path is already learned or lies inside something learned. */
  private covers(book: Book, words: string[]): boolean {
    for (const l of this.learned.values()) if (l.book === book && startsWith(words, l.words)) return true;
    return false;
  }
}

function startsWith(path: string[], prefix: string[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((w, i) => w === "*" || path[i] === "*" || w === path[i]);
}

// The runes are a plain substitution cipher, so a patient player can decode them.
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᚣᛯ";
const DIGITS = "ᛰᛮᛥᛤᛣᛢᛡᛠᛝᛙ";

/** Renders unlearned text as eldritch runes, one rune per letter so columns still line up. */
export function toRunes(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (lower >= "a" && lower <= "z") out += RUNES[lower.charCodeAt(0) - 97];
    else if (ch >= "0" && ch <= "9") out += DIGITS[ch.charCodeAt(0) - 48];
    else if (ch === " ") out += " ";
    else out += "᛫";
  }
  return out;
}
