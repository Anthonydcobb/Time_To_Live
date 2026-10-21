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

  it("drops traffic and increments error counters for a forced speed mismatch", () => {
    const net = new Network();
    const left = net.add(new Router("R1", "R1"));
    const right = net.add(new Router("R2", "R2"));
    net.connect(left.port("Gi0/0"), right.port("Gi0/0"));
    type(left, "", "en", "conf t", "int gi0/0", "ip address 10.0.0.1 255.255.255.0", "speed 100", "no shutdown", "end");
    type(right, "", "en", "conf t", "int gi0/0", "ip address 10.0.0.2 255.255.255.0", "speed 1000", "no shutdown", "end");
    net.clock.advance(3_000);

    expect(type(left, "ping 10.0.0.2").join("\n")).not.toContain("Success rate is 100 percent");
    expect(type(left, "show interfaces counters errors").join("\n")).toMatch(/Gi0\/0\s+0\s+[1-9]\d*\s+[1-9]\d*\s+[1-9]\d*/);
    expect(type(right, "show interfaces gigabitEthernet0/0").join("\n")).toMatch(/\d+ input errors, \d+ CRC/);
  });
});
