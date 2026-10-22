import { describe, expect, it } from "vitest";
import { Network } from "../src/sim/network";
import { Switch } from "../src/sim/devices/switch";
import { Pc } from "../src/sim/devices/pc";
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
  it("bundles parallel links and presents one logical STP path", () => {
    const net = new Network();
    const a = net.add(new Switch("A", "A"));
    const b = net.add(new Switch("B", "B"));
    for (const sw of [a, b]) type(sw, "", "en", "conf t", "int gi0/1", "switchport mode trunk", "channel-group 1 mode active", "int gi0/2", "switchport mode trunk", "channel-group 1 mode active", "end");
    net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
    net.connect(a.port("Gi0/2"), b.port("Gi0/2"));
    net.clock.advance(35_000);
    expect(a.channelGroupActive(a.port("Gi0/1"))).toBe(true);
    expect(a.channelGroupActive(a.port("Gi0/2"))).toBe(true);
    expect(a.stpState(a.port("Gi0/1"), 1)).toBe("forwarding");
    expect(a.stpState(a.port("Gi0/2"), 1)).toBe("forwarding");
    expect(type(a, "show etherchannel summary").join("\n")).toContain("Po1-");
    expect(type(a, "show etherchannel summary").join("\n")).toContain("(P)");
  });

  it("leaves an incompatible LACP/PAgP bundle suspended", () => {
    const net = new Network();
    const a = net.add(new Switch("A", "A"));
    const b = net.add(new Switch("B", "B"));
    type(a, "", "en", "conf t", "int gi0/1", "channel-group 1 mode active", "end");
    type(b, "", "en", "conf t", "int gi0/1", "channel-group 1 mode desirable", "end");
    net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
    net.clock.advance(3_000);
    expect(a.channelGroupActive(a.port("Gi0/1"))).toBe(false);
    expect(type(a, "show etherchannel summary").join("\n")).toContain("(s)");
  });

  it("lets a PortFast access port forward as soon as the link is up", () => {
    const net = new Network();
    const sw = net.add(new Switch("S1"));
    const pc = net.add(new Pc("PC"));
    type(sw, "", "en", "conf t", "int gi0/1", "switchport mode access", "spanning-tree portfast", "end");
    net.connect(sw.port("Gi0/1"), pc.nic);
    net.clock.advance(3_000);
    expect(sw.switchport(sw.port("Gi0/1")).portfast).toBe(true);
    expect(sw.stpState(sw.port("Gi0/1"), 1)).toBe("forwarding");
  });

  it("shuts a PortFast BPDU Guard port when a BPDU arrives", () => {
    const net = new Network();
    const edge = net.add(new Switch("EDGE"));
    const upstream = net.add(new Switch("UPSTREAM"));
    type(edge, "", "en", "conf t", "int gi0/1", "switchport mode access", "spanning-tree portfast", "spanning-tree bpduguard enable", "end");
    net.connect(edge.port("Gi0/1"), upstream.port("Gi0/1"));
    net.clock.advance(6_000);
    expect(edge.port("Gi0/1").adminDown).toBe(true);
    expect(type(edge, "show running-config").join("\n")).toContain(" spanning-tree bpduguard enable");
  });

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

  it("supports the IOS spanning-tree show variants", () => {
    const { c } = triangle();
    expect(type(c, "show spanning-tree root").join("\n")).toContain("Root ID");
    expect(type(c, "show spanning-tree blockedports").join("\n")).toContain("blocked ports");
    expect(type(c, "show spanning-tree summary").join("\n")).toContain("Portfast Default");
    expect(type(c, "show spanning-tree detail").join("\n")).toContain("is executing the ieee compatible Spanning Tree Protocol");
    expect(type(c, "show spanning-tree active").join("\n")).toContain("Spanning tree enabled");
    expect(type(c, "show spanning-tree interface gi0/1 detail").join("\n")).toContain("Port 1 (GigabitEthernet0/1)");
  });

  it("reconverges through the alternate path after the root link fails", () => {
    const { net, b } = triangle();
    expect(b.stpRole(b.port("Gi0/2"), 1)).toBe("designated");
    net.disconnect(b.port("Gi0/1"));
    expect(b.stpRole(b.port("Gi0/2"), 1)).toBe("root");
    expect(b.stpState(b.port("Gi0/2"), 1)).toBe("listening");
    net.clock.advance(30_000);
    expect(b.stpState(b.port("Gi0/2"), 1)).toBe("forwarding");
  });
});
