import fs from "node:fs";
import { executeDeviceCommand, configureDevice } from "./pt-adapter.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const observations = [];
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });

async function record(experiment, device, input, mode = device.startsWith("PC") ? "" : "enable") {
  const response = await executeDeviceCommand(device, input, mode);
  const rawOutput = String(response.result?.output ?? "");
  observations.push({ backend: "pt", experiment, device, input, mode, status: response.result?.status ?? null, rawOutput });
  console.log(`CAP ${experiment} ${device} ${input} ${response.result?.status ?? ""}`);
  return rawOutput;
}

async function configure(experiment, device, commands) {
  for (const command of await configureDevice(device, commands)) {
    observations.push({ backend: "pt", experiment, device, input: command.command, mode: command.mode, status: command.result.result?.status ?? null, rawOutput: String(command.result.result?.output ?? "") });
    await sleep(350);
  }
}

await configure("final-relay", "Router1", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"), i("ip address 10.99.0.1 255.255.255.0"), i("ip helper-address 192.168.10.1"), i("no shutdown"), i("end"),
]);
await configure("final-relay", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("ip route 10.99.0.0 255.255.255.0 192.168.10.2"), g("ip dhcp excluded-address 10.99.0.1 10.99.0.10"), g("ip dhcp pool TTL_RELAY_FINAL2"), i("network 10.99.0.0 255.255.255.0"), i("default-router 10.99.0.1"), i("dns-server 10.99.0.53"), i("end"),
]);
await sleep(1000);
await record("final-relay", "PC3", "ipconfig /release");
await record("final-relay", "PC3", "ipconfig /renew");
await sleep(1200);
await record("final-relay", "PC3", "ipconfig /all");
await record("final-relay", "Router0", "show ip dhcp binding");
await record("final-relay", "Router0", "show ip dhcp pool TTL_RELAY_FINAL2");

await configure("final-exhaustion", "Router1", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"), i("ip address 10.99.1.1 255.255.255.0"), i("ip helper-address 192.168.10.1"), i("no shutdown"), i("end"),
]);
await configure("final-exhaustion", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("no ip route 10.99.0.0 255.255.255.0 192.168.10.2"), g("ip route 10.99.1.0 255.255.255.0 192.168.10.2"), g("ip dhcp excluded-address 10.99.1.1 10.99.1.254"), g("ip dhcp pool TTL_EXHAUST_FINAL"), i("network 10.99.1.0 255.255.255.0"), i("default-router 10.99.1.1"), i("end"),
]);
await sleep(1000);
await record("final-exhaustion", "PC3", "ipconfig /release");
await record("final-exhaustion", "PC3", "ipconfig /renew");
await sleep(1000);
await record("final-exhaustion", "PC3", "ipconfig /all");
await record("final-exhaustion", "Router0", "show ip dhcp pool TTL_EXHAUST_FINAL");
await record("final-exhaustion", "Router0", "show ip dhcp binding");

await configure("final-apipa", "Router1", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"), i("no ip helper-address 192.168.10.1"), i("ip address 10.99.2.1 255.255.255.0"), i("no shutdown"), i("end"),
]);
await configure("final-apipa", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("no ip route 10.99.1.0 255.255.255.0 192.168.10.2"), g("no ip dhcp pool TTL_RELAY_FINAL2"), g("no ip dhcp pool TTL_EXHAUST_FINAL"), g("no ip dhcp excluded-address 10.99.0.1 10.99.0.10"), g("no ip dhcp excluded-address 10.99.1.1 10.99.1.254"), i("end"),
]);
await sleep(800);
await record("final-apipa", "PC3", "ipconfig /release");
await record("final-apipa", "PC3", "ipconfig /renew");
await sleep(1000);
await record("final-apipa", "PC3", "ipconfig /all");

await configure("final-restore", "Router1", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"), i("shutdown"), i("no ip address"), i("end"),
]);
await configure("final-restore", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("no ip dhcp pool TTL_RELAY_FINAL"), g("no ip route 10.99.2.0 255.255.255.0 192.168.10.2"), g("no ip dhcp pool TTL_RELAY_FINAL2"), g("no ip dhcp pool TTL_EXHAUST_FINAL"), i("end"),
]);
await record("final-restore", "Router0", "show running-config | section dhcp");
await record("final-restore", "Router1", "show ip interface brief");
await record("final-restore", "PC3", "ipconfig 0.0.0.0 0.0.0.0 0.0.0.0");
for (const [device, input] of [["PC0", "ping 192.168.10.1"], ["PC0", "ping 192.168.20.10"], ["PC1", "ping 192.168.20.1"], ["PC2", "ping 192.168.10.1"]]) await record("final-restore-verification", device, input);

const artifactPath = "harness/artifacts/dhcp-research-pt.json";
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
artifact.observations.push(...observations);
artifact.capturedAt = new Date().toISOString();
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ appended: observations.length, total: artifact.observations.length }, null, 2));
