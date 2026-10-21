import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { parseIpv6 } from "../src/sim/addr";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("IPv6 interface configuration", () => {
  it("normalizes IPv6 addresses and reports them in the brief view", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    type(r1, "", "en", "conf t", "ipv6 unicast-routing", "interface g0/0", "ipv6 address 2001:db8:1::1/64", "no shutdown", "end");
    expect(r1.config.ipv6UnicastRouting).toBe(true);
    expect(r1.ifaceConfig("GigabitEthernet0/0").ipv6Addresses).toEqual([{ address: parseIpv6("2001:db8:1::1"), prefix: 64 }]);
    expect(type(r1, "show ipv6 interface brief").join("\n")).toContain("2001:0db8:0001:0000:0000:0000:0000:0001/64");
  });

  it("rejects malformed IPv6 prefixes", () => {
    const net = new Network();
    const r1 = net.add(new Router("R1"));
    const output = type(r1, "", "en", "conf t", "interface g0/0", "ipv6 address 2001:db8::1/129");
    expect(output).toContain("% Invalid IPv6 address or prefix.");
  });
});
