import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { permitsStandardAcl } from "../src/sim/ios/acl";
import { run, type } from "./helpers";

describe("standard IPv4 ACLs", () => {
  it("supports named standard ACL submode and interface attachment", () => {
    const net = new Network();
    const router = net.add(new Router("R1", "R1"));
    type(router, "en", "conf t", "int g0/0", "ip address 10.0.0.1 255.255.255.0", "no shut", "ip access-list standard BLOCKED", "deny 10.0.0.10", "permit any", "exit", "int g0/0", "ip access-group BLOCKED in", "end");
    const blocked = { kind: "ipv4" as const, src: ip("10.0.0.10")!, dst: ip("10.0.0.1")!, ttl: 64, icmp: { type: "echo-request" as const, id: 1, seq: 1 } };
    const allowed = { ...blocked, src: ip("10.0.0.20")! };
    expect(permitsStandardAcl(router.config, "GigabitEthernet0/0", blocked, "in")).toBe(false);
    expect(permitsStandardAcl(router.config, "GigabitEthernet0/0", allowed, "in")).toBe(true);
    const config = type(router, "show running-config").join("\n");
    expect(config).toContain("ip access-list standard BLOCKED");
    expect(config).toContain(" ip access-group BLOCKED in");
  });

  it("blocks a matching source and permits later sources", () => {
    const net = new Network();
    const router = net.add(new Router("R1", "R1"));
    const blocked = net.add(new Pc("BLOCKED"));
    type(router, "en", "conf t", "int g0/0", "ip address 10.0.0.1 255.255.255.0", "no shut", "access-list 10 deny 10.0.0.10", "access-list 10 permit any", "int g0/0", "ip access-group 10 in", "end");
    blocked.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    net.connect(blocked.nic, router.port("Gig0/0"));
    net.clock.advance(3_000);
    expect(run(blocked, "ping -n 1 10.0.0.1")).toContain("Request timed out.");
    const config = type(router, "show running-config").join("\n");
    expect(config).toContain("access-list 10 deny 10.0.0.10");
    expect(config).toContain("access-list 10 permit any");
    expect(config).toContain(" ip access-group 10 in");
    expect(permitsStandardAcl(router.config, "GigabitEthernet0/0", { kind: "ipv4", src: ip("10.0.0.20")!, dst: ip("10.0.0.1")!, ttl: 64, icmp: { type: "echo-request", id: 1, seq: 1 } }, "in")).toBe(true);
  });

  it("implicitly denies traffic when an attached ACL has no matching permit", () => {
    const net = new Network();
    const router = net.add(new Router("R1", "R1"));
    const pc = net.add(new Pc("PC"));
    type(router, "en", "conf t", "int g0/0", "ip address 10.0.0.1 255.255.255.0", "no shut", "access-list 11 permit 10.0.1.0 0.0.0.255", "int g0/0", "ip access-group 11 in", "end");
    pc.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    net.connect(pc.nic, router.port("Gig0/0"));
    net.clock.advance(3_000);
    const deniedPing = run(pc, "ping -n 2 10.0.0.1");
    expect(deniedPing.some((line) => line.startsWith("Reply from 10.0.0.1"))).toBe(false);
  });

  it("supports extended ACLs that distinguish ICMP from other IP traffic", () => {
    const net = new Network();
    const router = net.add(new Router("R1", "R1"));
    type(
      router,
      "en",
      "conf t",
      "access-list 101 deny icmp 10.0.0.10 10.0.0.1",
      "access-list 101 permit ip any any",
      "int g0/0",
      "ip access-group 101 in",
      "end",
    );
    const icmp = {
      kind: "ipv4" as const,
      src: ip("10.0.0.10")!,
      dst: ip("10.0.0.1")!,
      ttl: 64,
      icmp: { type: "echo-request" as const, id: 1, seq: 1 },
    };
    const ipPacket = {
      kind: "ipv4" as const,
      src: ip("10.0.0.10")!,
      dst: ip("10.0.0.1")!,
      ttl: 64,
    };
    expect(
      permitsStandardAcl(router.config, "GigabitEthernet0/0", icmp, "in"),
    ).toBe(false);
    expect(
      permitsStandardAcl(router.config, "GigabitEthernet0/0", ipPacket, "in"),
    ).toBe(true);
    expect(type(router, "show access-lists")).toContain(
      "Extended IP access list 101",
    );
  });
});
