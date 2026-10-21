import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("interface speed and duplex", () => {
  it("stores router speed and duplex settings and reports them", () => {
    const router = new Router("R1", "R1");
    new Network().add(router);

    type(router, "", "en", "conf t", "interface gi0/0", "speed 100", "duplex full", "end");

    const config = type(router, "show running-config").join("\n");
    expect(config).toContain(" duplex full");
    expect(config).toContain(" speed 100");
    expect(type(router, "show interfaces gigabitEthernet0/0").join("\n")).toContain("Full Duplex, 100Mbps");
  });

  it("reports configured switch settings and rejects gigabit speed on FastEthernet", () => {
    const sw = new Switch("S1", "S1");
    new Network().add(sw);

    const output = type(sw, "", "en", "conf t", "interface fa0/1", "speed 1000", "duplex half", "end");
    expect(output).toContain("% Speed 1000 is not supported on FastEthernet0/1");
    expect(type(sw, "show interfaces fastEthernet0/1").join("\n")).toContain("Half-duplex, Auto-speed");
    expect(type(sw, "show running-config").join("\n")).toContain(" duplex half");
  });

  it("supports interface ranges for speed and duplex", () => {
    const sw = new Switch("S1", "S1");
    new Network().add(sw);

    type(sw, "", "en", "conf t", "interface range fa0/1 - 2", "speed 10", "duplex half", "end");
    const config = type(sw, "show running-config").join("\n");
    expect(config.match(/ speed 10/g)?.length).toBe(2);
    expect(config.match(/ duplex half/g)?.length).toBe(2);
  });

  it("uses no speed and no duplex to restore negotiation", () => {
    const router = new Router("R1", "R1");
    new Network().add(router);

    type(router, "", "en", "conf t", "int gi0/0", "speed 100", "duplex half", "no speed", "no duplex", "end");
    const config = type(router, "show running-config").join("\n");
    expect(config).toContain(" duplex auto");
    expect(config).toContain(" speed auto");
  });
});
