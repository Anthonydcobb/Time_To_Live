// A small IOS-style command parser: unique-prefix keywords, typed arguments,
// `?` help, tab completion and IOS error positions.
import { toRunes } from "../grimoire";

export interface Word {
  text: string;
  start: number;
}

export function splitWords(line: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) words.push({ text: m[0], start: m.index });
  return words;
}

export interface ArgMatch {
  consumed: number;
  value: unknown;
  /** The argument started but the line ended before it was finished. */
  incomplete?: boolean;
}

export interface Keyword {
  type: "kw";
  word: string;
  help: string;
}

export interface Arg<C> {
  type: "arg";
  /** Shown in help, e.g. "A.B.C.D", "WORD", "LINE", "<0-4>". */
  name: string;
  help: string;
  match: (words: Word[], i: number, ctx: C) => ArgMatch | null;
  /** Consumes the rest of the line verbatim. */
  rest?: boolean;
  /** Help rows to show instead of name/help (used by interface names). */
  helpItems?: (ctx: C) => { name: string; help: string }[];
  /** Words this argument can be completed to with Tab or `xx?`. */
  completions?: (ctx: C) => string[];
}

export type Token<C> = Keyword | Arg<C>;

export interface Command<C> {
  tokens: Token<C>[];
  run: (ctx: C, args: unknown[]) => void;
  when?: (ctx: C) => boolean;
}

export type ParseResult<C> =
  | { kind: "ok"; command: Command<C>; args: unknown[] }
  | { kind: "empty" }
  | { kind: "invalid"; caret: number; wordIndex: number; wordCount: number }
  | { kind: "incomplete" }
  | { kind: "ambiguous"; text: string };

interface Candidate<C> {
  cmd: Command<C>;
  args: unknown[];
}

type WalkResult<C> =
  | { kind: "ok"; cands: Candidate<C>[]; p: number; incomplete: boolean }
  | Exclude<ParseResult<C>, { kind: "ok" } | { kind: "empty" }>;

export const kw = (word: string, help: string): Keyword => ({ type: "kw", word, help });

function keywordsAt<C>(cands: Candidate<C>[], p: number): Keyword[] {
  const seen = new Map<string, Keyword>();
  for (const c of cands) {
    const t = c.cmd.tokens[p];
    if (t?.type === "kw" && !seen.has(t.word)) seen.set(t.word, t);
  }
  return [...seen.values()];
}

/** Decides whether a keyword reads plainly. `path` is the command's keywords so far, "*" for arguments. */
export type Reveal = (path: string[]) => boolean;

function pathTo<C>(cands: Candidate<C>[], p: number, word: string): string[] {
  const c = cands.find((x) => {
    const t = x.cmd.tokens[p];
    return t?.type === "kw" && t.word === word;
  });
  const before = c ? c.cmd.tokens.slice(0, p).map((t) => (t.type === "kw" ? t.word : "*")) : [];
  return [...before, word];
}

function argsAt<C>(cands: Candidate<C>[], p: number): Arg<C>[] {
  const seen = new Map<string, Arg<C>>();
  for (const c of cands) {
    const t = c.cmd.tokens[p];
    if (t?.type === "arg" && !seen.has(t.name)) seen.set(t.name, t);
  }
  return [...seen.values()];
}

function walk<C>(commands: Command<C>[], words: Word[], line: string, ctx: C): WalkResult<C> {
  let cands: Candidate<C>[] = commands
    .filter((c) => !c.when || c.when(ctx))
    .map((cmd) => ({ cmd, args: [] }));
  let p = 0;
  let w = 0;
  while (w < words.length) {
    const word = words[w];
    const alive = cands.filter((c) => c.cmd.tokens.length > p);
    const invalidAt = (caret: number) =>
      ({ kind: "invalid", caret, wordIndex: w, wordCount: words.length }) as const;
    if (!alive.length) return invalidAt(word.start);

    const lower = word.text.toLowerCase();
    const keywords = keywordsAt(alive, p);
    const exact = keywords.find((k) => k.word.toLowerCase() === lower);
    const prefixed = exact ? [exact] : keywords.filter((k) => k.word.toLowerCase().startsWith(lower));
    if (prefixed.length > 1) {
      return { kind: "ambiguous", text: line.slice(0, word.start + word.text.length).trim() };
    }
    if (prefixed.length === 1) {
      const chosen = prefixed[0].word;
      cands = alive.filter((c) => {
        const t = c.cmd.tokens[p];
        return t.type === "kw" && t.word === chosen;
      });
      p++;
      w++;
      continue;
    }

    let consumed = 0;
    let incomplete = false;
    const next: Candidate<C>[] = [];
    for (const c of alive) {
      const t = c.cmd.tokens[p];
      if (t.type !== "arg") continue;
      const m: ArgMatch | null = t.rest
        ? { consumed: words.length - w, value: line.slice(word.start).trimEnd() }
        : t.match(words, w, ctx);
      if (!m) continue;
      if (!next.length) {
        consumed = m.consumed;
        incomplete = !!m.incomplete;
      }
      if (m.consumed === consumed) next.push({ cmd: c.cmd, args: [...c.args, m.value] });
    }
    if (!next.length) {
      // IOS points at the first character no keyword can continue from.
      let good = 0;
      for (let len = 1; len <= lower.length; len++) {
        const pre = lower.slice(0, len);
        if (keywords.some((k) => k.word.toLowerCase().startsWith(pre))) good = len;
        else break;
      }
      return invalidAt(word.start + good);
    }
    cands = next;
    p++;
    w += consumed;
    if (incomplete) return { kind: "ok", cands, p, incomplete: true };
  }
  return { kind: "ok", cands, p, incomplete: false };
}

export function parse<C>(commands: Command<C>[], line: string, ctx: C): ParseResult<C> {
  const words = splitWords(line);
  if (!words.length) return { kind: "empty" };
  const r = walk(commands, words, line, ctx);
  if (r.kind !== "ok") return r;
  if (r.incomplete) return { kind: "incomplete" };
  const done = r.cands.find((c) => c.cmd.tokens.length === r.p);
  if (!done) return { kind: "incomplete" };
  return { kind: "ok", command: done.cmd, args: done.args };
}

export type HelpResult =
  | { kind: "list"; lines: string[] }
  | { kind: "error"; result: ParseResult<unknown> };

/** Handles a line ending in `?`. `line` excludes the question mark. */
export function help<C>(commands: Command<C>[], line: string, ctx: C, reveal?: Reveal): HelpResult {
  const words = splitWords(line);
  const partial = line.length > 0 && !/\s$/.test(line);
  const before = partial ? words.slice(0, -1) : words;
  const r = walk(commands, before, line, ctx);
  if (r.kind !== "ok") return { kind: "error", result: r };
  const alive = r.cands.filter((c) => c.cmd.tokens.length > r.p);

  const hidden = (k: Keyword) => !!reveal && !reveal(pathTo(alive, r.p, k.word));

  if (partial) {
    const prefix = words[words.length - 1].text.toLowerCase();
    const names = [
      ...keywordsAt(alive, r.p).map((k) => ({ name: k.word, hidden: hidden(k) })),
      ...argsAt(alive, r.p).flatMap((a) => (a.completions?.(ctx) ?? []).map((name) => ({ name, hidden: false }))),
    ].filter((n) => n.name.toLowerCase().startsWith(prefix));
    if (!names.length) return { kind: "list", lines: ["% Unrecognized command"] };
    const unique = [...new Map(names.map((n) => [n.name, n])).values()].sort((a, b) => caseless(a.name, b.name));
    return { kind: "list", lines: [unique.map((n) => (n.hidden ? toRunes(n.name) : n.name)).join("  ")] };
  }

  const rows: { name: string; help: string }[] = [
    ...keywordsAt(alive, r.p).map((k) => ({ name: k.word, help: k.help, hidden: hidden(k) })),
    ...argsAt(alive, r.p).flatMap((a) => a.helpItems?.(ctx) ?? [{ name: a.name, help: a.help }]),
  ]
    .sort((a, b) => caseless(a.name, b.name))
    .map((row) => ("hidden" in row && row.hidden ? { name: toRunes(row.name), help: toRunes(row.help) } : row));
  const width = Math.max(0, ...rows.map((row) => row.name.length));
  const lines = rows.map((row) => `  ${row.name.padEnd(width)}  ${row.help}`.trimEnd());
  if (r.cands.some((c) => c.cmd.tokens.length === r.p) && !r.incomplete) lines.push("  <cr>");
  if (!lines.length) return { kind: "error", result: { kind: "invalid", caret: line.length, wordIndex: words.length, wordCount: words.length } };
  return { kind: "list", lines };
}

/** Tab completion. Returns the completed line, or null if nothing unique matches. */
export function complete<C>(commands: Command<C>[], line: string, ctx: C, reveal?: Reveal): string | null {
  const words = splitWords(line);
  if (!words.length || /\s$/.test(line)) return null;
  const last = words[words.length - 1];
  const r = walk(commands, words.slice(0, -1), line, ctx);
  if (r.kind !== "ok") return null;
  const alive = r.cands.filter((c) => c.cmd.tokens.length > r.p);
  const prefix = last.text.toLowerCase();
  const names = [
    ...new Set([
      // You can't Tab-complete an incantation you haven't learned.
      ...keywordsAt(alive, r.p)
        .filter((k) => !reveal || reveal(pathTo(alive, r.p, k.word)))
        .map((k) => k.word),
      ...argsAt(alive, r.p).flatMap((a) => a.completions?.(ctx) ?? []),
    ]),
  ].filter((n) => n.toLowerCase().startsWith(prefix));
  const exact = names.find((n) => n.toLowerCase() === prefix);
  const pick = exact ?? (names.length === 1 ? names[0] : null);
  if (!pick) return null;
  return line.slice(0, last.start) + pick + " ";
}

function caseless(a: string, b: string): number {
  return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
}
