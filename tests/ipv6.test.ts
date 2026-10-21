import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { Pc } from "../src/sim/devices/pc";
import { parseIpv6 } from "../src/sim/addr";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("IPv6 interface configuration", () => {
  it("normalizes IPv6 addresses and reports them in the brief view", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    type(r1, "", "en", "conf t", "ipv6 unicast-routing", "interface g0/0", "ipv6 address 2001:db8:1::1/64", "no shutdown", "end");
    expect(r1.config.ipv6UnicastRouting).toBe(true);
    expect(r1.ifaceConfig("GigabitEthernet0/0").ipv6Addresses).toEqual([{ address: parseIpv6("2001:db8:1::1"), prefix: 64 }]);
    expect(type(r1, "show ipv6 interface brief").join("\n")).toContain("2001:0db8:0001:0000:0000:0000:0000:0001/64");
  });

  it("rejects malformed IPv6 prefixes", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const output = type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8::1/129");
    expect(output).toContain("% Invalid IPv6 address or prefix.");
  });

  it("carries an IPv6 echo request to a router interface", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const pc1 = net.add(new Pc("PC1"));
    const routerAddress = parseIpv6("2001:db8:1::1")!;
    const pcAddress = parseIpv6("2001:db8:1::10")!;
    pc1.configureIpv6(pcAddress, 64);
    net.connect(pc1.nic, r1.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:1::1/64", "no shutdown", "end");
    net.clock.advance(3_000);
    let result = "timeout";
    pc1.stack.probeIpv6(routerAddress, { id: 1, seq: 1, timeoutMs: 100, source: pcAddress }, (reply) => { result = reply.kind; });
    net.clock.advance(100);
    expect(result).toBe("reply");
  });

  it("configures and displays a static IPv6 route", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    type(r1, "", "en", "conf t", "ipv6 route 2001:db8:2::/64 2001:db8:1::2", "end");
    expect(r1.config.ipv6StaticRoutes).toHaveLength(1);
    expect(type(r1, "show ipv6 route").join("\n")).toContain("2001:0db8:0002:0000:0000:0000:0000:0000/64");
  });

  it("routes IPv6 end to end across two routers", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const pc1 = net.add(new Pc("PC1"));
    const pc2 = net.add(new Pc("PC2"));
    const p1 = parseIpv6("2001:db8:10::10")!;
    const p2 = parseIpv6("2001:db8:20::20")!;
    const r1Lan = parseIpv6("2001:db8:10::1")!;
    const r2Lan = parseIpv6("2001:db8:20::1")!;
    net.connect(pc1.nic, r1.port("Gi0/0"));
    net.connect(r1.port("Gi0/1"), r2.port("Gi0/0"));
    net.connect(r2.port("Gi0/1"), pc2.nic);
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:10::1/64", "no shutdown", "interface g0/1", "ipv6 address 2001:db8:100::1/64", "no shutdown", "ipv6 route 2001:db8:20::/64 2001:db8:100::2", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::2/64", "no shutdown", "interface g0/1", "ipv6 address 2001:db8:20::1/64", "no shutdown", "ipv6 route 2001:db8:10::/64 2001:db8:100::1", "end");
    pc1.configureIpv6(p1, 64, r1Lan);
    pc2.configureIpv6(p2, 64, r2Lan);
    net.clock.advance(3_000);
    let result = "timeout";
    pc1.stack.probeIpv6(p2, { id: 2, seq: 1, timeoutMs: 5_000, source: p1 }, (reply) => { result = reply.kind; });
    net.clock.advance(5_000);
    expect(result).toBe("reply");
  });

  it("reports an unreachable IPv6 destination instead of timing out locally", () => {
    const net = new Network();
    const pc1 = net.add(new Pc("PC1"));
    const p1 = parseIpv6("2001:db8:10::10")!;
    pc1.configureIpv6(p1, 64);
    let result = "timeout";
    pc1.stack.probeIpv6(parseIpv6("2001:db8:99::99")!, { id: 3, seq: 1, timeoutMs: 100, source: p1 }, (reply) => { result = reply.kind; });
    expect(result).toBe("unreachable");
  });

  it("reports hop-limit exhaustion on a routed IPv6 probe", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    net.connect(r1.port("Gi0/0"), r2.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::1/64", "no shutdown", "ipv6 route 2001:db8:200::/64 2001:db8:100::2", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::2/64", "no shutdown", "end");
    net.clock.advance(3_000);
    let result = "timeout";
    r1.stack.probeIpv6(parseIpv6("2001:db8:200::2")!, { id: 4, seq: 1, timeoutMs: 100, source: parseIpv6("2001:db8:100::1")!, hopLimit: 1 }, (reply) => { result = reply.kind; });
    net.clock.advance(100);
    expect(result).toBe("ttl-expired");
  });

  it("shows learned IPv6 neighbors after discovery", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    net.connect(r1.port("Gi0/0"), r2.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::1/64", "no shutdown", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::2/64", "no shutdown", "end");
    net.clock.advance(3_000);
    r1.stack.probeIpv6(parseIpv6("2001:db8:100::2")!, { id: 5, seq: 1, timeoutMs: 100, source: parseIpv6("2001:db8:100::1")! }, () => undefined);
    net.clock.advance(100);
    expect(type(r1, "show ipv6 neighbors").join("\n")).toContain("2001:0db8:0100:0000:0000:0000:0000:0002");
  });

  it("traces an IPv6 route hop by hop", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    net.connect(r1.port("Gi0/0"), r2.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::1/64", "no shutdown", "ipv6 route 2001:db8:200::/64 2001:db8:100::2", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::2/64", "no shutdown", "interface g0/1", "ipv6 address 2001:db8:200::1/64", "no shutdown", "end");
    net.clock.advance(3_000);
    const out = type(r1, "traceroute ipv6 2001:db8:200::2");
    expect(out.join("\n")).toContain("2001:0db8:0100:0000:0000:0000:0000:0002");
    expect(out.join("\n")).toContain("2001:0db8:0200:0000:0000:0000:0000:0002");
  });

  it("pings an IPv6 destination from IOS", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    net.connect(r1.port("Gi0/0"), r2.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::1/64", "no shutdown", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8:100::2/64", "no shutdown", "end");
    net.clock.advance(3_000);
    const out = type(r1, "ping ipv6 2001:db8:100::2");
    expect(out.join("\n")).toContain("Success rate is 100 percent (5/5)");
  });
});
