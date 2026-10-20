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
    // Router: name, secret, console, Gi0/0. Switch: name, secret, console. Then the PCs, the pings, and the flavor line.
    const F = false;
    expect(done()).toEqual([F, F, F, F, F, F, F, F, F, F, F, null]);
    type(r1, "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
    run(register, "ipconfig 192.168.1.10 255.255.255.0 192.168.1.1");
    run(office, "ipconfig 192.168.1.11 255.255.255.0 192.168.1.1");
    net.clock.advance(35_000);
    expect(done()).toEqual([F, F, F, true, F, F, F, true, true, F, F, null]);
    run(register, "ping 192.168.1.1");
    run(office, "ping 192.168.1.1");
    run(register, "ping 192.168.1.11");
    expect(done()).toEqual([F, F, F, true, F, F, F, true, true, true, true, null]);
  });

  it("goes one box at a time: the router's tasks only need the router, the switch's only the switch", () => {
    const { r1, s1, tasks } = cornerStore();
    const task = (id: string) => tasks.find((t) => t.id === id)!.done!();
    expect(tasks.map((t) => t.id).slice(0, 7)).toEqual(["r1-name", "r1-secret", "r1-console", "router", "s1-name", "s1-secret", "s1-console"]);

    type(r1, "", "en", "conf t", "hostname R1", "enable secret quiet-hours", "line console 0", "password static");
    expect([task("r1-name"), task("r1-secret"), task("r1-console")]).toEqual([true, true, false]);
    // A password alone isn't enough; the console only asks for it with login.
    type(r1, "login", "end");
    expect(task("r1-console")).toBe(true);
    expect([task("s1-name"), task("s1-secret"), task("s1-console")]).toEqual([false, false, false]);

    type(s1, "", "en", "conf t", "hostname S1", "enable secret other-hours", "line console 0", "password static", "login", "end");
    expect([task("s1-name"), task("s1-secret"), task("s1-console")]).toEqual([true, true, true]);
  });
});

describe("work order, uncabled", () => {
  it("starts with nothing plugged in and ticks off cabling once all three cables are in", () => {
    const { net, r1, s1, register, office, tasks } = cornerStore({ cabled: false });
    const cable = tasks.find((t) => t.id === "cable")!;
    expect(r1.port("Gi0/0").peer).toBeNull();
    expect(cable.done!()).toBe(false);
    net.connect(r1.port("Gi0/0"), s1.port("Gi0/1"));
    net.connect(register.nic, s1.port("Fa0/1"));
    expect(cable.done!()).toBe(false);
    net.connect(office.nic, s1.port("Fa0/7"));
    expect(cable.done!()).toBe(true);
  });
});
