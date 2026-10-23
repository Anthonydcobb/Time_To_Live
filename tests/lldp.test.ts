import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("LLDP", () => {
  it("discovers an enabled neighbor and expires it after its TTL", () => {
    const net = new Network();
    const router = net.add(new Router("R1", "R1"));
    const sw = net.add(new Switch("S1", "S1"));
    type(router, "", "en", "conf t", "lldp run", "int g0/0", "ip address 10.0.0.1 255.255.255.0", "no shut", "end");
    type(sw, "", "en", "conf t", "lldp run", "int gi0/1", "switchport mode trunk", "end");
    net.connect(router.port("Gi0/0"), sw.port("Gi0/1"));
    net.clock.advance(4_000);

    expect(type(router, "show lldp neighbors").join("\n")).toContain("S1");
    expect(type(router, "show lldp neighbors detail").join("\n")).toContain("Local Interface: GigabitEthernet0/0");
    expect(type(router, "show running-config").join("\n")).toContain("lldp run");

    type(sw, "conf t", "no lldp run", "end");
    net.clock.advance(121_000);
    expect(type(router, "show lldp neighbors").join("\n")).not.toContain("S1");
  });

  it("reports the disabled state until LLDP is enabled", () => {
    const net = new Network();
    const sw = net.add(new Switch("S1", "S1"));
    expect(type(sw, "", "en", "show lldp")).toContain("% LLDP is not enabled");
    type(sw, "conf t", "lldp run", "end");
    expect(type(sw, "show lldp")).toContain("Global LLDP information:");
  });
});
