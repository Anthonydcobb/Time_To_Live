import { mkdir, writeFile } from "node:fs/promises";
import { captureNormalizedTopology } from "./pt-topology.mjs";

const topology = await captureNormalizedTopology();
await mkdir("harness/artifacts", { recursive: true });
await writeFile(
  "harness/artifacts/pt-topology-normalized.json",
  `${JSON.stringify(topology, null, 2)}\n`,
);

console.log(JSON.stringify({
  deviceCount: topology.devices.length,
  edgeCount: topology.edges.length,
  edges: topology.edges,
  cliDevices: topology.devices.filter((device) => device.cliCapable).map((device) => device.name),
  interfaceCounts: Object.fromEntries(topology.devices.map((device) => [device.name, device.interfaceSummary.length])),
  vlanCounts: Object.fromEntries(topology.devices.map((device) => [device.name, device.vlanSummary.length])),
  artifact: "harness/artifacts/pt-topology-normalized.json",
}, null, 2));
