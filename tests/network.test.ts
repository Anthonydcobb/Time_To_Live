import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Network } from "../src/sim/network";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { captureLogs, type } from "./helpers";

const STP_SETTLE_MS = 31_000;

function configuredStore() {
  const store = cornerStore();
  type(store.r1, "en", "conf t", "hostname R1", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
  store.register.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
  store.office.configure(ip("192.168.1.11"), ip("255.255.255.0"), ip("192.168.1.1"));
  store.net.clock.advance(STP_SETTLE_MS);
  return store;
}

describe("link state", () => {
  it("logs LINK and then LINEPROTO a second later on no shutdown", () => {
    const { net, r1 } = cornerStore();
    const logs = captureLogs(r1);
    type(r1, "en", "conf t", "int g0/0", "no shut");
    expect(logs).toEqual(["%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to up"]);
    net.clock.advance(1000);
    expect(logs[1]).toBe("%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up");
    type(r1, "shutdown");
    expect(logs.slice(2)).toEqual([
      "%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to administratively down",
      "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to down",
    ]);
  });

  it("shows interface status in show ip interface brief", () => {
    const { r1 } = configuredStore();
    const out = type(r1, "show ip interface brief");
    expect(out[0]).toBe("Interface              IP-Address      OK? Method Status                Protocol ");
    expect(out[1]).toBe("GigabitEthernet0/0     192.168.1.1     YES manual up                    up ");
    expect(out[2]).toBe("GigabitEthernet0/1     unassigned      YES unset  administratively down down ");
  });

  it("shows switch ports as up or down depending on cables", () => {
    const { s1 } = configuredStore();
    const out = type(s1, "show ip interface brief");
    expect(out.find((l) => l.startsWith("FastEthernet0/1 "))).toMatch(/up\s+up $/);
    expect(out.find((l) => l.startsWith("FastEthernet0/3 "))).toMatch(/down\s+down $/);
    expect(out.find((l) => l.startsWith("Vlan1 "))).toMatch(/administratively down down $/);
  });
});

describe("the corner store", () => {
  it("can't forward until spanning tree finishes listening and learning", () => {
    const { net, register } = cornerStore();
    register.configure(ip("192.168.1.10"), ip("255.255.255.0"));
    const office = net.device("PC1") as Pc;
    office.configure(ip("192.168.1.11"), ip("255.255.255.0"));
    net.clock.advance(2000);
    expect(register.shell.execute("ping -n 1 192.168.1.11")).toContain("Request timed out.");
    net.clock.advance(STP_SETTLE_MS);
    expect(register.shell.execute("ping -n 1 192.168.1.11").some((l) => l.startsWith("Reply from 192.168.1.11"))).toBe(true);
  });

  it("pings PC to PC and PC to router", () => {
    const { register } = configuredStore();
    const toPc = register.shell.execute("ping 192.168.1.11");
    expect(toPc).toContain("    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),");
    expect(toPc.find((l) => l.startsWith("Reply"))).toMatch(/TTL=128$/);
    const toRouter = register.shell.execute("ping 192.168.1.1");
    expect(toRouter.find((l) => l.startsWith("Reply"))).toMatch(/TTL=255$/);
  });

  it("drops the first router ping while it ARPs, like real IOS", () => {
    const { r1 } = configuredStore();
    const out = type(r1, "ping 192.168.1.10");
    expect(out[2]).toBe(".!!!!");
    expect(out[3]).toMatch(/^Success rate is 80 percent \(4\/5\)/);
    expect(type(r1, "ping 192.168.1.10")[2]).toBe("!!!!!");
  });

  it("fills the ARP and MAC address tables", () => {
    const { r1, s1, register } = configuredStore();
    register.shell.execute("ping 192.168.1.1");
    const arp = type(r1, "show arp");
    expect(arp[0]).toBe("Protocol  Address          Age (min)  Hardware Addr   Type   Interface");
    expect(arp.some((l) => l.startsWith("Internet  192.168.1.10 ") && l.endsWith("ARPA   GigabitEthernet0/0"))).toBe(true);
    const macs = type(s1, "show mac address-table");
    expect(macs.some((l) => l.endsWith("Fa0/1"))).toBe(true);
    expect(macs.some((l) => l.endsWith("Gig0/1"))).toBe(true);
    expect(register.shell.execute("arp -a").some((l) => l.includes("192.168.1.1 "))).toBe(true);
  });

  it("reaches the switch management address once Vlan1 is up", () => {
    const { s1, register } = configuredStore();
    type(s1, "en", "conf t", "int vlan 1", "ip address 192.168.1.2 255.255.255.0", "no shut", "exit", "ip default-gateway 192.168.1.1", "end");
    expect(register.shell.execute("ping -n 2 192.168.1.2")).toContain("    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),");
  });

  it("fails with a general failure when the PC has no IP", () => {
    const { register } = cornerStore();
    expect(register.shell.execute("ping 192.168.1.1")).toEqual(["PING: transmit failed. General failure."]);
  });
});

describe("routing", () => {
  function twoSubnets() {
    const net = new Network();
    const r = net.add(new Router("R1"));
    const a = net.add(new Pc("A"));
    const b = net.add(new Pc("B"));
    net.connect(a.nic, r.port("Gig0/0"));
    net.connect(b.nic, r.port("Gig0/1"));
    type(r, "en", "conf t", "int g0/0", "ip add 192.168.1.1 255.255.255.0", "no shut", "int g0/1", "ip add 10.0.0.1 255.255.255.0", "no shut", "end");
    net.clock.advance(2000);
    return { net, r, a, b };
  }

  it("needs a default gateway to leave the subnet", () => {
    const { a, b } = twoSubnets();
    a.configure(ip("192.168.1.10"), ip("255.255.255.0"));
    b.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    expect(a.shell.execute("ping -n 1 10.0.0.10")).toContain("Request timed out.");
    a.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
    const out = a.shell.execute("ping 10.0.0.10");
    expect(out.filter((l) => l.startsWith("Reply from 10.0.0.10")).length).toBeGreaterThanOrEqual(3);
    expect(out.find((l) => l.startsWith("Reply"))).toMatch(/TTL=127$/);
  });

  it("prints a routing table with connected and local routes", () => {
    const { r } = twoSubnets();
    type(r, "conf t", "ip route 172.16.0.0 255.255.0.0 10.0.0.2", "end");
    const out = type(r, "show ip route");
    expect(out).toContain("Gateway of last resort is not set");
    expect(out).toContain("      10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks");
    expect(out).toContain("C        10.0.0.0/24 is directly connected, GigabitEthernet0/1");
    expect(out).toContain("L        10.0.0.1/32 is directly connected, GigabitEthernet0/1");
    expect(out).toContain("S     172.16.0.0/16 [1/0] via 10.0.0.2");
  });

  it("answers U when the router has no route", () => {
    const { a } = twoSubnets();
    a.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
    const out = a.shell.execute("ping -n 2 8.8.8.8");
    expect(out).toContain("Reply from 192.168.1.1: Destination host unreachable.");
  });
});
