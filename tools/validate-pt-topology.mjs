import { readFile } from "node:fs/promises";

const artifactPath = process.argv[2] ?? "harness/artifacts/pt-topology-normalized.json";
const topology = JSON.parse(await readFile(artifactPath, "utf8"));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const switches = topology.devices.filter((device) => device.type === "SWITCH");
const powerDevices = topology.devices.filter((device) => device.type === "POWER_DISTRIBUTION_DEVICE");
const upLinks = topology.devices.flatMap((device) => device.raw ?? [])
  .filter((entry) => entry.command === "show cdp neighbors" && entry.result?.result?.status === "STATUS_OK");

expect(topology.devices.length >= 3, `expected at least 3 devices, got ${topology.devices.length}`);
expect(switches.length === 2, `expected 2 switches, got ${switches.length}`);
expect(powerDevices.length === 1, `expected 1 power device, got ${powerDevices.length}`);
expect(new Set(topology.devices.map((device) => device.serialNumber)).size === topology.devices.length, "device serials are not unique");
expect(topology.links.filter((link) => link.portUp).length >= 2, "expected at least two up link endpoints");
expect(switches.every((device) => device.cliCapable), "every switch must be CLI-capable");
expect(switches.every((device) => device.cdpNeighbors.length > 0), "every switch must report a CDP neighbor");
expect(upLinks.length >= 2, "expected CDP output from both switches");

const report = {
  artifactPath,
  ok: failures.length === 0,
  checks: {
    deviceCount: topology.devices.length,
    switchCount: switches.length,
    powerDeviceCount: powerDevices.length,
    pcCount: topology.devices.filter((device) => device.type === "PC").length,
    upLinkEndpointCount: topology.links.filter((link) => link.portUp).length,
    cdpDeviceCount: switches.filter((device) => device.cdpNeighbors.length > 0).length,
  },
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
