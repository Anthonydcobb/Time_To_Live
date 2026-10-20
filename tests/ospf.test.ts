import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

describe("OSPF", () => {
  it("forms a neighbor and routes between advertised networks", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const pc1 = net.add(new Pc("PC1"));
    const pc2 = net.add(new Pc("PC2"));
    pc1.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
    pc2.configure(ip("10.0.2.10"), ip("255.255.255.0"), ip("10.0.2.1"));
    net.connect(pc1.nic, r1.port("Gi0/0"));
    net.connect(pc2.nic, r2.port("Gi0/0"));
    net.connect(r1.port("Gi0/1"), r2.port("Gi0/1"));
    type(r1, "en", "conf t", "hostname R1", "int gi0/0", "ip address 10.0.1.1 255.255.255.0", "no shut", "int gi0/1", "ip address 10.0.12.1 255.255.255.252", "no shut", "router ospf 1", "network 10.0.1.0 0.0.0.255 area 0", "network 10.0.12.0 0.0.0.3 area 0", "end");
    type(r2, "en", "conf t", "hostname R2", "int gi0/0", "ip address 10.0.2.1 255.255.255.0", "no shut", "int gi0/1", "ip address 10.0.12.2 255.255.255.252", "no shut", "router ospf 1", "network 10.0.2.0 0.0.0.255 area 0", "network 10.0.12.0 0.0.0.3 area 0", "end");
    net.clock.advance(5_000);
    expect(type(r1, "show ip ospf neighbor").join("\n")).toContain("R2");
    const routes = type(r1, "show ip route");
    expect(routes.join("\n")).toContain("O");
    const ping = run(pc1, "ping -n 4 10.0.2.10");
    expect(ping.some((line) => line.startsWith("Reply from 10.0.2.10"))).toBe(true);
  });

  it("re-advertises learned networks through a transit router", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const r3 = net.add(new Router("R3"));
    const pc1 = net.add(new Pc("PC1"));
    const pc3 = net.add(new Pc("PC3"));
    pc1.configure(ip("10.1.0.10"), ip("255.255.255.0"), ip("10.1.0.1"));
    pc3.configure(ip("10.3.0.10"), ip("255.255.255.0"), ip("10.3.0.1"));
    net.connect(pc1.nic, r1.port("Gi0/0"));
    net.connect(r1.port("Gi0/1"), r2.port("Gi0/0"));
    net.connect(r2.port("Gi0/1"), r3.port("Gi0/0"));
    net.connect(pc3.nic, r3.port("Gi0/1"));
    type(r1, "en", "conf t", "int gi0/0", "ip address 10.1.0.1 255.255.255.0", "no shut", "int gi0/1", "ip address 10.12.0.1 255.255.255.252", "no shut", "router ospf 1", "network 10.1.0.0 0.0.0.255 area 0", "network 10.12.0.0 0.0.0.3 area 0", "end");
    type(r2, "en", "conf t", "int gi0/0", "ip address 10.12.0.2 255.255.255.252", "no shut", "int gi0/1", "ip address 10.23.0.1 255.255.255.252", "no shut", "router ospf 1", "network 10.12.0.0 0.0.0.3 area 0", "network 10.23.0.0 0.0.0.3 area 0", "end");
    type(r3, "en", "conf t", "int gi0/0", "ip address 10.23.0.2 255.255.255.252", "no shut", "int gi0/1", "ip address 10.3.0.1 255.255.255.0", "no shut", "router ospf 1", "network 10.23.0.0 0.0.0.3 area 0", "network 10.3.0.0 0.0.0.255 area 0", "end");
    net.clock.advance(8_000);
    expect(type(r1, "show ip route").join("\n")).toContain("10.3.0.0/24");
    const ping = run(pc1, "ping -n 8 10.3.0.10");
    expect(ping.some((line) => line.startsWith("Reply from 10.3.0.10"))).toBe(true);
  });
});
