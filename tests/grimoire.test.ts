import { describe, expect, it } from "vitest";
import { BASICS, Grimoire, parseIncantation, toRunes } from "../src/sim/grimoire";
import { commandsFor } from "../src/sim/ios/commands";
import type { Mode } from "../src/sim/ios/console";
import { CORNER_STORE_INCANTATIONS, cornerStore } from "../src/sim/scenarios/corner-store";
import { type } from "./helpers";

function store() {
  const s = cornerStore();
  const grimoire = new Grimoire([...BASICS, ...s.incantations]);
  s.r1.console.grimoire = grimoire;
  s.s1.console.grimoire = grimoire;
  return { ...s, grimoire };
}

/** The help lines a `?` prints, after getting into the mode the commands lead to. */
function helpAt(device: ReturnType<typeof store>["r1"], line: string) {
  return device.console.help(line).lines;
}

describe("grimoire", () => {
  it("spells every taught incantation like a real command", () => {
    const modes: Record<string, Mode> = { exec: "enable", config: "config", if: "config-if", line: "config-line" };
    for (const text of [...BASICS, ...CORNER_STORE_INCANTATIONS]) {
      const { book, words } = parseIncantation(text);
      const found = commandsFor(modes[book], "router").some((c) =>
        words.every((w, i) => {
          const t = c.tokens[i];
          return t?.type === "kw" && t.word === w;
        }),
      );
      expect(found, text).toBe(true);
    }
  });

  it("shows unlearned commands as runes in ? help, lined up like real ones", () => {
    const { r1 } = store();
    type(r1, "", "en");
    const lines = helpAt(r1, "show ");
    expect(lines.some((l) => l.startsWith("  ip "))).toBe(true);
    expect(lines.some((l) => l.startsWith("  running-config "))).toBe(true);
    const arp = lines.find((l) => l.startsWith(`  ${toRunes("arp")} `))!;
    expect(arp.trimEnd().endsWith(toRunes("ARP table"))).toBe(true);
    // Runes keep each word's length, so the help column lines up with the plain rows.
    const ip = lines.find((l) => l.startsWith("  ip "))!;
    expect(arp.indexOf(toRunes("ARP table"))).toBe(ip.indexOf("IP information"));
    expect(lines.join("\n")).not.toContain("version");
  });

  it("only reveals the learned branch of a keyword", () => {
    const { r1 } = store();
    type(r1, "", "en");
    const lines = helpAt(r1, "show ip ");
    expect(lines.find((l) => l.startsWith("  interface"))).toBeDefined();
    expect(lines.find((l) => l.trimStart().startsWith(toRunes("route")))).toBeDefined();
  });

  it("won't Tab-complete an unlearned command, but still runs it typed in full", () => {
    const { r1, grimoire } = store();
    type(r1, "", "en");
    expect(r1.console.complete("show vers")).toBe("show vers");
    expect(r1.console.complete("show run")).toBe("show running-config ");
    expect(type(r1, "show version").join("\n")).toContain("Cryptis");
    expect(grimoire.knows("exec", ["show", "version"])).toBe(true);
    expect(r1.console.complete("show vers")).toBe("show version ");
  });

  it("learns a command in the book of the mode it was used in", () => {
    const { r1, grimoire } = store();
    const learned: string[] = [];
    grimoire.onLearn((book, words) => learned.push(`${book}: ${words.join(" ")}`));
    type(r1, "", "en", "conf t", "no ip domain-lookup", "line vty 0 4", "logging synchronous", "end");
    expect(learned).toEqual(["config: no ip domain-lookup", "config: line vty", "line: logging synchronous"]);
    expect(grimoire.knows("exec", ["no"])).toBe(false);
  });

  it("reads every command plainly when there's no grimoire", () => {
    const { r1 } = cornerStore();
    type(r1, "", "en");
    expect(r1.console.help("show ").lines.join("\n")).toContain("version");
  });
});
