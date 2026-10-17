import { describe, expect, it } from "vitest";
import { formatIpv4, parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { Network } from "../src/sim/network";
import { dentist } from "../src/sim/scenarios/dentist";
import { formatVlanList, parseVlanList } from "../src/sim/vlans";
import { captureLogs, run, type } from "./helpers";

const SETTLE = 35_000;

function oneSwitch() {
  const net = new Network();
  const s1 = net.add(new Switch("S1"));
  const pcs = [1, 2, 3].map((n) => {
    const pc = net.add(new Pc(`PC${n}`, `PC${n}`));
    pc.configure(ip(`10.0.0.${n}`), ip("255.255.255.0"), null);
    net.connect(pc.nic, s1.port(`Fa0/${n}`));
    return pc;
  });
  type(s1, "", "en", "conf t");
  return { net, s1, pcs };
}

function twoSwitches(modeA: string, modeB: string) {
  const net = new Network();
  const a = net.add(new Switch("A", "A"));
  const b = net.add(new Switch("B", "B"));
  type(a, "", "en", "conf t", "int g0/1", ...modeA.split(";"), "end");
  type(b, "", "en", "conf t", "int g0/1", ...modeB.split(";"), "end");
  net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
  net.clock.advance(3_000);
  return { net, a, b, ga: a.port("Gi0/1"), gb: b.port("Gi0/1") };
}

/** Two pings, since a router drops the first packet while it ARPs for the next hop. */
const pings = (from: Pc, to: string) => run(from, `ping -n 2 ${to}`).some((l) => l.startsWith(`Reply from ${to}`));

describe("VLAN database", () => {
  it("creates a VLAN only when you leave config-vlan mode", () => {
    const { s1 } = oneSwitch();
    type(s1, "vlan 10", "name STAFF");
    expect(type(s1, "do show vlan brief").some((l) => l.startsWith("10 "))).toBe(false);
    type(s1, "exit");
    const brief = type(s1, "do show vlan brief");
    expect(brief).toContain("10   STAFF                            active    ");
    expect(brief).toContain("1002 fddi-default                     act/unsup ");
  });

  it("names new VLANs VLAN00xx and creates a list at once", () => {
    const { s1 } = oneSwitch();
    type(s1, "vlan 30,40-41", "end");
    expect([...s1.vlans.entries()].filter(([id]) => id >= 30 && id < 1000)).toEqual([
      [30, "VLAN0030"],
      [40, "VLAN0040"],
      [41, "VLAN0041"],
    ]);
  });

  it("refuses extended VLANs in VTP server mode and protects the defaults", () => {
    const { s1 } = oneSwitch();
    expect(type(s1, "vlan 2000", "exit")).toEqual([
      "% Failed to create VLANs 2000",
      "Extended VLAN(s) not allowed in current VTP mode.",
      "%Failed to commit extended VLAN(s) changes.",
    ]);
    expect(type(s1, "no vlan 1")).toEqual(["%Default VLAN 1 may not be deleted."]);
    expect(type(s1, "vlan 1", "name LOBBY", "exit")).toEqual(["%Default VLAN 1 may not have its name changed."]);
  });

  it("creates a missing access VLAN for you", () => {
    const { s1 } = oneSwitch();
    expect(type(s1, "int fa0/1", "switchport access vlan 50")).toEqual(["% Access VLAN does not exist. Creating vlan 50"]);
    expect(s1.vlans.get(50)).toBe("VLAN0050");
  });

  it("keeps VLANs through erase and reload, until vlan.dat is deleted", () => {
    const { s1 } = oneSwitch();
    type(s1, "vlan 10", "end", "write memory", "erase startup-config", "", "reload", "");
    expect(s1.vlans.has(10)).toBe(true);
    type(s1, "no", "", "en", "delete flash:vlan.dat", "", "");
    // Still there until the reload.
    expect(s1.vlans.has(10)).toBe(true);
    type(s1, "reload", "");
    expect(s1.vlans.has(10)).toBe(false);
    type(s1, "no", "");
    expect(type(s1, "en", "delete flash:vlan.dat", "", "")).toEqual(["%Error deleting flash:/vlan.dat (No such file or directory)"]);
  });

  it("parses and prints VLAN lists like IOS", () => {
    expect(parseVlanList("10,20-22,5")).toEqual([5, 10, 20, 21, 22]);
    expect(parseVlanList("0")).toBeNull();
    expect(parseVlanList("4095")).toBeNull();
    expect(formatVlanList([1, 2, 3, 10, 11, 20])).toBe("1-3,10,11,20");
  });
});

describe("access ports", () => {
  it("keeps VLANs apart on the same switch", () => {
    const { net, s1, pcs } = oneSwitch();
    type(s1, "conf t", "int fa0/1", "switchport mode access", "switchport access vlan 10", "int fa0/2", "switchport mode access", "switchport access vlan 10", "end");
    net.clock.advance(SETTLE);
    expect(pings(pcs[0], "10.0.0.2")).toBe(true);
    expect(pings(pcs[0], "10.0.0.3")).toBe(false);
  });

  it("restarts spanning tree when a port changes VLAN", () => {
    const { net, s1, pcs } = oneSwitch();
    net.clock.advance(SETTLE);
    expect(pings(pcs[0], "10.0.0.2")).toBe(true);
    type(s1, "vlan 10", "exit", "int fa0/1", "switchport access vlan 10", "int fa0/2", "switchport access vlan 10", "end");
    expect(s1.stpState(s1.port("Fa0/1"), 10)).toBe("listening");
    net.clock.advance(SETTLE);
    expect(pings(pcs[0], "10.0.0.2")).toBe(true);
  });

  it("strands ports whose VLAN is deleted", () => {
    const { net, s1, pcs } = oneSwitch();
    type(s1, "vlan 10", "exit", "int fa0/1", "switchport access vlan 10", "int fa0/2", "switchport access vlan 10", "exit", "no vlan 10", "end");
    net.clock.advance(SETTLE);
    expect(pings(pcs[0], "10.0.0.2")).toBe(false);
    const sp = type(s1, "show interfaces fa0/1 switchport");
    expect(sp).toContain("Access Mode VLAN: 10 (Inactive)");
    expect(type(s1, "show vlan brief").some((l) => /Fa0\/1(,|$)/.test(l))).toBe(false);
  });

  it("writes switchport settings into the running config", () => {
    const { s1 } = oneSwitch();
    type(s1, "vlan 10,99", "exit", "int fa0/1", "switchport mode access", "switchport access vlan 10", "int g0/1", "switchport trunk native vlan 99", "switchport trunk allowed vlan 10,99", "switchport mode trunk", "switchport nonegotiate", "end");
    const run = type(s1, "show running-config");
    const at = (name: string) => run.slice(run.indexOf(`interface ${name}`), run.indexOf("!", run.indexOf(`interface ${name}`)));
    expect(at("FastEthernet0/1")).toEqual(["interface FastEthernet0/1", " switchport access vlan 10", " switchport mode access"]);
    expect(at("GigabitEthernet0/1")).toEqual([
      "interface GigabitEthernet0/1",
      " switchport trunk native vlan 99",
      " switchport trunk allowed vlan 10,99",
      " switchport mode trunk",
      " switchport nonegotiate",
    ]);
  });
});

describe("DTP", () => {
  it.each([
    ["switchport mode dynamic auto", "switchport mode dynamic auto", "access", "access"],
    ["switchport mode dynamic auto", "switchport mode dynamic desirable", "trunk", "trunk"],
    ["switchport mode dynamic desirable", "switchport mode dynamic desirable", "trunk", "trunk"],
    ["switchport mode trunk", "switchport mode dynamic auto", "trunk", "trunk"],
    ["switchport mode trunk;switchport nonegotiate", "switchport mode dynamic desirable", "trunk", "access"],
    ["switchport mode access", "switchport mode dynamic desirable", "access", "access"],
  ])("%s with %s → %s / %s", (a, b, modeA, modeB) => {
    const t = twoSwitches(a, b);
    expect(t.a.operationalMode(t.ga)).toBe(modeA);
    expect(t.b.operationalMode(t.gb)).toBe(modeB);
  });

  it("gets nothing from a router, which doesn't speak DTP", () => {
    const { s1 } = dentist();
    s1.clock.advance(3_000);
    expect(s1.operationalMode(s1.port("Gi0/1"))).toBe("down");
    const net = s1.network!;
    const r = net.add(new Router("R9"));
    const sw = net.add(new Switch("S9"));
    type(r, "", "en", "conf t", "int g0/0", "no shut", "end");
    type(sw, "", "en", "conf t", "int g0/1", "switchport mode dynamic desirable", "end");
    net.connect(r.port("Gi0/0"), sw.port("Gi0/1"));
    net.clock.advance(3_000);
    expect(sw.operationalMode(sw.port("Gi0/1"))).toBe("access");
  });

  it("rejects nonegotiate on a dynamic port", () => {
    const { s1 } = oneSwitch();
    expect(type(s1, "int fa0/1", "switchport nonegotiate")).toEqual(["Command rejected: Conflict between 'nonegotiate' and 'dynamic' status."]);
  });
});

describe("trunks", () => {
  it("carries VLANs between switches and flags a native VLAN mismatch", () => {
    const t = twoSwitches("switchport mode trunk", "switchport mode trunk;switchport trunk native vlan 99");
    const logs = captureLogs(t.a);
    for (const [sw, n] of [[t.a, 1], [t.b, 2]] as const) {
      type(sw, "conf t", "vlan 10", "exit", "int fa0/1", "switchport mode access", "switchport access vlan 10", "end");
      const pc = t.net.add(new Pc(`P${n}`, `P${n}`));
      pc.configure(ip(`10.10.0.${n}`), ip("255.255.255.0"), null);
      t.net.connect(pc.nic, sw.port("Fa0/1"));
    }
    t.net.clock.advance(SETTLE + 60_000);
    const p1 = t.net.device("P1") as Pc;
    expect(pings(p1, "10.10.0.2")).toBe(true);
    expect(logs).toContain("%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet0/1 (1), with B GigabitEthernet0/1 (99).");
    expect(type(t.a, "show interfaces trunk")).toEqual([
      "",
      "Port        Mode             Encapsulation  Status        Native vlan",
      "Gi0/1       on               802.1q         trunking      1",
      "",
      "Port        Vlans allowed on trunk",
      "Gi0/1       1-4094",
      "",
      "Port        Vlans allowed and active in management domain",
      "Gi0/1       1,10",
      "",
      "Port        Vlans in spanning tree forwarding state and not pruned",
      "Gi0/1       1,10",
      "",
    ]);
  });

  it("drops a VLAN the trunk doesn't allow", () => {
    const t = twoSwitches("switchport mode trunk;switchport trunk allowed vlan 1", "switchport mode trunk");
    for (const [sw, n] of [[t.a, 1], [t.b, 2]] as const) {
      type(sw, "conf t", "vlan 10", "exit", "int fa0/1", "switchport access vlan 10", "end");
      const pc = t.net.add(new Pc(`P${n}`, `P${n}`));
      pc.configure(ip(`10.10.0.${n}`), ip("255.255.255.0"), null);
      t.net.connect(pc.nic, sw.port("Fa0/1"));
    }
    t.net.clock.advance(SETTLE);
    expect(pings(t.net.device("P1") as Pc, "10.10.0.2")).toBe(false);
    type(t.a, "conf t", "int g0/1", "switchport trunk allowed vlan add 10", "end");
    t.net.clock.advance(SETTLE);
    expect(pings(t.net.device("P1") as Pc, "10.10.0.2")).toBe(true);
  });
});

describe("router-on-a-stick", () => {
  it("won't put an address on a subinterface without encapsulation", () => {
    const { r1 } = dentist();
    expect(type(r1, "", "en", "conf t", "int g0/0.10", "ip address 192.168.10.1 255.255.255.0")).toEqual([
      "Enter configuration commands, one per line.  End with CNTL/Z.",
      "% Configuring IP routing on a LAN subinterface is only allowed if that",
      "subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,",
      "or ISL vLAN.",
      "",
    ]);
    expect(r1.console.prompt()).toBe("Router(config-subif)#");
  });

  it("won't use the same VLAN on two subinterfaces", () => {
    const { r1 } = dentist();
    type(r1, "", "en", "conf t", "int g0/0.10", "encapsulation dot1q 10");
    expect(type(r1, "int g0/0.11", "encapsulation dot1Q 10")).toEqual([
      "Configuration of multiple subinterfaces of the same main interface with the same VID (10) is not permitted.",
      "This VID is already configured on GigabitEthernet0/0.10.",
    ]);
  });

  it("lists a removed subinterface as deleted", () => {
    const { r1 } = dentist();
    type(r1, "", "en", "conf t", "int g0/0.10", "exit", "no int g0/0.10", "end");
    const brief = type(r1, "show ip interface brief");
    expect(brief.find((l) => l.startsWith("GigabitEthernet0/0.10"))).toMatch(/deleted +down $/);
    expect(type(r1, "show running-config").some((l) => l.includes("0/0.10"))).toBe(false);
  });

  it("plays job 3 from start to finish", () => {
    const job = dentist();
    const { r1, s1, frontDesk, billing, xray, tasks } = job;
    type(s1, "", "en", "conf t", "vlan 10", "name STAFF", "vlan 20", "name XRAY", "exit");
    type(s1, "int fa0/1", "switchport mode access", "switchport access vlan 10");
    type(s1, "int fa0/2", "switchport mode access", "switchport access vlan 10");
    type(s1, "int fa0/3", "switchport mode access", "switchport access vlan 20");
    type(s1, "int g0/1", "switchport mode trunk", "end");
    type(r1, "", "en", "conf t", "int g0/0", "no shutdown");
    type(r1, "int g0/0.10", "encapsulation dot1Q 10", "ip address 192.168.10.1 255.255.255.0");
    type(r1, "int g0/0.20", "encapsulation dot1Q 20", "ip address 192.168.20.1 255.255.255.0", "exit");
    type(r1, "ip dhcp excluded-address 192.168.10.1", "ip dhcp excluded-address 192.168.20.1");
    type(r1, "ip dhcp pool STAFF", "network 192.168.10.0 255.255.255.0", "default-router 192.168.10.1");
    type(r1, "ip dhcp pool XRAY", "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "end");
    r1.clock.advance(SETTLE);
    for (const pc of [frontDesk, billing, xray]) run(pc, "ipconfig /renew");
    expect(formatIpv4(frontDesk.ip!)).toMatch(/^192\.168\.10\./);
    expect(formatIpv4(xray.ip!)).toMatch(/^192\.168\.20\./);
    expect(pings(frontDesk, formatIpv4(xray.ip!))).toBe(true);
    expect(tasks.filter((t) => t.done).map((t) => t.done!())).toEqual(tasks.filter((t) => t.done).map(() => true));

    const shown = type(r1, "show running-config");
    const i = shown.indexOf("interface GigabitEthernet0/0.10");
    expect(shown.slice(i, i + 3)).toEqual(["interface GigabitEthernet0/0.10", " encapsulation dot1Q 10", " ip address 192.168.10.1 255.255.255.0"]);
    expect(type(r1, "show interfaces g0/0.20")).toContain("  Encapsulation 802.1Q Virtual LAN, Vlan ID  20.");
    expect(type(s1, "show vlan brief")).toContain("20   XRAY                             active    Fa0/3");
  });
});
