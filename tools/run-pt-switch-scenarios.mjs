import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const results = [];
const run = (device, line, mode = "enable") => executeDeviceCommand(device, line, mode).then((r) => r.result ?? r);
const configure = (device, commands) => configureDevice(device, commands);
const output = (result) => String(result?.output ?? "");

async function observe() {
  const devices = {};
  for (const device of ["Switch0", "Switch1"]) {
    const [interfaces, stp, cdp] = await Promise.all([
      run(device, "show interfaces fastethernet 0/1 switchport"),
      run(device, "show spanning-tree"),
      run(device, "show cdp neighbors"),
    ]);
    devices[device] = {
      accessOrTrunk: output(interfaces).match(/Operational Mode: (.+)/)?.[1]?.trim() ?? "unknown",
      uplinkUp: /Status: connected|Port is up|Operational Mode:/i.test(output(interfaces)),
      rootAddress: output(stp).match(/Root ID[\s\S]*?Address\s+([^\s]+)/)?.[1] ?? "unknown",
      rootPort: output(stp).match(/\n(Fa\S+)\s+Root\s+/)?.[1] ?? null,
      cdpNeighbor: /\nSwitch\s+/i.test(output(cdp)),
      raw: { interfaces: output(interfaces), stp: output(stp), cdp: output(cdp) },
    };
  }
  return devices;
}

async function scenario(id, description, inject, restore) {
  const before = await observe();
  const injected = await inject();
  const during = await observe();
  await restore();
  const after = await observe();
  results.push({ id, description, before, injected, during, after });
  console.log(`${id}: captured; restored`);
}

await scenario(
  "inter-switch-link-shutdown",
  "Disable Switch0 Fa0/1, the inter-switch connection.",
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await scenario(
  "uplink-mode-mismatch",
  "Force Switch0 Fa0/1 to trunk while Switch1 remains dynamic auto.",
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "switchport mode trunk", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "switchport mode dynamic auto", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await scenario(
  "stp-priority-change",
  "Lower Switch1 VLAN 1 priority to force a root-election change.",
  () => configure("Switch1", [
    { line: "configure terminal", mode: "enable" },
    { line: "spanning-tree vlan 1 priority 4096", mode: "global" },
    { line: "end", mode: "" },
  ]),
  () => configure("Switch1", [
    { line: "configure terminal", mode: "enable" },
    { line: "spanning-tree vlan 1 priority 32768", mode: "global" },
    { line: "end", mode: "" },
  ]),
);

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-switch-scenarios.json", JSON.stringify({ capturedAt: new Date().toISOString(), scenarios: results }, null, 2));
console.log("Wrote harness/artifacts/pt-switch-scenarios.json");
