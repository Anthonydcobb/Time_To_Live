/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import dialogue from "../script/dialogue.md?raw";
import storySource from "../src/game/story.ts?raw";
import { parseScript, playScene, runAction, type Flags } from "../src/game/script";

/** Flags held in a set, like the story's. */
function flagSet(...on: string[]): Flags & { all: Set<string> } {
  const all = new Set(on);
  return { all, has: (f) => all.has(f), set: (f, v) => (v ? all.add(f) : all.delete(f)) };
}

/** The lines scene `id` of `lines` plays, with `flags`; actions with no line go to `ran`. */
function play(lines: string[], id = "a", flags: Flags = flagSet(), ran: string[] = []) {
  const { scenes, errors } = parseScript(lines.join("\n"));
  expect(errors).toEqual([]);
  return playScene(scenes, id, flags, (e) => ran.push(e));
}

describe("the dialogue script", () => {
  const { scenes, errors } = parseScript(dialogue);

  it("reads every line of script/dialogue.md", () => {
    expect(errors).toEqual([]);
  });

  it("has every scene the story asks for", () => {
    const asked = [...storySource.matchAll(/\b(?:scene|pick)\("([^"]+)"/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(50);
    expect(asked.filter((id) => !scenes.has(id))).toEqual([]);
  });

  it("brings Walter in after Gary only once you have the walkie", () => {
    const whos = (flags: Flags) => playScene(scenes, "gary-meet", flags, () => {}).map((l) => l.who);
    expect(whos(flagSet())).not.toContain("WALTER (walkie)");
    expect(whos(flagSet("walkie"))).toContain("WALTER (walkie)");
  });

  it("doesn't take the how-to's examples for notes", () => {
    expect(parseScript(dialogue).notes.filter((n) => n.line < 80)).toEqual([]);
  });
});

describe("parseScript", () => {
  it("reads speakers, moods, narration and notes", () => {
    expect(
      play([
        "# Chapter",
        "Prose outside a scene is ignored: NOBODY: reads this.",
        "## a",
        "(A note for us.)",
        "WALTER: Over.",
        "GARY: Hello!",
        "MRS. FINCH (paranoid): The cooler.",
        "GUS: 1974.",
        "> The lights *flicker*.",
      ]),
    ).toEqual([
      { who: "WALTER (walkie)", text: "Over." },
      { who: "GARY (through the door)", text: "Hello!" },
      { who: "MRS. FINCH", text: "The cooler.", mood: 1 },
      { who: "GUS", text: "1974." },
      { text: "The lights *flicker*." },
    ]);
  });

  it("takes names in any case", () => {
    expect(play(["## a", "Walter: Ugh, Gary.", "Mrs. Finch: Hello, dear."])).toEqual([
      { who: "WALTER (walkie)", text: "Ugh, Gary." },
      { who: "MRS. FINCH", text: "Hello, dear." },
    ]);
  });

  it("turns capital cues into events where they appear, and leaves other brackets alone", () => {
    expect(
      play([
        "## a",
        "GARY: You can ~OPEN THE DOOR!~(LIGHTS FLICKER)...just kidding.",
        "(LIGHTS OUT)",
        "> A jar of ~TEETH (ASSORTED)~ (sighs).",
      ]),
    ).toEqual([
      { who: "GARY (through the door)", text: "You can ~OPEN THE DOOR!~...just kidding.", cues: [{ at: 22, event: "flicker" }] },
      { text: "A jar of ~TEETH (ASSORTED)~ (sighs).", cues: [{ at: 0, event: "blackout" }] },
    ]);
  });

  it("reports lines it can't read, empty scenes and repeats", () => {
    const { errors } = parseScript(["## a", "this line has no speaker", "## b", "## a", "> fine"].join("\n"));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("line 2");
  });

  it("ends a scene at a chapter heading", () => {
    expect(play(["## a", "> one", "# Next chapter", "Notes here."])).toEqual([{ text: "one" }]);
  });
});

describe("notes for Claude", () => {
  it("hides ((notes)) from the game, wherever they are, and collects them", () => {
    const { scenes, notes, errors } = parseScript(
      [
        "((a note before any scene))",
        "## a",
        "GARY: Hello! ((make him creepier)) Bye.",
        "((on its own))",
        "> The end. ((this one",
        "runs onto the next line))",
        "#idea Gary knocks back",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(playScene(scenes, "a", flagSet(), () => {})).toEqual([
      { who: "GARY (through the door)", text: "Hello! Bye." },
      { text: "The end." },
    ]);
    expect(notes).toEqual([
      { line: 1, text: "a note before any scene" },
      { line: 3, text: "make him creepier" },
      { line: 4, text: "on its own" },
      { line: 5, text: "this one runs onto the next line" },
      { line: 7, text: "#idea Gary knocks back" },
    ]);
  });

  it("reports a (( with no ))", () => {
    expect(parseScript(["## a", "> hi ((never closed"].join("\n")).errors[0]).toContain("no ))");
  });
});

describe("story tags", () => {
  it("plays #if, #if not and #else by the flags", () => {
    const lines = ["## a", "#if walkie", "> radio", "#else", "> no radio", "#end", "#if not keys", "> no keys", "#end"];
    expect(play(lines, "a", flagSet("walkie"))).toEqual([{ text: "radio" }, { text: "no keys" }]);
    expect(play(lines, "a", flagSet("keys"))).toEqual([{ text: "no radio" }]);
  });

  it("nests #ifs", () => {
    const lines = ["## a", "#if x", "#if y", "> both", "#end", "> x", "#end"];
    expect(play(lines, "a", flagSet("x", "y"))).toEqual([{ text: "both" }, { text: "x" }]);
    expect(play(lines, "a", flagSet("x"))).toEqual([{ text: "x" }]);
    expect(play(lines, "a", flagSet("y"))).toEqual([]);
  });

  it("runs #set after the line before it, or as the first line starts", () => {
    expect(play(["## a", "#give keys", "GUS: Here.", "#set met-gus", "#clear haunt"])).toEqual([
      { who: "GUS", text: "Here.", cues: [{ at: 0, event: "#give keys" }], after: ["#set met-gus", "#clear haunt"] },
    ]);
  });

  it("decides a later #if with the flags set earlier in the scene", () => {
    expect(play(["## a", "> one", "#set seen", "#if seen", "> two", "#end"])).toEqual([
      { text: "one", after: ["#set seen"] },
      { text: "two" },
    ]);
  });

  it("runs tags straight away when the scene says nothing", () => {
    const ran: string[] = [];
    expect(play(["## a", "#if nope", "> hidden", "#end", "#set x", "(LIGHTS OUT)"], "a", flagSet(), ran)).toEqual([]);
    expect(ran).toEqual(["#set x", "blackout"]);
  });

  it("follows #goto and drops the rest of the scene", () => {
    expect(play(["## a", "> one", "#if go", "#goto b", "#end", "> not if go", "## b", "> b one"], "a", flagSet("go"))).toEqual([
      { text: "one" },
      { text: "b one" },
    ]);
  });

  it("doesn't hang on a #goto loop", () => {
    expect(play(["## a", "> a", "#goto a"]).length).toBeGreaterThan(1);
  });

  it("reports broken tags", () => {
    const { errors } = parseScript(
      ["## a", "> x", "#if open", "#else", "#else", "#end", "#end", "#goto nowhere", "#set", "#if two words", "## b", "#if never-closed", "> y"].join(
        "\n",
      ),
    );
    expect(errors).toEqual([
      "line 5: a second #else for one #if",
      "line 7: #end without an #if",
      'line 9: expected "#set name", got: #set',
      'line 10: expected "#if flag" or "#if not flag", got: #if two words',
      "line 12: #if never-closed has no #end",
      'line 8: #goto nowhere, but there\'s no scene "nowhere"',
    ]);
  });

  it("leaves # in the middle of a line, like a work order number, alone", () => {
    expect(play(["## a", "> WORK ORDER #0001."])).toEqual([{ text: "WORK ORDER #0001." }]);
  });

  it("changes the flags when an action runs, and leaves stage cues to the scene", () => {
    const flags = flagSet("haunt");
    expect(runAction("#give keys", flags)).toBe(true);
    expect(runAction("#clear haunt", flags)).toBe(true);
    expect(runAction("blackout", flags)).toBe(false);
    expect([...flags.all]).toEqual(["keys"]);
  });
});
