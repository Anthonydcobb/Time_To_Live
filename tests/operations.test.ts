import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("operations services", () => {
  it("configures and verifies NTP and syslog", () => {
    const net = new Network();
    const router = net.add(new Router("R1"));
    type(router, "", "en", "conf t", "ntp server 192.0.2.10", "logging host 192.0.2.20", "logging trap 4", "end");
    expect(type(router, "show ntp status").join("\n")).toContain("Clock is synchronized");
    expect(type(router, "show ntp associations").join("\n")).toContain("192.0.2.10");
    expect(type(router, "show logging").join("\n")).toContain("192.0.2.20");
    expect(router.config.ntpServers).toEqual([ip("192.0.2.10")]);
    expect(router.config.loggingTrap).toBe(4);
  });

  it("configures read-only and read-write SNMP communities", () => {
    const net = new Network();
    const router = net.add(new Router("R1"));
    type(router, "", "en", "conf t", "snmp-server community monitor ro", "snmp-server community automation rw", "end");
    const output = type(router, "show snmp").join("\n");
    expect(output).toContain("monitor (ro)");
    expect(output).toContain("automation (rw)");
    expect(router.config.snmpCommunities).toHaveLength(2);
  });

  it("retains interface events in the IOS log buffer", () => {
    const net = new Network();
    const router = net.add(new Router("R1"));
    const peer = net.add(new Router("R2"));
    type(router, "", "en", "conf t", "interface Gi0/0", "no shutdown", "end");
    type(peer, "", "en", "conf t", "interface Gi0/0", "no shutdown", "end");
    net.connect(router.port("Gi0/0"), peer.port("Gi0/0"));
    net.clock.advance(3_000);

    const output = type(router, "show logging").join("\n");
    expect(output).toContain("Log buffer: 3 messages (maximum 100)");
    expect(output).toContain("%LINK-3-UPDOWN: Interface GigabitEthernet0/0, changed state to up");
    expect(output).toContain("%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up");

    net.disconnect(router.port("Gi0/0"));
    expect(type(router, "show logging").join("\n")).toContain("changed state to down");
  });
});
