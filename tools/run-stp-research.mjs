import { mkdir, writeFile } from "node:fs/promises";
import { executeDeviceCommand, configureDevice } from "./pt-adapter.mjs";

const switches = ["Switch0", "Switch1", "Switch2"];
const raw = [];
const text = (result) => String(result?.output ?? "");

async function capture(backend, experiment, device, command, mode = "enable") {
  const response = backend === "pt"
    ? await executeDeviceCommand(device, command, mode)
    : null;
  raw.push({ backend, experiment, device, input: command, status: response?.result?.status ?? null, rawOutput: text(response?.result) });
  return response;
}

const variants = [
  "show spanning-tree",
  "show spanning-tree vlan 10",
  "show spanning-tree vlan 20",
  "show spanning-tree root",
  "show spanning-tree summary",
  "show spanning-tree detail",
  "show spanning-tree blockedports",
  "show spanning-tree active",
  "show spanning-tree interface fastEthernet 0/1 detail",
];

for (const device of switches) {
  for (const command of variants) await capture("pt", "show-variants-default", device, command);
}

await configureDevice("Switch1", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 10 priority 24576" },
  { mode: "global", line: "spanning-tree vlan 20 priority 24576" },
  { mode: "", line: "end" },
]);

await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/4" },
  { mode: "", line: "switchport mode dynamic auto" },
  { mode: "", line: "end" },
]);
await new Promise((resolve) => setTimeout(resolve, 2500));
await capture("pt", "mismatched-stp-modes", "Switch0", "show interfaces trunk");
await capture("pt", "mismatched-stp-modes", "Switch2", "show interfaces trunk");
await capture("pt", "mismatched-stp-modes", "Switch0", "show spanning-tree vlan 10");
await capture("pt", "mismatched-stp-modes", "Switch2", "show spanning-tree vlan 10");
await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/4" },
  { mode: "", line: "switchport mode trunk" },
  { mode: "", line: "switchport trunk allowed vlan 10,20" },
  { mode: "", line: "end" },
]);
await new Promise((resolve) => setTimeout(resolve, 2500));

await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 10 priority 24576" },
  { mode: "global", line: "spanning-tree vlan 20 priority 24576" },
  { mode: "", line: "end" },
]);
for (const device of switches) {
  await capture("pt", "root-election-mac-tie-break-equal-priority", device, "show spanning-tree vlan 10");
}
await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 10 priority 32768" },
  { mode: "global", line: "spanning-tree vlan 20 priority 32768" },
  { mode: "", line: "end" },
]);

await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/4" },
  { mode: "", line: "spanning-tree vlan 10 cost 100" },
  { mode: "", line: "end" },
]);
for (const device of switches) {
  await capture("pt", "port-cost-selection", device, "show spanning-tree vlan 10");
}
await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/4" },
  { mode: "", line: "no spanning-tree vlan 10 cost 100" },
  { mode: "", line: "end" },
]);

await capture("pt", "spanning-tree-help", "Switch0", "spanning-tree ?", "enable");
await capture("pt", "spanning-tree-help", "Switch0", "show spanning-tree ?", "enable");
for (const device of switches) {
  await capture("pt", "root-election-priority-change", device, "show spanning-tree vlan 10");
  await capture("pt", "root-election-priority-change", device, "show spanning-tree vlan 20");
}
await configureDevice("Switch1", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 10 priority 32768" },
  { mode: "global", line: "spanning-tree vlan 20 priority 32768" },
  { mode: "", line: "end" },
]);

await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/3" },
  { mode: "", line: "spanning-tree portfast" },
  { mode: "", line: "spanning-tree bpduguard enable" },
  { mode: "", line: "end" },
]);
await capture("pt", "portfast-bpduguard", "Switch2", "show spanning-tree interface fastEthernet 0/3 detail");
await configureDevice("Switch1", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/2" },
  { mode: "", line: "spanning-tree guard root" },
  { mode: "", line: "end" },
]);
await capture("pt", "root-guard", "Switch1", "show spanning-tree inconsistentports");
await capture("pt", "root-guard", "Switch1", "show spanning-tree interface fastEthernet 0/2 detail");
await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 1 priority 0" },
  { mode: "", line: "end" },
]);
await new Promise((resolve) => setTimeout(resolve, 2500));
await capture("pt", "root-guard-superior-bpdu", "Switch1", "show spanning-tree inconsistentports");
await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "spanning-tree vlan 1 priority 32768" },
  { mode: "", line: "end" },
]);

await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/6" },
  { mode: "", line: "switchport mode access" },
  { mode: "", line: "switchport access vlan 10" },
  { mode: "", line: "spanning-tree portfast" },
  { mode: "", line: "spanning-tree bpduguard enable" },
  { mode: "", line: "no shutdown" },
  { mode: "", line: "end" },
]);
await configureDevice("Switch3", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/1" },
  { mode: "", line: "switchport mode access" },
  { mode: "", line: "switchport access vlan 10" },
  { mode: "", line: "no shutdown" },
  { mode: "global", line: "spanning-tree vlan 10 priority 0" },
  { mode: "", line: "end" },
]);
await new Promise((resolve) => setTimeout(resolve, 2500));
await capture("pt", "bpdu-guard-errdisable", "Switch2", "show spanning-tree inconsistentports");
await capture("pt", "bpdu-guard-errdisable", "Switch2", "show interfaces fastEthernet 0/6 status");
await capture("pt", "bpdu-guard-errdisable", "Switch2", "show errdisable recovery");
await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/6" },
  { mode: "", line: "shutdown" },
  { mode: "", line: "no spanning-tree bpduguard enable" },
  { mode: "", line: "no spanning-tree portfast" },
  { mode: "", line: "end" },
]);
await configureDevice("Switch3", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "no spanning-tree vlan 10 priority 0" },
  { mode: "", line: "end" },
]);
await configureDevice("Switch2", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/3" },
  { mode: "", line: "no spanning-tree portfast" },
  { mode: "", line: "no spanning-tree bpduguard enable" },
  { mode: "", line: "end" },
]);
await configureDevice("Switch1", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/2" },
  { mode: "", line: "no spanning-tree guard root" },
  { mode: "", line: "end" },
]);

await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/1" },
  { mode: "", line: "shutdown" },
  { mode: "", line: "end" },
]);
await new Promise((resolve) => setTimeout(resolve, 2500));
for (const device of switches) await capture("pt", "link-failure-reconvergence", device, "show spanning-tree");
await configureDevice("Switch0", [
  { mode: "enable", line: "configure terminal" },
  { mode: "global", line: "interface fastEthernet 0/1" },
  { mode: "", line: "no shutdown" },
  { mode: "", line: "end" },
]);

const artifact = {
  capturedAt: new Date().toISOString(),
  backend: "pt",
  topology: "live-rebuilt-2026-10-22",
  observations: raw,
  blockedExperiments: [],
};
await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/stp-research-pt.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ observations: raw.length, blocked: artifact.blockedExperiments.length, artifact: "harness/artifacts/stp-research-pt.json" }, null, 2));
