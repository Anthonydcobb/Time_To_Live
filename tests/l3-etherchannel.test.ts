import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Network } from "../src/sim/network";
import { Pc } from "../src/sim/devices/pc";
import { Switch } from "../src/sim/devices/switch";
import { run, type } from "./helpers";

function bundle() {
  const net = new Network();
  const a = net.add(new Switch("A", "A"));
  const b = net.add(new Switch("B", "B"));
  for (const sw of [a, b]) type(sw, "", "en", "conf t", "int gi0/1", "switchport mode trunk", "channel-group 1 mode active", "int gi0/2", "switchport mode trunk", "channel-group 1 mode active", "end");
  net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
  net.connect(a.port("Gi0/2"), b.port("Gi0/2"));
  net.clock.advance(35_000);
  return { net, a, b };
}

describe("job 4 EtherChannel and Layer 3 switching", () => {
  it("keeps a bundle up on the surviving member and rejoins after recovery", () => {
    const { net, a, b } = bundle();
    expect(type(a, "show etherchannel summary").join("\n")).toContain("Po1(SU)");
    net.disconnect(a.port("Gi0/2"));
    net.clock.advance(3_000);
    const failed = type(a, "show etherchannel summary").join("\n");
    expect(failed).toContain("Gi0/1(P)");
    expect(failed).toContain("Gi0/2(D)");
    expect(a.channelGroupActive(a.port("Gi0/1"))).toBe(true);
    expect(a.stpState(a.port("Gi0/1"), 1)).toBe("forwarding");
    net.connect(a.port("Gi0/2"), b.port("Gi0/2"));
    net.clock.advance(35_000);
    expect(type(a, "show etherchannel summary").join("\n")).toContain("Gi0/2(P)");
  });

  it("reports one logical Port-channel to STP and uses the IOS flag layout", () => {
    const { a } = bundle();
    const stp = type(a, "show spanning-tree").join("\n");
    expect(stp).toContain("Po1");
    expect(stp).not.toMatch(/Gi0\/[12].*Desg/);
    const summary = type(a, "show etherchannel summary").join("\n");
    expect(summary).toContain("P - bundled in port-channel");
    expect(summary).toContain("M - not in use, minimum links not met");
    expect(summary).toContain("1      Po1(SU)");
    expect(summary).not.toContain("Port-channel        Protocol    Ports\nGroup");
  });

  it("uses stand-alone I for non-forming negotiation and enables the guard by default", () => {
    const net = new Network();
    const a = net.add(new Switch("A", "A"));
    const b = net.add(new Switch("B", "B"));
    type(a, "", "en", "conf t", "int gi0/1", "channel-group 1 mode passive", "end");
    type(b, "", "en", "conf t", "int gi0/1", "channel-group 1 mode passive", "end");
    net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
    net.clock.advance(3_000);
    const summary = type(a, "show etherchannel summary").join("\n");
    expect(summary).toContain("Po1(SD)");
    expect(summary).toContain("Gi0/1(I)");
    expect(type(a, "show spanning-tree summary").join("\n")).toContain("EtherChannel misconfig guard is enabled");
  });

  it("uses stand-alone I when LACP faces PAgP", () => {
    const net = new Network();
    const a = net.add(new Switch("A", "A"));
    const b = net.add(new Switch("B", "B"));
    type(a, "", "en", "conf t", "int gi0/1", "channel-group 1 mode active", "end");
    type(b, "", "en", "conf t", "int gi0/1", "channel-group 1 mode desirable", "end");
    net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
    net.clock.advance(3_000);
    const summary = type(a, "show etherchannel summary").join("\n");
    expect(summary).toContain("Po1(SD)");
    expect(summary).toContain("Gi0/1(I)");
    expect(summary).not.toContain("Gi0/1(s)");
  });

  it("suspends incompatible members and logs the compatibility reason", () => {
    const { a } = bundle();
    type(a, "", "en", "conf t", "int gi0/2", "speed 10", "duplex half", "end");
    const summary = type(a, "show etherchannel summary").join("\n");
    expect(summary).toContain("Gi0/2(s)");
    expect(type(a, "show logging").join("\n")).toContain("CANNOT_BUNDLE2");
  });

  it("accepts static routes on a routing switch and prints routed ports", () => {
    const sw = new Network().add(new Switch("CORE", "CORE"));
    type(sw, "", "en", "conf t", "ip routing", "ip route 0.0.0.0 0.0.0.0 172.16.0.1", "int gi0/1", "no switchport", "ip address 172.16.0.2 255.255.255.0", "end");
    expect(type(sw, "show ip route").join("\n")).toContain("S*  0.0.0.0/0 [1/0] via 172.16.0.1");
    expect(type(sw, "show running-config").join("\n")).toContain(" no switchport");
  });

  it("supports a routed Port-channel with connected routing", () => {
    const net = new Network();
    const sw = net.add(new Switch("CORE", "CORE"));
    const peer = net.add(new Switch("PEER", "PEER"));
    type(sw, "", "en", "conf t", "ip routing", "int gi0/1", "no switchport", "channel-group 1 mode active", "int gi0/2", "no switchport", "channel-group 1 mode active", "int port-channel 1", "no switchport", "ip address 10.10.0.1 255.255.255.252", "no shutdown", "end");
    type(peer, "", "en", "conf t", "ip routing", "int gi0/1", "no switchport", "channel-group 1 mode active", "int gi0/2", "no switchport", "channel-group 1 mode active", "int port-channel 1", "no switchport", "ip address 10.10.0.2 255.255.255.252", "no shutdown", "end");
    net.connect(sw.port("Gi0/1"), peer.port("Gi0/1"));
    net.connect(sw.port("Gi0/2"), peer.port("Gi0/2"));
    net.clock.advance(35_000);
    expect(type(sw, "show etherchannel summary").join("\n")).toContain("Po1(RU)");
    expect(type(sw, "show ip route").join("\n")).toContain("10.10.0.0");
    expect(type(sw, "show interfaces port-channel 1").join("\n")).toContain("Port-channel1");
  });

  it("retains the existing Layer 3 forwarding behavior", () => {
    const net = new Network();
    const sw = net.add(new Switch("CORE", "CORE"));
    const left = net.add(new Pc("LEFT"));
    const right = net.add(new Pc("RIGHT"));
    type(sw, "", "en", "conf t", "ip routing", "int gi0/1", "no switchport", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "int gi0/2", "no switchport", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "end");
    left.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
    right.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
    net.connect(left.nic, sw.port("Gi0/1"));
    net.connect(right.nic, sw.port("Gi0/2"));
    net.clock.advance(3_000);
    expect(run(left, "ping -n 2 10.0.1.10").some((line) => line.startsWith("Reply from 10.0.1.10"))).toBe(true);
  });
});
