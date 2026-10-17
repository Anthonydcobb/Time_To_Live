import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { CableError, LINK_NEGOTIATION_MS, Network } from "../src/sim/network";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { finish, run, type } from "./helpers";

/** A — R1 — R2 — B, three subnets, static routes both ways. */
function twoRouters() {
  const net = new Network();
  const r1 = net.add(new Router("R1", "R1"));
  const r2 = net.add(new Router("R2", "R2"));
  const a = net.add(new Pc("A"));
  const b = net.add(new Pc("B"));
  net.connect(a.nic, r1.port("Gig0/0"));
  net.connect(r1.port("Gig0/1"), r2.port("Gig0/0"));
  net.connect(r2.port("Gig0/1"), b.nic);
  type(r1, "en", "conf t", "int g0/0", "ip add 192.168.1.1 255.255.255.0", "no shut", "int g0/1", "ip add 10.0.0.1 255.255.255.0", "no shut", "exit");
  type(r1, "ip route 172.16.0.0 255.255.0.0 10.0.0.2", "end");
  type(r2, "en", "conf t", "int g0/0", "ip add 10.0.0.2 255.255.255.0", "no shut", "int g0/1", "ip add 172.16.0.1 255.255.0.0", "no shut", "exit");
  type(r2, "ip route 192.168.1.0 255.255.255.0 10.0.0.1", "end");
  a.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
  b.configure(ip("172.16.0.10"), ip("255.255.0.0"), ip("172.16.0.1"));
  net.clock.advance(3_000);
  return { net, r1, r2, a, b };
}

describe("commands that take real time", () => {
  it("makes a router wait out the ARP timeout on its first ping", () => {
    const { r1 } = twoRouters();
    const start = r1.clock.now;
    const r = r1.console.input("ping 10.0.0.2");
    expect(r.lines[1]).toBe("Sending 5, 100-byte ICMP Echos to 10.0.0.2, timeout is 2 seconds:");
    expect(r.job!.done).toBe(false);
    const out = finish(r1, r.job!);
    expect(out[0]).toBe(".!!!!");
    expect(r1.clock.now - start).toBeGreaterThanOrEqual(2000);
  });

  it("stops a ping on the escape sequence and reports what was sent", () => {
    const { r1 } = twoRouters();
    const r = r1.console.input("ping 10.0.0.99");
    r1.clock.advance(4500);
    r.job!.abort();
    expect(r.job!.output).toMatch(/^\.\.\nSuccess rate is 0 percent \(0\/3\)\n$/);
  });

  it("spaces Windows pings a second apart", () => {
    const { a } = twoRouters();
    run(a, "ping -n 1 192.168.1.1");
    const start = a.clock.now;
    run(a, "ping 192.168.1.1");
    expect(a.clock.now - start).toBeGreaterThanOrEqual(3000);
  });
});

describe("traceroute", () => {
  it("lists each router hop from a PC", () => {
    const { a } = twoRouters();
    const out = run(a, "tracert 172.16.0.10");
    expect(out[0]).toBe("Tracing route to 172.16.0.10 over a maximum of 30 hops: ");
    const hops = out.filter((l) => /^\s+\d+ /.test(l));
    expect(hops).toHaveLength(3);
    expect(hops[0]).toMatch(/192\.168\.1\.1$/);
    expect(hops[1]).toMatch(/10\.0\.0\.2$/);
    expect(hops[2]).toMatch(/172\.16\.0\.10$/);
    expect(out[out.length - 1]).toBe("Trace complete.");
  });

  it("traces from IOS, starting at the next router", () => {
    const { r1 } = twoRouters();
    type(r1, "ping 10.0.0.2");
    const out = type(r1, "traceroute 172.16.0.10");
    expect(out.slice(0, 3)).toEqual(["Type escape sequence to abort.", "Tracing the route to 172.16.0.10", "VRF info: (vrf in name/id, vrf out name/id)"]);
    expect(out[3]).toMatch(/^ {2}1 10\.0\.0\.2 (\d+ msec ?){3}$/);
    expect(out[4]).toMatch(/^ {2}2 172\.16\.0\.10 /);
  });

  it("shows stars where nothing answers", () => {
    const { r1, a } = twoRouters();
    type(r1, "conf t", "no ip route 172.16.0.0 255.255.0.0", "ip route 172.16.0.0 255.255.0.0 10.0.0.3", "end");
    const out = run(a, "tracert 172.16.0.10");
    expect(out).toContain("  2   *         *         *         Request timed out.");
  });
});

describe("cables", () => {
  it("links up with any Ethernet cable, even switch to switch", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1"));
    const s2 = net.add(new Switch("S2"));
    const pc = net.add(new Pc("PC0"));
    net.connect(s1.port("Gig0/1"), s2.port("Gig0/1"));
    net.connect(pc.nic, s1.port("Fa0/1"));
    expect(s1.port("Gig0/1").linkUp).toBe(false);
    net.clock.advance(LINK_NEGOTIATION_MS);
    expect(s1.port("Gig0/1").linkUp).toBe(true);
    expect(pc.nic.linkUp).toBe(true);
  });

  it("connects a console cable from a PC's serial port to the console port", () => {
    const net = new Network();
    const r = net.add(new Router("R1"));
    const pc = net.add(new Pc("Laptop"));
    expect(() => net.connect(pc.nic, r.consolePort)).toThrow(CableError);
    expect(() => net.connect(pc.rs232, r.port("Gig0/0"), "console")).toThrow(CableError);
    net.connect(pc.rs232, r.consolePort, "console");
    expect(pc.consoleTarget()).toBe(r);
  });
});

describe("CDP", () => {
  function store() {
    const s = cornerStore();
    type(s.r1, "en", "conf t", "hostname R1", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
    type(s.s1, "en", "conf t", "hostname S1", "end");
    s.net.clock.advance(61_000);
    return s;
  }

  it("lists the directly connected neighbor on each side", () => {
    const { r1, s1 } = store();
    const fromRouter = type(r1, "show cdp neighbors");
    expect(fromRouter[2]).toBe("Device ID    Local Intrfce   Holdtme    Capability   Platform    Port ID");
    expect(fromRouter[3]).toMatch(/^S1 +Gig 0\/0 +\d+ +S +CS-2960-24TT Gig 0\/1$/);
    const fromSwitch = type(s1, "show cdp neighbors");
    expect(fromSwitch[3]).toMatch(/^R1 +Gig 0\/1 +\d+ +R +CR-2911 +Gig 0\/0$/);
    expect(fromSwitch).toHaveLength(4);
  });

  it("shows the neighbor's IP address in detail", () => {
    const { s1 } = store();
    const out = type(s1, "show cdp neighbors detail");
    expect(out).toContain("  IP address : 192.168.1.1");
    expect(out).toContain("Interface: GigabitEthernet0/1, Port ID (outgoing port): GigabitEthernet0/0");
  });

  it("can be turned off globally or per interface", () => {
    const { r1, s1, net } = store();
    type(r1, "conf t", "int g0/0", "no cdp enable", "end");
    expect(type(r1, "show running-config").join("\n")).toContain(" speed auto\n no cdp enable");
    type(s1, "conf t", "no cdp run", "end");
    expect(type(s1, "show cdp neighbors")).toEqual(["% CDP is not enabled"]);
    expect(type(s1, "show running-config")).toContain("no cdp run");
    net.clock.advance(200_000);
    expect(type(r1, "show cdp neighbors")).toHaveLength(3);
  });
});
