import { describe, expect, it } from "vitest";
import { parseIpv4 as ip } from "../src/sim/addr";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

function lab() {
  const net = new Network();
  const dns = net.add(new Router("DNS", "DNS"));
  const client = net.add(new Pc("CLIENT", "CLIENT"));
  const printer = net.add(new Pc("PRINTER", "PRINTER"));
  net.connect(client.nic, dns.port("Gi0/0"));
  net.connect(printer.nic, dns.port("Gi0/1"));
  type(dns, "en", "conf t", "int gi0/0", "ip address 10.0.0.1 255.255.255.0", "no shut", "int gi0/1", "ip address 10.0.1.1 255.255.255.0", "no shut", "ip dns server", "ip host printer.office.test 10.0.1.10", "end");
  client.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
  client.dnsServers = [ip("10.0.0.1")!];
  printer.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
  net.clock.advance(3_000);
  return { net, dns, client };
}

describe("DNS", () => {
  it("resolves a host record over the routed IPv4 path before pinging it", () => {
    const { client } = lab();
    const out = run(client, "ping -n 4 printer.office.test");
    expect(out[0]).toBe("Pinging printer.office.test [10.0.1.10] with 32 bytes of data:");
    expect(out.some((line) => line.startsWith("Reply from 10.0.1.10"))).toBe(true);
    expect(out).toContain("    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),");
  });

  it("shows the DNS service and static host records in IOS output", () => {
    const { dns } = lab();
    expect(type(dns, "show hosts").join("\n")).toContain("10.0.1.10          printer.office.test");
    const running = type(dns, "show running-config").join("\n");
    expect(running).toContain("ip dns server");
    expect(running).toContain("ip host printer.office.test 10.0.1.10");
  });

  it("reports a normal name-resolution failure when DNS has no answer", () => {
    const { client } = lab();
    expect(run(client, "ping -n 1 missing.office.test")).toEqual(["Ping request could not find host. Please check the name and try again."]);
  });
});
