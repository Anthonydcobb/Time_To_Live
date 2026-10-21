import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

describe("HSRP", () => {
  it("uses the highest-priority active gateway and fails over", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const sw = net.add(new Switch("S1"));
    const pc = net.add(new Pc("PC1"));
    pc.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.254"));
    net.connect(r1.port("Gi0/0"), sw.port("Fa0/1"));
    net.connect(r2.port("Gi0/0"), sw.port("Fa0/2"));
    net.connect(pc.nic, sw.port("Fa0/3"));
    type(r1, "", "en", "conf t", "interface g0/0", "ip address 10.0.0.1 255.255.255.0", "standby 1 ip 10.0.0.254", "standby 1 priority 110", "no shutdown", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ip address 10.0.0.2 255.255.255.0", "standby 1 ip 10.0.0.254", "no shutdown", "end");
    net.clock.advance(35_000);
    expect(type(r1, "show standby").join("\n")).toContain("State is Active");
    expect(type(r2, "show standby").join("\n")).toContain("State is Standby");
    const firstPing = run(pc, "ping -n 4 10.0.0.254");
    expect(firstPing.some((line) => line.startsWith("Reply from 10.0.0.254"))).toBe(true);
    type(r1, "", "en", "conf t", "interface g0/0", "shutdown", "end");
    net.clock.advance(2_000);
    expect(type(r2, "show standby").join("\n")).toContain("State is Active");
    expect(run(pc, "ping -n 4 10.0.0.254").some((line) => line.startsWith("Reply from 10.0.0.254"))).toBe(true);
  });
});

describe("VRRP", () => {
  it("elects a master and fails over the virtual gateway", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const sw = net.add(new Switch("S1"));
    const pc = net.add(new Pc("PC1"));
    pc.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.254"));
    net.connect(r1.port("Gi0/0"), sw.port("Fa0/1"));
    net.connect(r2.port("Gi0/0"), sw.port("Fa0/2"));
    net.connect(pc.nic, sw.port("Fa0/3"));
    type(r1, "", "en", "conf t", "int g0/0", "ip address 10.0.1.1 255.255.255.0", "vrrp 1 ip 10.0.1.254", "vrrp 1 priority 120", "no shut", "end");
    type(r2, "", "en", "conf t", "int g0/0", "ip address 10.0.1.2 255.255.255.0", "vrrp 1 ip 10.0.1.254", "no shut", "end");
    net.clock.advance(35_000);
    expect(type(r1, "show vrrp").join("\n")).toContain("State is Master");
    expect(type(r2, "show vrrp").join("\n")).toContain("State is Backup");
    expect(run(pc, "ping -n 3 10.0.1.254").some((line) => line.startsWith("Reply from 10.0.1.254"))).toBe(true);
    type(r1, "", "en", "conf t", "int g0/0", "shutdown", "end");
    net.clock.advance(2_000);
    expect(type(r2, "show vrrp").join("\n")).toContain("State is Master");
  });
});
