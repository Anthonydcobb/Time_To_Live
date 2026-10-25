import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
async function record(experiment, device, line, mode = device.startsWith("PC") ? "" : "enable") {
  const response = await executeDeviceCommand(device, line, mode);
  observations.push({ backend: "pt", experiment, device, input: line, mode, status: response.result?.status ?? null, rawOutput: String(response.result?.output ?? "") });
  return response;
}
async function configure(experiment, device, lines) {
  const results = await configureDevice(device, lines);
  for (const entry of results) observations.push({ backend: "pt", experiment, device, input: entry.command, mode: entry.mode, status: entry.result.result?.status ?? null, rawOutput: String(entry.result.result?.output ?? "") });
}
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });

const pool = [
  { mode: "enable", line: "configure terminal" },
  g("ip dhcp excluded-address 192.168.10.1 192.168.10.10"),
  g("ip dhcp pool TTL_RESEARCH"), i("network 192.168.10.0 255.255.255.0"), i("default-router 192.168.10.1"), i("dns-server 192.168.10.53"), i("lease 0 1"), i("end"),
];

await record("baseline", "Router0", "show ip interface brief");
await record("baseline", "PC0", "ipconfig /all");
await configure("basic-pool", "Router0", pool);
await record("basic-pool", "PC0", "ipconfig /dhcp");
await record("basic-pool", "PC0", "ipconfig /renew");
await record("basic-pool", "PC0", "ipconfig /release");
await record("basic-pool", "PC0", "ipconfig /all");
for (const line of ["show ip dhcp binding", "show ip dhcp pool", "show ip dhcp conflict", "show ip dhcp server statistics", "show running-config | section dhcp"]) await record("basic-pool", "Router0", line);
await record("basic-pool", "Router0", "clear ip dhcp binding *");
await record("basic-pool", "Router0", "clear ip dhcp binding 192.168.10.11");
await record("basic-pool", "Router0", "ip dhcp ?", "global");
await record("basic-pool", "Router0", "ip dhcp", "global");

await configure("relay", "Router1", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/0.20"), i("ip helper-address 192.168.20.1"), i("end"),
]);
await configure("relay", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("ip dhcp pool TTL_RELAY"), i("network 192.168.20.0 255.255.255.0"), i("default-router 192.168.20.2"), i("dns-server 192.168.20.53"), i("end"),
]);
await record("relay", "PC1", "ipconfig /dhcp");
await record("relay", "PC1", "ipconfig /renew");
await record("relay", "PC1", "ipconfig /all");
await record("relay", "Router1", "show running-config | section dhcp");

await configure("exhaustion-and-exclusion", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("ip dhcp excluded-address 192.168.10.1 192.168.10.253"), i("end"),
]);
await record("exhaustion-and-exclusion", "PC0", "ipconfig /dhcp");
await record("exhaustion-and-exclusion", "PC2", "ipconfig /dhcp");
await record("exhaustion-and-exclusion", "PC0", "ipconfig /all");
await record("exhaustion-and-exclusion", "PC2", "ipconfig /all");
await record("exhaustion-and-exclusion", "Router0", "show ip dhcp binding");

await configure("wrong-default-router", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("ip dhcp pool TTL_RESEARCH"), i("default-router 192.168.10.254"), i("end"),
]);
await record("wrong-default-router", "PC0", "ipconfig /release");
await record("wrong-default-router", "PC0", "ipconfig /renew");
await record("wrong-default-router", "PC0", "ipconfig /all");

await configure("snooping", "Switch0", [
  { mode: "enable", line: "configure terminal" }, g("ip dhcp snooping"), g("ip dhcp snooping vlan 10"), g("interface fastEthernet 0/1"), i("ip dhcp snooping trust"), i("end"),
]);
await record("snooping", "PC0", "ipconfig /dhcp");
await record("snooping", "PC0", "ipconfig /renew");
for (const line of ["show ip dhcp snooping", "show ip dhcp snooping binding", "show ip dhcp snooping statistics"]) await record("snooping", "Switch0", line);

await configure("restore", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("no ip dhcp pool TTL_RESEARCH"), g("no ip dhcp pool TTL_RELAY"), g("no ip dhcp excluded-address 192.168.10.1 192.168.10.10"), g("no ip dhcp excluded-address 192.168.10.1 192.168.10.253"), i("end"),
]);
await configure("restore", "Router1", [{ mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/0.20"), i("no ip helper-address 192.168.20.1"), i("end")]);
await configure("restore", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("no ip dhcp snooping"), i("end")]);
for (const [device, line] of [["PC0", "ipconfig 192.168.10.10 255.255.255.0 192.168.10.1"], ["PC1", "ipconfig 192.168.20.10 255.255.255.0 192.168.20.1"], ["PC2", "ipconfig 192.168.10.11 255.255.255.0 192.168.10.1"]]) await record("restore", device, line);
for (const [device, line] of [["PC0", "ping 192.168.10.1"], ["PC0", "ping 192.168.20.10"], ["PC1", "ping 192.168.20.1"], ["PC2", "ping 192.168.10.1"]]) await record("restore-verification", device, line);

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/dhcp-research-pt.json", `${JSON.stringify({ capturedAt: new Date().toISOString(), backend: "pt", version: "Packet Tracer live bridge", image: "live rebuilt lab", observations, blockedExperiments: [] }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/dhcp-research-pt.json" }, null, 2));
