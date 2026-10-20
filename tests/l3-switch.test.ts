import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Network } from "../src/sim/network";
import { Pc } from "../src/sim/devices/pc";
import { Switch } from "../src/sim/devices/switch";
import { run, type } from "./helpers";

describe("Layer 3 switch", () => {
  it("routes between routed switch ports when ip routing is enabled", () => {
    const net = new Network();
    const sw = net.add(new Switch("CORE", "CORE"));
    const left = net.add(new Pc("LEFT"));
    const right = net.add(new Pc("RIGHT"));
    type(sw, "", "en", "conf t", "ip routing", "int gi0/1", "no switchport", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "int gi0/2", "no switchport", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "end");
    left.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    right.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
    net.connect(left.nic, sw.port("Gi0/1"));
    net.connect(right.nic, sw.port("Gi0/2"));
    net.clock.advance(3_000);
    expect(run(left, "ping -n 2 10.0.1.10").some((line) => line.startsWith("Reply from 10.0.1.10"))).toBe(true);
    const route = type(sw, "show ip route");
    expect(route.some((line) => line.includes("10.0.1.0 is directly connected, GigabitEthernet0/2"))).toBe(true);
  });

  it("does not route until ip routing is enabled", () => {
    const net = new Network();
    const sw = net.add(new Switch("CORE", "CORE"));
    const left = net.add(new Pc("LEFT"));
    const right = net.add(new Pc("RIGHT"));
    type(sw, "", "en", "conf t", "int gi0/1", "no switchport", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "int gi0/2", "no switchport", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "end");
    left.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    right.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
    net.connect(left.nic, sw.port("Gi0/1"));
    net.connect(right.nic, sw.port("Gi0/2"));
    net.clock.advance(3_000);
    expect(run(left, "ping -n 1 10.0.1.10")).toContain("Request timed out.");
  });
});
