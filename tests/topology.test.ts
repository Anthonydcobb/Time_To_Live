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
    // names, secrets, console, router, register, office, ping-router, ping-pcs, and the flavor line
    expect(done()).toEqual([false, false, false, false, false, false, false, false, null]);
    type(r1, "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
    run(register, "ipconfig 192.168.1.10 255.255.255.0 192.168.1.1");
    run(office, "ipconfig 192.168.1.11 255.255.255.0 192.168.1.1");
    net.clock.advance(35_000);
    expect(done()).toEqual([false, false, false, true, true, true, false, false, null]);
    run(register, "ping 192.168.1.1");
    run(office, "ping 192.168.1.1");
    run(register, "ping 192.168.1.11");
    expect(done()).toEqual([false, false, false, true, true, true, true, true, null]);
  });

  it("ticks off hostnames, enable secrets and console passwords once both boxes have them", () => {
    const { r1, s1, tasks } = cornerStore();
    const task = (id: string) => tasks.find((t) => t.id === id)!.done!();
    type(r1, "", "en", "conf t", "hostname R1", "end");
    expect(task("names")).toBe(false);
    type(s1, "", "en", "conf t", "hostname S1", "end");
    expect(task("names")).toBe(true);

    type(r1, "conf t", "enable secret quiet-hours", "end");
    expect(task("secrets")).toBe(false);
    type(s1, "conf t", "enable secret quiet-hours", "end");
    expect(task("secrets")).toBe(true);

    // A password alone isn't enough; the console only asks for it with login.
    type(r1, "conf t", "line console 0", "password static", "login", "end");
    type(s1, "conf t", "line console 0", "password static", "end");
    expect(task("console")).toBe(false);
    type(s1, "conf t", "line console 0", "login", "end");
    expect(task("console")).toBe(true);
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
