import { describe, expect, it } from "vitest";
import { Pc } from "../src/sim/devices/pc";
import { Router } from "../src/sim/devices/router";
import { Network } from "../src/sim/network";
import { run, type } from "./helpers";

describe("PC console terminal", () => {
  it("opens a console cable session and sends IOS commands to the device", () => {
    const net = new Network();
    const pc = net.add(new Pc("PC1"));
    const router = net.add(new Router("R1"));
    net.connect(pc.rs232, router.consolePort, "console");

    expect(run(pc, "terminal").join("\n")).toContain("Connected to Router console");
    run(pc, "enable");
    expect(router.console.mode).toBe("enable");
    expect(run(pc, "show version").join("\n")).toContain("Router uptime");

    expect(run(pc, "disconnect").join("\n")).toContain("Console connection closed");
    expect(type(router, "show version").join("\n")).toContain("Router uptime");
  });

  it("reports a useful error when no console cable is attached", () => {
    const pc = new Pc("PC1");
    expect(run(pc, "terminal")).toEqual(["No console cable is connected."]);
  });
});
