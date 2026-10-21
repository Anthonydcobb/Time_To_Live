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
});
