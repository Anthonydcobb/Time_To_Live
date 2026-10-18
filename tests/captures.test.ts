// Output checked against real Cisco gear. Ant captures these in CML (IOL, IOS XE 17)
// and the raw sessions live in the project files under code/captures. Trailing
// spaces don't survive the paste, so lines are compared with them trimmed.
import { describe, expect, it } from "vitest";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { Network } from "../src/sim/network";
import { help } from "../src/sim/ios/parser";
import { captureLogs, type } from "./helpers";

function router() {
  const net = new Network();
  const r1 = net.add(new Router("R1", "R1"));
  type(r1, "", "enable");
  return r1;
}

const trimmed = (lines: string[]) => lines.map((l) => l.trimEnd());

describe("captured from real IOS", () => {
  it("lines up show ip interface brief", () => {
    // IOL says "TFTP" in the Method column because CML loads its config at boot. A factory 2911 says "unset".
    expect(trimmed(type(router(), "show ip interface brief")).slice(0, 2)).toEqual([
      "Interface              IP-Address      OK? Method Status                Protocol",
      "GigabitEthernet0/0     unassigned      YES unset  administratively down down",
    ]);
  });

  it("puts the caret under the first letter that stops matching", () => {
    const r1 = router();
    type(r1, "conf t");
    expect(type(r1, "hostnme R1")).toEqual(["                ^", "% Invalid input detected at '^' marker.", ""]);
  });

  it("points at the number when the interface type exists but the interface doesn't", () => {
    // Captured as "int g0/0" on IOL, which has only Ethernet0/x. Our CR-2911 has Gi0/0 to Gi0/2, so use Gi0/5.
    const r1 = router();
    type(r1, "conf t");
    expect(type(r1, "int g0/5")[0]).toBe("                ^");
    expect(type(r1, "e0/0")[0]).toBe("            ^");
  });

  it("rejects a network address with IOS's bad mask message", () => {
    const r1 = router();
    type(r1, "conf t", "int g0/0");
    expect(type(r1, "ip address 192.168.1.0 255.255.255.0")).toEqual(["Bad mask /24 for address 192.168.1.0"]);
  });

  it("stamps log messages and brings the link up after autonegotiation", () => {
    // Captured: CONFIG_I at :22.926, LINK up at :23.420, LINEPROTO at :24.420.
    // IOL logs %LINK-5-UPDOWN because it's IOS XE; IOS 15 on a 2911 logs %LINK-3-UPDOWN.
    const net = new Network();
    const r1 = net.add(new Router("R1", "R1"));
    net.connect(net.add(new Pc("PC0")).nic, r1.port("Gi0/0"));
    const logs: { at: number; text: string }[] = [];
    r1.onOutput((text) => logs.push({ at: net.clock.now, text }));
    type(r1, "", "enable", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shut", "end");
    net.clock.advance(5000);
    const stamp = /^\*Mar  1 \d\d:\d\d:\d\d\.\d{3}: /;
    for (const l of logs) expect(l.text).toMatch(stamp);
    const msgs = logs.map((l) => l.text.replace(stamp, ""));
    expect(msgs).toEqual([
      "%SYS-5-CONFIG_I: Configured from console by console",
      "%LINK-3-UPDOWN: Interface GigabitEthernet0/0, changed state to up",
      "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up",
    ]);
    expect(logs[2].at - logs[1].at).toBe(1000);
  });

  it("heads show running-config the way IOS does", () => {
    // Captured on IOL 17.15 as "! Last configuration change at 23:06:22 UTC Sat Oct 17 2026".
    // A 2911 has no clock set, so it counts from Mar 1 1993. IOS 15 lines replace the IOS XE ones.
    const r1 = router();
    r1.clock.advance(65_000);
    type(r1, "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "end");
    const run = type(r1, "show running-config");
    expect(run.slice(0, 7)).toEqual([
      "Building configuration...",
      "",
      expect.stringMatching(/^Current configuration : \d+ bytes$/),
      "!",
      "! Last configuration change at 00:01:05 UTC Mon Mar 1 1993",
      "!",
      "version 15.1",
    ]);
    for (const l of ["boot-start-marker", "no aaa new-model", "ip cef", "ip forward-protocol nd", "control-plane", "end"]) expect(run).toContain(l);
    expect(run.indexOf("line aux 0")).toBe(run.indexOf("line con 0") + 1);
  });

  it("prints the full show interfaces block with counters", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1", "R1"));
    net.connect(net.add(new Pc("PC0")).nic, r1.port("Gi0/0"));
    type(r1, "", "enable", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shut", "end");
    net.clock.advance(60_000);
    const out = type(r1, "show interfaces g0/0");
    // Same lines as the capture, except where a 2911's gigabit port differs from IOL's Ethernet0/0.
    expect(out.slice(0, 10)).toEqual([
      "GigabitEthernet0/0 is up, line protocol is up ",
      expect.stringMatching(/^  Hardware is CN Gigabit Ethernet, address is (\w{4}\.\w{4}\.\w{4}) \(bia \1\)$/),
      "  Internet address is 192.168.1.1/24",
      "  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec, ",
      "     reliability 255/255, txload 1/255, rxload 1/255",
      "  Encapsulation ARPA, loopback not set",
      "  Keepalive set (10 sec)",
      "  Full Duplex, 1Gbps, media type is RJ45",
      "  output flow-control is unsupported, input flow-control is unsupported",
      "  ARP type: ARPA, ARP Timeout 04:00:00",
    ]);
    expect(out[10]).toMatch(/^  Last input never, output 00:00:0\d, output hang never$/);
    // Keepalives go out every 10 seconds even with nothing else to say.
    expect(out.find((l) => l.includes("packets output"))).toMatch(/^     [1-9]\d* packets output, \d+ bytes, 0 underruns$/);
    expect(out[out.length - 1]).toBe("     0 output buffer failures, 0 output buffers swapped out");
  });

  it("filters show output after a pipe, but only for show", () => {
    const r1 = router();
    type(r1, "conf t", "ip dhcp excluded-address 192.168.1.1");
    // "sh" matches the config-mode shell command, so the caret lands under "run".
    expect(type(r1, "sh run | section dhcp")).toEqual(["              ^", "% Invalid input detected at '^' marker.", ""]);
    expect(type(r1, "do sh run | i dhcp")).toEqual(["ip dhcp excluded-address 192.168.1.1"]);
    expect(type(r1, "do sh run | section dhcp")).toEqual(["ip dhcp excluded-address 192.168.1.1"]);
  });

  it("only removes a DHCP exclusion typed exactly as it was added", () => {
    const r1 = router();
    type(r1, "conf t", "ip dhcp excluded-address 192.168.1.1");
    expect(type(r1, "no ip dhcp excluded-address 192.168.1.1")).toEqual([]);
    expect(type(r1, "no ip dhcp excluded-address 192.168.1.1 192.168.1.10")).toEqual([
      "% Range [192.168.1.1, 192.168.1.10] is not in the database.",
    ]);
  });

  it("matches the DHCP pool help screens", () => {
    const r1 = router();
    type(r1, "conf t");
    expect(r1.console.help("ip dhcp pool ").lines).toEqual(["  WORD  Pool name", ""]);
    expect(r1.console.help("ip dhcp pool LAN ").lines).toEqual(["  <cr>", ""]);
    type(r1, "ip dhcp pool LAN");
    const top = r1.console.help("").lines;
    expect(top[0]).toBe("DHCP pool configuration commands:");
    expect(top.some((l) => l.startsWith("  end "))).toBe(false);
    expect(top).toContain("  exit            Exit from DHCP pool configuration mode");
    expect(r1.console.help("network ").lines).toEqual(["  A.B.C.D  Network number in dotted-decimal notation", ""]);
    expect(r1.console.help("network 192.").lines).toEqual(["A.B.C.D  ", ""]);
    expect(r1.console.help("network 192.168.1.0 ").lines).toEqual(["  /nn or A.B.C.D  Network mask or prefix length", "  <cr>", ""]);
    expect(r1.console.help("def").lines).toEqual(["default-router  ", ""]);
    expect(r1.console.help("default-router ").lines).toEqual(["  Hostname or A.B.C.D  Router's name or IP address", ""]);
    expect(type(r1, "default-router 192.168.1.1 end")[0]).toBe(" ".repeat(43) + "^");
  });

  it("takes a pool network with no mask as classful", () => {
    const r1 = router();
    type(r1, "conf t", "ip dhcp pool LAN", "network 192.168.1.0", "end");
    expect(type(r1, "show running-config")).toContain(" network 192.168.1.0 255.255.255.0");
  });

  it("heads the exec help list", () => {
    expect(router().console.help("").lines[0]).toBe("Exec commands:");
  });

  it("labels the show ip dhcp help like IOS", () => {
    const r1 = router();
    expect(r1.console.help("show ip ").lines).toContain("  dhcp       Show items in the DHCP database");
    expect(r1.console.help("show ip dhcp ").lines).toEqual([
      "  binding   DHCP address bindings",
      "  conflict  DHCP address conflicts",
      "  pool      DHCP pools information",
      "",
    ]);
  });

  it("boots like IOS, with the legend and the setup dialog on a blank box", () => {
    const r1 = router();
    const boot = r1.console.boot();
    expect(boot).toContain("              Restricted Rights Legend");
    expect(boot.slice(-2)).toEqual(["         --- System Configuration Dialog ---", ""]);
    expect(r1.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [yes/no]: ");
  });

  it("carets hostname in exec mode under the o, since h still matches help", () => {
    const r1 = router();
    expect(type(r1, "hostname SW1")[0]).toBe("    ^");
    expect(type(r1, "help")[0]).toBe("Help may be requested at any point in a command by entering");
  });

  it("refuses to delete or rename VLAN 1", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    type(s1, "", "en", "conf t");
    expect(type(s1, "no vlan 1")).toEqual(["%Default VLAN 1 may not be deleted."]);
    type(s1, "vlan 1");
    expect(type(s1, "name LOBBY")).toEqual(["%Default VLAN 1 may not have its name changed."]);
    expect(type(s1, "exit")).toEqual([]);
    expect(s1.vlans.get(1)).toBe("default");
  });

  it("names the port when nonegotiate clashes with a dynamic mode", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    type(s1, "", "en", "conf t", "int fa0/2");
    expect(type(s1, "switchport nonegotiate")).toEqual(["Command rejected: Conflict between 'nonegotiate' and 'dynamic' status on this interface: Fa0/2"]);
    expect(type(s1, "switchport access vlan 50")).toEqual(["% Access VLAN does not exist. Creating vlan 50"]);
  });

  it("prints nothing for show interfaces trunk when no port is trunking", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    expect(type(s1, "", "en", "show interfaces trunk")).toEqual([]);
  });

  it("wraps long help text at 79 columns like IOS", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    type(s1, "", "en", "conf t", "int g0/1");
    const help = s1.console.help("switchport ").lines;
    const i = help.findIndex((l) => l.startsWith("  nonegotiate"));
    // Our list is narrower than IOL's (no port-security), so this exactly fits in 79 columns.
    expect(help[i]).toBe("  nonegotiate  Device will not engage in negotiation protocol on this interface");
    expect(help[i].length).toBe(79);
    expect(s1.console.help("switchport mode dynamic ").lines).toEqual([
      "  auto       Set trunking mode dynamic negotiation parameter to AUTO",
      "  desirable  Set trunking mode dynamic negotiation parameter to DESIRABLE",
      "",
    ]);
  });

  it("wraps a help line the way IOL wrapped switchport nonegotiate", () => {
    const kw = (word: string, help: string) => ({ tokens: [{ type: "kw" as const, word, help }], run: () => {} });
    const r = help([kw("port-security", "Security related command"), kw("nonegotiate", "Device will not engage in negotiation protocol on this interface")], "", {});
    expect(r.kind === "list" && r.lines).toEqual([
      "  nonegotiate    Device will not engage in negotiation protocol on this",
      "                 interface",
      "  port-security  Security related command",
      "",
    ]);
  });

  it("bounces line protocol on both switches for 3 s when DTP forms a trunk", () => {
    // Captured: auto on S1, then desirable on S2. Both log down at :35.908 and up at :38.908.
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    const s2 = net.add(new Switch("S2", "S2"));
    net.connect(s1.port("Gi0/1"), s2.port("Gi0/1"));
    net.clock.advance(40_000);
    const logs: { at: number; who: string; text: string }[] = [];
    for (const s of [s1, s2]) s.onOutput((text) => logs.push({ at: net.clock.now, who: s.hostname, text: text.replace(/^\*[^%]*/, "") }));
    const start = net.clock.now;
    type(s2, "", "en", "conf t", "int g0/1", "switchport mode dynamic desirable");
    net.clock.advance(5000);
    const proto = logs.filter((l) => l.text.startsWith("%LINEPROTO"));
    const rows = proto.map((l) => [l.who, l.at - start, l.text]).sort((a, b) => (a[1] as number) - (b[1] as number) || String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ["S1", 0, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down"],
      ["S2", 0, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down"],
      ["S1", 3000, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up"],
      ["S2", 3000, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up"],
    ]);
    expect(s1.operationalMode(s1.port("Gi0/1"))).toBe("trunk");
  });

  it("bounces a trunk when its mode changes from dynamic to trunk", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    const s2 = net.add(new Switch("S2", "S2"));
    net.connect(s1.port("Gi0/1"), s2.port("Gi0/1"));
    type(s2, "", "en", "conf t", "int g0/1", "switchport mode dynamic desirable");
    net.clock.advance(40_000);
    expect(s1.operationalMode(s1.port("Gi0/1"))).toBe("trunk");
    const logs = captureLogs(s1);
    type(s1, "", "en", "conf t", "int g0/1", "switchport mode trunk");
    net.clock.advance(5000);
    expect(logs.filter((l) => l.startsWith("%LINEPROTO"))).toEqual([
      "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down",
      "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up",
    ]);
  });

  it("doesn't bounce an access port set to mode access", () => {
    const net = new Network();
    const s1 = net.add(new Switch("S1", "S1"));
    const s2 = net.add(new Switch("S2", "S2"));
    net.connect(s1.port("Gi0/1"), s2.port("Gi0/1"));
    net.clock.advance(40_000);
    const logs = captureLogs(s1);
    type(s1, "", "en", "conf t", "int g0/1", "switchport mode access");
    net.clock.advance(5000);
    expect(logs.filter((l) => l.startsWith("%LINEPROTO"))).toEqual([]);
  });
});
