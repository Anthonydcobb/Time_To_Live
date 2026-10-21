import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

describe("EIGRP", () => {
  it("forms an AS neighbor and routes between advertised networks", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const r2 = net.add(new Router("R2"));
    const pc1 = net.add(new Pc("PC1"));
    const pc2 = net.add(new Pc("PC2"));
    pc1.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
    pc2.configure(ip("10.0.2.10"), ip("255.255.255.0"), ip("10.0.2.1"));
    net.connect(pc1.nic, r1.port("Gi0/0"));
    net.connect(r1.port("Gi0/1"), r2.port("Gi0/1"));
    net.connect(pc2.nic, r2.port("Gi0/0"));
    type(r1, "", "en", "conf t", "interface g0/0", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "router eigrp 100", "network 10.0.1.0 0.0.0.255", "network 10.0.12.0 0.0.0.3", "end");
    type(r2, "", "en", "conf t", "interface g0/0", "ip address 10.0.2.1 255.255.255.0", "no shutdown", "interface g0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "router eigrp 100", "network 10.0.2.0 0.0.0.255", "network 10.0.12.0 0.0.0.3", "end");
    net.clock.advance(5_000);
    expect(type(r1, "show ip eigrp neighbors").join("\n")).toContain("10.0.12.2");
    expect(type(r1, "show ip route").join("\n")).toContain("D");
    expect(run(pc1, "ping -n 8 10.0.2.10").some((line) => line.startsWith("Reply from 10.0.2.10"))).toBe(true);
  });
});
