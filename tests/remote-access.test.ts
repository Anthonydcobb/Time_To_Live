import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("remote management access", () => {
  it("requires domain and RSA keys before SSH can start", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "username admin secret cisco", "line vty 0 4", "login local", "transport input ssh", "end");
    expect(r.attemptRemoteLogin("ssh", "admin", "cisco")).toEqual({ ok: false, reason: "ssh-not-ready" });

    type(r, "conf t", "ip domain-name ttl.local", "crypto key generate rsa", "end");
    expect(r.attemptRemoteLogin("ssh", "admin", "cisco")).toEqual({ ok: true, protocol: "ssh", username: "admin" });
    expect(type(r, "show ssh")).toContain("SSH Enabled - version 1.99");
  });

  it("reports transport and credential mistakes", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "ip domain-name ttl.local", "crypto key generate rsa", "username admin secret cisco", "line vty 0 4", "login local", "transport input ssh", "end");
    expect(r.attemptRemoteLogin("telnet", "admin", "cisco")).toEqual({ ok: false, reason: "transport-disabled" });
    expect(r.attemptRemoteLogin("ssh", "admin", "wrong")).toEqual({ ok: false, reason: "bad-password" });
    expect(r.attemptRemoteLogin("ssh", "missing", "cisco")).toEqual({ ok: false, reason: "unknown-user" });

    type(r, "conf t", "line vty 0 4", "transport input telnet", "end");
    expect(r.attemptRemoteLogin("telnet", "admin", "cisco")).toEqual({ ok: true, protocol: "telnet", username: "admin" });
    expect(r.attemptRemoteLogin("ssh", "admin", "cisco")).toEqual({ ok: false, reason: "transport-disabled" });
  });

  it("prints the management configuration without exposing cleartext secrets", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "ip domain-name ttl.local", "username admin secret cisco", "line vty 0 4", "login local", "transport input ssh", "end");
    const config = type(r, "show running-config").join("\n");
    expect(config).toContain("ip domain-name ttl.local");
    expect(config).toMatch(/username admin secret 5 \$1\$/);
    expect(config).toContain(" login local");
    expect(config).toContain(" transport input ssh");
    expect(config).not.toContain("username admin secret cisco");
  });
});
