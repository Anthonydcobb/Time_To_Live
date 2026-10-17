// Output checked against real Cisco gear. Ant captures these in CML (IOL, IOS XE 17)
// and the raw sessions live in the project files under code/captures. Trailing
// spaces don't survive the paste, so lines are compared with them trimmed.
import { describe, expect, it } from "vitest";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

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
});
