import { describe, expect, it } from "vitest";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { lightFor } from "../src/web/topology";
import { run, type } from "./helpers";

describe("topology link lights", () => {
  it("go red, then amber through spanning tree, then green", () => {
    const { net, r1, s1 } = cornerStore();
    const routerEnd = r1.port("Gig0/0");
    const switchEnd = s1.port("Gig0/1");
    expect(lightFor(routerEnd)).toBe("red");
    type(r1, "en", "conf t", "int g0/0", "no shut", "end");
    net.clock.advance(3_000);
    expect(lightFor(routerEnd)).toBe("green");
    expect(lightFor(switchEnd)).toBe("amber");
    net.clock.advance(32_000);
    expect(lightFor(switchEnd)).toBe("green");
  });
});

describe("work order", () => {
  it("ticks each task off from the live network", () => {
    const store = cornerStore();
    const { net, r1, register, office, tasks } = store;
    const done = () => tasks.map((t) => t.done?.() ?? null);
    expect(done()).toEqual([false, false, false, false, false, null]);
    type(r1, "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
    run(register, "ipconfig 192.168.1.10 255.255.255.0 192.168.1.1");
    run(office, "ipconfig 192.168.1.11 255.255.255.0 192.168.1.1");
    net.clock.advance(35_000);
    expect(done()).toEqual([true, true, true, false, false, null]);
    run(register, "ping 192.168.1.1");
    run(office, "ping 192.168.1.1");
    run(register, "ping 192.168.1.11");
    expect(done()).toEqual([true, true, true, true, true, null]);
  });
});
