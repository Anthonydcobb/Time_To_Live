import { describe, expect, it } from "vitest";
import { formatIpv4, parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { run, type } from "./helpers";

/** The corner store with R1 up and a DHCP pool for 192.168.1.0/24, after spanning tree settles. */
function served() {
  const s = cornerStore();
  type(s.r1, "", "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit");
  type(s.r1, "ip dhcp excluded-address 192.168.1.1 192.168.1.10", "ip dhcp pool LAN", "network 192.168.1.0 255.255.255.0", "default-router 192.168.1.1", "dns-server 192.168.1.1", "end");
  s.net.clock.advance(35_000);
  return s;
}

const addr = (n: number | null) => (n === null ? null : formatIpv4(n));

describe("DHCP", () => {
  it("leases the first free address after the excluded range", () => {
    const { r1, register } = served();
    const out = run(register, "ipconfig /dhcp");
    expect(out).toContain("   IPv4 Address....................: 192.168.1.11");
    expect(addr(register.gateway)).toBe("192.168.1.1");
    const binding = type(r1, "show ip dhcp binding");
    expect(binding[4]).toMatch(/^192\.168\.1\.11 {8}01[0-9a-f]{2}\.[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{2} +Mar 02 1993 12:\d\d AM +Automatic$/);
    expect(run(register, "ping -n 1 192.168.1.1").some((l) => l.startsWith("Reply from 192.168.1.1"))).toBe(true);
  });

  it("gives each client its own address and keeps it on renew", () => {
    const { register, office } = served();
    run(register, "ipconfig /dhcp");
    run(office, "ipconfig /dhcp");
    expect(addr(register.ip)).toBe("192.168.1.11");
    expect(addr(office.ip)).toBe("192.168.1.12");
    run(office, "ipconfig /renew");
    expect(addr(office.ip)).toBe("192.168.1.12");
    expect(run(register, "ping -n 1 192.168.1.12").some((l) => l.startsWith("Reply from 192.168.1.12"))).toBe(true);
  });

  it("pings an address before offering it and skips one already in use", () => {
    const { r1, register, office } = served();
    office.configure(ip("192.168.1.11"), ip("255.255.255.0"), ip("192.168.1.1"));
    run(register, "ipconfig /dhcp");
    expect(addr(register.ip)).toBe("192.168.1.12");
    const conflicts = type(r1, "show ip dhcp conflict");
    expect(conflicts[1]).toMatch(/^192\.168\.1\.11 +Ping +Mar 01 1993/);
  });

  it("falls back to 169.254.x.x when no server answers", () => {
    const { r1, register } = cornerStore();
    type(r1, "", "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "end");
    r1.clock.advance(35_000);
    const start = register.clock.now;
    const out = run(register, "ipconfig /dhcp");
    expect(out).toEqual(["An error occurred while renewing interface FastEthernet0 : unable to contact your DHCP server. Request has timed out."]);
    expect(register.clock.now - start).toBeGreaterThanOrEqual(60_000);
    expect(addr(register.ip)).toMatch(/^169\.254\./);
    expect(run(register, "ipconfig")).toContain(`   Autoconfiguration IPv4 Address..: ${addr(register.ip)}`);
  });

  it("loses the lease race against spanning tree when the cable goes in", () => {
    const s = cornerStore();
    const { r1, net, register } = s;
    net.disconnect(register.nic);
    type(r1, "", "en", "conf t", "int g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit");
    type(r1, "ip dhcp pool LAN", "network 192.168.1.0 /24", "default-router 192.168.1.1", "end");
    register.dhcp = true;
    net.clock.advance(35_000);
    net.connect(register.nic, s.s1.port("Fa0/1"));
    // Every discover goes out while the switch port is still listening or learning.
    net.clock.advance(64_000);
    expect(addr(register.ip)).toMatch(/^169\.254\./);
    run(register, "ipconfig /renew");
    expect(addr(register.ip)).toBe("192.168.1.2");
  });

  it("only serves the pool for the subnet the request came in on", () => {
    const net = new Network();
    const r = net.add(new Router("R1", "R1"));
    const a = net.add(new Pc("A"));
    const b = net.add(new Pc("B"));
    net.connect(a.nic, r.port("Gig0/0"));
    net.connect(b.nic, r.port("Gig0/1"));
    type(r, "en", "conf t", "int g0/0", "ip address 10.1.0.1 255.255.255.0", "no shut", "int g0/1", "ip address 10.2.0.1 255.255.255.0", "no shut", "exit");
    type(r, "ip dhcp pool ONE", "network 10.1.0.0 255.255.255.0", "default-router 10.1.0.1", "ip dhcp pool TWO", "network 10.2.0.0 255.255.255.0", "default-router 10.2.0.1", "end");
    net.clock.advance(3_000);
    run(a, "ipconfig /dhcp");
    run(b, "ipconfig /dhcp");
    expect(addr(a.ip)).toBe("10.1.0.2");
    expect(addr(b.ip)).toBe("10.2.0.2");
    expect(addr(b.gateway)).toBe("10.2.0.1");
    expect(type(r, "show ip dhcp pool").join("\n")).toContain("Pool TWO :");
  });

  it("writes pools and exclusions into the running config and forgets bindings on reload", () => {
    const { r1, register } = served();
    type(r1, "conf t", "ip dhcp pool LAN", "lease 7", "domain-name springs.local", "end");
    const run_ = type(r1, "show running-config").join("\n");
    expect(run_).toContain(
      "ip dhcp excluded-address 192.168.1.1 192.168.1.10\n!\nip dhcp pool LAN\n network 192.168.1.0 255.255.255.0\n default-router 192.168.1.1\n dns-server 192.168.1.1\n domain-name springs.local\n lease 7\n!",
    );
    run(register, "ipconfig /dhcp");
    type(r1, "copy running-config startup-config", "", "reload", "");
    expect(r1.dhcp.liveBindings()).toHaveLength(0);
  });

  it("refuses /renew on a static adapter, like Windows", () => {
    const { register } = served();
    register.configure(ip("192.168.1.50"), ip("255.255.255.0"));
    expect(run(register, "ipconfig /renew")).toContain("The operation failed as no adapter is in the state permissible for");
  });

  it("gives the address back on /release", () => {
    const { r1, register } = served();
    run(register, "ipconfig /dhcp");
    run(register, "ipconfig /release");
    expect(register.ip).toBeNull();
    register.clock.advance(10);
    expect(r1.dhcp.liveBindings()).toHaveLength(0);
  });
});

describe("job 2: the laundromat", () => {
  it("ticks off every task when the job is done the textbook way", async () => {
    const { laundromat } = await import("../src/sim/scenarios/laundromat");
    const job = laundromat();
    const { r1, kiosk, office, printer, tasks, net } = job;
    const done = () => tasks.map((t) => t.done?.() ?? null);
    // The PCs tried DHCP as soon as their cables were in, and gave up.
    net.clock.advance(64_000);
    expect(addr(kiosk.ip)).toMatch(/^169\.254\./);
    type(r1, "", "en", "conf t", "int g0/0", "ip address 192.168.20.1 255.255.255.0", "no shut", "exit");
    type(r1, "ip dhcp excluded-address 192.168.20.1 192.168.20.20", "ip dhcp pool LAUNDRY", "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "end");
    run(printer, "ipconfig 192.168.20.5 255.255.255.0 192.168.20.1");
    // The switch port facing the router just came up, so spanning tree holds it for 30 seconds.
    net.clock.advance(35_000);
    expect(done()).toEqual([true, true, true, true, false, false, null]);
    run(kiosk, "ipconfig /renew");
    run(office, "ipconfig /renew");
    expect(addr(kiosk.ip)).toBe("192.168.20.21");
    run(kiosk, "ping 192.168.20.5");
    run(office, "ping 192.168.20.5");
    expect(done()).toEqual([true, true, true, true, true, true, null]);
  });
});
