/**
 * Keyword colours in dialogue. Wrap a word in `*stars*` to pick it out, or in `~tildes~`
 * for something wrong or dangerous:
 *
 *   "Have a look outside. It's... *beautiful*..."
 *   "He's holding a ~knife~."
 */

/** A piece of a line: plain text, or a keyword with the class that colours it. */
export interface Run {
  text: string;
  cls?: "key" | "warn";
}

const MARK = /\*([^*]+)\*|~([^~]+)~/g;

export function parseLine(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    runs.push(m[1] !== undefined ? { text: m[1], cls: "key" } : { text: m[2], cls: "warn" });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

/** How many characters the player actually sees, without the marks. */
export function visibleLength(runs: Run[]): number {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

/** Puts the first `count` visible characters of `runs` into `el`, keywords as coloured spans. */
export function renderRuns(el: HTMLElement, runs: Run[], count = Infinity): void {
  const nodes: Node[] = [];
  let left = count;
  for (const r of runs) {
    if (left <= 0) break;
    const text = r.text.slice(0, left);
    left -= text.length;
    if (!r.cls) nodes.push(document.createTextNode(text));
    else {
      const span = document.createElement("span");
      span.className = r.cls;
      span.textContent = text;
      nodes.push(span);
    }
  }
  el.replaceChildren(...nodes);
}
