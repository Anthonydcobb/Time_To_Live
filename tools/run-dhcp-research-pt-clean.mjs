import { readFile, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const path = "harness/artifacts/dhcp-research-pt.json";
const artifact = JSON.parse(await readFile(path, "utf8"));
const observations = artifact.observations;
async function record(experiment, device, line, mode = device.startsWith("PC") ? "" : "enable") {
  const response = await executeDeviceCommand(device, line, mode);
  const rawOutput = String(response.result?.output ?? "");
  const entry = { backend: "pt", experiment, device, input: line, mode, status: response.result?.status ?? null, rawOutput };
  observations.push(entry);
  return entry;
}
async function configure(experiment, device, commands) {
  for (const command of await configureDevice(device, commands)) {
    observations.push({ backend: "pt", experiment, device, input: command.command, mode: command.mode, status: command.result.result?.status ?? null, rawOutput: String(command.result.result?.output ?? "") });
  }
}
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });
const extractPcState = (text) => text.split("\n").filter((line) => /IPv4 Address|Autoconfiguration IPv4|Subnet Mask|Default Gateway|DHCP Servers|DNS Servers/.test(line));

const baseline = await record("clean-baseline", "PC3", "ipconfig /all");
await record("clean-baseline", "PC3", "ipconfig /release");
await record("clean-baseline", "PC3", "ipconfig /dhcp");

await configure("clean-relay", "Router1", [
  { mode: "enable", line: "configure terminal" },
  g("interface gigabitEthernet 0/1"), i("ip address 10.99.0.1 255.255.255.0"), i("ip helper-address 192.168.10.1"), i("no shutdown"), i("end"),
]);
await configure("clean-relay", "Router0", [
  { mode: "enable", line: "configure terminal" },
  g("ip route 10.99.0.0 255.255.255.0 192.168.10.2"),
  g("ip dhcp excluded-address 10.99.0.1 10.99.0.10"),
  g("ip dhcp pool TTL_RELAY_CLEAN"), i("network 10.99.0.0 255.255.255.0"), i("default-router 10.99.0.1"), i("dns-server 10.99.0.53"), i("lease 0 1"), i("end"),
]);
await record("clean-relay", "Router1", "show ip interface brief");
await record("clean-relay", "Router1", "show running-config | section dhcp");
await record("clean-relay", "PC3", "ipconfig /renew");
const relayAll = await record("clean-relay", "PC3", "ipconfig /all");
await record("clean-relay", "Router0", "show ip dhcp binding");
await record("clean-relay", "Router0", "show ip dhcp pool TTL_RELAY_CLEAN");

await configure("clean-exhaustion", "Router1", [
  { mode: "enable", line: "configure terminal" },
  g("interface gigabitEthernet 0/1"), i("no ip helper-address 192.168.10.1"), i("ip address 10.99.1.1 255.255.255.0"), i("ip helper-address 192.168.10.1"), i("no shutdown"), i("end"),
]);
await configure("clean-exhaustion", "Router0", [
  { mode: "enable", line: "configure terminal" },
  g("no ip route 10.99.0.0 255.255.255.0 192.168.10.2"),
  g("ip route 10.99.1.0 255.255.255.0 192.168.10.2"),
  g("ip dhcp excluded-address 10.99.1.1 10.99.1.254"),
  g("ip dhcp pool TTL_EXHAUST_CLEAN"), i("network 10.99.1.0 255.255.255.0"), i("default-router 10.99.1.1"), i("end"),
]);
await record("clean-exhaustion", "PC3", "ipconfig /renew");
await record("clean-exhaustion", "PC3", "ipconfig /all");
await record("clean-exhaustion", "Router0", "show ip dhcp pool TTL_EXHAUST_CLEAN");
await record("clean-exhaustion", "Router0", "show ip dhcp binding");

await configure("clean-apipa", "Router1", [
  { mode: "enable", line: "configure terminal" },
  g("interface gigabitEthernet 0/1"), i("no ip helper-address 192.168.10.1"), i("ip address 10.99.2.1 255.255.255.0"), i("no shutdown"), i("end"),
]);
await configure("clean-apipa", "Router0", [
  { mode: "enable", line: "configure terminal" },
  g("no ip route 10.99.1.0 255.255.255.0 192.168.10.2"),
  g("no ip dhcp pool TTL_RELAY_CLEAN"), g("no ip dhcp pool TTL_EXHAUST_CLEAN"),
  g("no ip dhcp excluded-address 10.99.0.1 10.99.0.10"), g("no ip dhcp excluded-address 10.99.1.1 10.99.1.254"),
  i("end"),
]);
const apipaBefore = await record("clean-apipa", "PC3", "ipconfig /all");
const apipaRenew = await record("clean-apipa", "PC3", "ipconfig /renew");
const apipaAfter = await record("clean-apipa", "PC3", "ipconfig /all");
observations.push({ backend: "pt", experiment: "clean-apipa", device: "PC3", input: "derived-state-diff", mode: "", status: "STATUS_OK", rawOutput: JSON.stringify({ before: extractPcState(apipaBefore.rawOutput), renew: extractPcState(apipaRenew.rawOutput), after: extractPcState(apipaAfter.rawOutput), baseline: extractPcState(baseline.rawOutput) }) });

await configure("clean-restore", "Router1", [
  { mode: "enable", line: "configure terminal" },
  g("interface gigabitEthernet 0/1"), i("shutdown"), i("no ip address"), i("end"),
]);
await configure("clean-restore", "Router0", [
  { mode: "enable", line: "configure terminal" },
  g("no ip dhcp pool TTL_EXHAUST_CLEAN"), g("no ip dhcp excluded-address 10.99.1.1 10.99.1.254"),
  g("no ip route 10.99.2.0 255.255.255.0 192.168.10.2"), i("end"),
]);
await record("clean-restore", "PC3", "ipconfig 0.0.0.0 0.0.0.0 0.0.0.0");
for (const [device, line] of [["PC0", "ping 192.168.10.1"], ["PC0", "ping 192.168.20.10"], ["PC1", "ping 192.168.20.1"], ["PC2", "ping 192.168.10.1"]]) await record("clean-restore-verification", device, line);

artifact.capturedAt = new Date().toISOString();
await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ appended: observations.length, artifact: path, relayState: extractPcState(relayAll.rawOutput), apipaState: extractPcState(apipaAfter.rawOutput) }, null, 2));
