import { describe, expect, it } from "vitest";
import { Router } from "../src/sim/devices/router";
import { RemoteSession } from "../src/sim/devices/ios-device";
import { Network } from "../src/sim/network";
import { type } from "./helpers";

describe("remote management access", () => {
  it("supports AAA new-model with the local user database", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "aaa new-model", "aaa authentication login default local", "ip domain-name ttl.local", "crypto key generate rsa", "username admin secret cisco", "line vty 0 4", "transport input ssh", "end");
    expect(r.attemptRemoteLogin("ssh", "admin", "cisco")).toEqual({ ok: true, protocol: "ssh", username: "admin" });
    const config = type(r, "show running-config").join("\n");
    expect(config).toContain("aaa new-model");
    expect(config).toContain("aaa authentication login default local");
  });

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

  it("opens an authenticated session that can run IOS commands", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "ip domain-name ttl.local", "crypto key generate rsa", "username admin secret cisco", "line vty 0 4", "login local", "transport input ssh", "end");
    const session = r.openRemoteSession("ssh", "admin", "cisco");
    expect(session).toBeInstanceOf(RemoteSession);
    if (!(session instanceof RemoteSession)) return;
    expect(session.prompt()).toBe("R1#");
    expect(session.input("show version").lines.join("\n")).toContain("R1 uptime");
    expect(session.close().lines).toEqual(["Connection closed by remote host."]);
    expect(session.input("show version").lines).toEqual(["% Session is closed."]);
  });

  it("returns the normal login error instead of opening a failed session", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "username admin secret cisco", "line vty 0 4", "login local", "transport input telnet", "end");
    expect(r.openRemoteSession("ssh", "admin", "cisco")).toEqual({ ok: false, reason: "transport-disabled" });
  });

  it("opens an authenticated Telnet session when VTY transport permits it", () => {
    const r = new Router("R1", "R1");
    new Network().add(r);
    type(r, "", "en", "conf t", "username admin secret cisco", "line vty 0 4", "login local", "transport input telnet", "end");
    const session = r.openRemoteSession("telnet", "admin", "cisco");
    expect(session).toBeInstanceOf(RemoteSession);
    if (!(session instanceof RemoteSession)) return;
    expect(session.protocol).toBe("telnet");
    expect(session.input("show running-config").lines.join("\n")).toContain("username admin secret 5 $1$");
  });
});
