import { describe, expect, it } from "vitest";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { lightFor } from "../src/web/topology";
import { type } from "./helpers";

describe("topology link lights", () => {
  it("go red, then amber through spanning tree, then green", () => {
    const { net, r1, s1 } = cornerStore();
    const routerEnd = r1.port("Gig0/0");
    const switchEnd = s1.port("Gig0/1");
    expect(lightFor(routerEnd)).toBe("red");
    type(r1, "en", "conf t", "int g0/0", "no shut", "end");
    net.clock.advance(2000);
    expect(lightFor(routerEnd)).toBe("green");
    expect(lightFor(switchEnd)).toBe("amber");
    net.clock.advance(30_000);
    expect(lightFor(switchEnd)).toBe("green");
  });
});
