import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

describe("static NAT", () => {
  it("translates a public address to an inside host", () => {
    const net = new Network();
    const inside = net.add(new Pc("Inside"));
    const outside = net.add(new Pc("Outside"));
    const router = net.add(new Router("R1"));
    inside.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    outside.configure(ip("203.0.113.2"), ip("255.255.255.0"), ip("203.0.113.1"));
    net.connect(inside.nic, router.port("Gi0/0"));
    net.connect(outside.nic, router.port("Gi0/1"));
    type(router, "", "en", "conf t", "interface g0/0", "ip address 10.0.0.1 255.255.255.0", "ip nat inside", "no shutdown", "interface g0/1", "ip address 203.0.113.1 255.255.255.0", "ip nat outside", "no shutdown", "ip nat inside source static 10.0.0.10 203.0.113.100", "end");
    net.clock.advance(3_000);
    const ping = run(outside, "ping -n 4 203.0.113.100");
    expect(ping.some((line) => line.startsWith("Reply from 203.0.113.100"))).toBe(true);
    const outbound = run(inside, "ping -n 4 203.0.113.2");
    expect(outbound.some((line) => line.startsWith("Reply from 203.0.113.2"))).toBe(true);
    expect(type(router, "show ip nat translations").join("\n")).toContain("203.0.113.100");
    const interfaceOutput = type(router, "show interfaces g0/0").join("\n");
    expect(interfaceOutput).toContain("IP NAT inside");
    expect(type(router, "show interfaces g0/1")).toContain("  IP NAT outside");
    expect(type(router, "show ip interface g0/0")).toContain("  IP NAT inside");
  });

  it("overloads inside ICMP flows on the outside interface", () => {
    const net = new Network();
    const inside = net.add(new Pc("Inside"));
    const outside = net.add(new Pc("Outside"));
    const router = net.add(new Router("R1"));
    inside.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    outside.configure(ip("203.0.113.2"), ip("255.255.255.0"), ip("203.0.113.1"));
    net.connect(inside.nic, router.port("Gi0/0"));
    net.connect(outside.nic, router.port("Gi0/1"));
    type(router, "", "en", "conf t", "interface g0/0", "ip address 10.0.0.1 255.255.255.0", "ip nat inside", "no shutdown", "interface g0/1", "ip address 203.0.113.1 255.255.255.0", "ip nat outside", "no shutdown", "access-list 1 permit 10.0.0.0 0.0.0.255", "ip nat inside source list 1 interface g0/1 overload", "end");
    net.clock.advance(3_000);
    const ping = run(inside, "ping -n 4 203.0.113.2");
    expect(ping.some((line) => line.startsWith("Reply from 203.0.113.2"))).toBe(true);
    expect(type(router, "show ip nat translations").join("\n")).toContain("icmp 203.0.113.1");
    const statistics = type(router, "show ip nat statistics").join("\n");
    expect(statistics).toContain("Total active translations: 1 (0 static, 1 dynamic; 0 extended)");
    expect(statistics).toContain("Inside interfaces: GigabitEthernet0/0");
    expect(statistics).toContain("Outside interfaces: GigabitEthernet0/1");
    expect(statistics).toContain("access-list 1 interface GigabitEthernet0/1 overload (active 1)");
    expect(statistics).toMatch(/Hits: [1-9]\d*  Misses: 0/);
    type(router, "clear ip nat translation *");
    expect(type(router, "show ip nat statistics").join("\n")).toContain("Total active translations: 0 (0 static, 0 dynamic; 0 extended)");
  });
});
