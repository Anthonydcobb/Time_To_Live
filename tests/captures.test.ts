// Output checked against real Cisco gear. Ant captures these in CML (IOL, IOS XE 17)
// and the raw sessions live in the project files under code/captures. Trailing
// spaces don't survive the paste, so lines are compared with them trimmed.
import { describe, expect, it } from "vitest";
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
});
