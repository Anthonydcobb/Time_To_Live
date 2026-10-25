import { describe, expect, it } from "vitest";
import { parseLine, visibleLength } from "../src/game/markup";

describe("dialogue keyword markup", () => {
  it("leaves plain lines alone", () => {
    expect(parseLine("Just a line.")).toEqual([{ text: "Just a line." }]);
  });

  it("splits out highlighted and warning keywords", () => {
    expect(parseLine("It's... *beautiful*. Mind the ~knife~!")).toEqual([
      { text: "It's... " },
      { text: "beautiful", cls: "key" },
      { text: ". Mind the " },
      { text: "knife", cls: "warn" },
      { text: "!" },
    ]);
  });

  it("counts only the characters the player sees", () => {
    expect(visibleLength(parseLine("*ab*c~d~"))).toBe(4);
  });

  it("keeps a lone mark as plain text", () => {
    expect(parseLine("5 * 3")).toEqual([{ text: "5 * 3" }]);
  });
});
