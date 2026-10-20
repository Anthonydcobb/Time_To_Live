import { describe, expect, it } from "vitest";
import { Network } from "../src/sim/network";
import { Switch } from "../src/sim/devices/switch";
import { type } from "./helpers";

function triangle() {
  const net = new Network();
  const a = net.add(new Switch("A", "A"));
  const b = net.add(new Switch("B", "B"));
  const c = net.add(new Switch("C", "C"));
  for (const sw of [a, b, c]) type(sw, "", "en", "conf t", "int gi0/1", "switchport mode trunk", "int gi0/2", "switchport mode trunk", "end");
  net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
  net.connect(b.port("Gi0/2"), c.port("Gi0/1"));
  net.connect(c.port("Gi0/2"), a.port("Gi0/2"));
  net.clock.advance(35_000);
  return { net, a, b, c };
}

describe("spanning tree", () => {
  it("elects a root and blocks one side of a switch loop", () => {
    const { a, b, c } = triangle();
    expect(a.stpRole(a.port("Gi0/1"), 1)).toBe("designated");
    expect(a.stpRole(a.port("Gi0/2"), 1)).toBe("designated");
    expect(b.stpRole(b.port("Gi0/1"), 1)).toBe("root");
    expect(c.stpRole(c.port("Gi0/2"), 1)).toBe("root");
    expect(c.stpRole(c.port("Gi0/1"), 1)).toBe("alternate");
    expect(c.stpState(c.port("Gi0/1"), 1)).toBe("blocking");
  });

  it("moves the root when a lower bridge priority is configured", () => {
    const { a, b } = triangle();
    type(b, "", "en", "conf t", "spanning-tree vlan 1 priority 0", "end");
    expect(b.bridgePriority(1)).toBe(0);
    expect(b.stpRole(b.port("Gi0/1"), 1)).toBe("designated");
    expect(a.stpRole(a.port("Gi0/1"), 1)).toBe("root");
    expect(type(b, "show spanning-tree").join("\n")).toContain("This bridge is the root");
  });

  it("prints an alternate blocking port", () => {
    const { c } = triangle();
    const output = type(c, "show spanning-tree").join("\n");
    expect(output).toContain("Spanning tree enabled protocol ieee");
    expect(output).toContain("Altn BLK");
  });
});
