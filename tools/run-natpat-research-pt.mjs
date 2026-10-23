import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });

async function record(experiment, device, input, mode = device.startsWith("PC") ? "" : "enable", waitedMs = 0) {
  const response = await executeDeviceCommand(device, input, mode);
  observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", experiment, device, input, mode, status: response.result?.status ?? null, rawOutput: String(response.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs, capturedAt: stamp() });
  return response;
}

async function config(experiment, device, commands) {
  for (const entry of await configureDevice(device, commands)) {
    observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", experiment, device, input: entry.command, mode: entry.mode, status: entry.result.result?.status ?? null, rawOutput: String(entry.result.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs: 0, capturedAt: stamp() });
    await sleep(500);
  }
}

const captureRouter = async (experiment, waitedMs = 0) => {
  for (const command of ["show running-config", "show ip nat translations", "show ip nat statistics", "show ip interface gigabitEthernet 0/0.10", "show ip interface gigabitEthernet 0/0.20"]) {
    await record(experiment, "Router0", command, "enable", waitedMs);
  }
};

async function restore() {
  await config("restore", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("no ip nat inside source static 192.168.10.10 192.168.20.100"),
    g("no ip nat inside source list 1 pool TTL-POOL"),
    g("no ip nat inside source list 1 interface gigabitEthernet 0/0.20 overload"),
    g("no ip nat pool TTL-POOL"), g("no access-list 1"),
    g("interface gigabitEthernet 0/0.10"), i("no ip nat inside"),
    g("interface gigabitEthernet 0/0.20"), i("no ip nat outside"), i("end"),
  ]);
  await record("restore", "Router0", "clear ip nat translation *", "enable");
  await sleep(2000);
  await captureRouter("restore-verification", 2000);
  for (const [pc, target] of [["PC0", "192.168.20.1"], ["PC2", "192.168.20.1"], ["PC1", "192.168.10.1"]]) {
    await record("restore-verification", pc, `ping ${target}`, "", 2000);
  }
}

await captureRouter("baseline");
for (const pc of ["PC0", "PC2", "PC1"]) await record("baseline", pc, "ipconfig /all", "");
await sleep(5000);
for (const pc of ["PC0", "PC2"]) await record("baseline-connectivity", pc, "ping 192.168.20.10", "", 5000);

try {
  await config("nat-roles", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("interface gigabitEthernet 0/0.10"), i("ip nat inside"),
    g("interface gigabitEthernet 0/0.20"), i("ip nat outside"), i("end"),
  ]);

  await config("static-nat", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("ip nat inside source static 192.168.10.10 192.168.20.100"), i("end"),
  ]);
  await sleep(2000);
  await record("static-nat", "PC1", "ping 192.168.20.100", "", 2000);
  await captureRouter("static-nat", 2000);
  await record("clear-dynamic-with-static-present", "Router0", "clear ip nat translation *", "enable");
  await record("static-after-clear", "Router0", "show ip nat translations", "enable");
  await record("static-after-clear", "Router0", "show ip nat statistics", "enable");

  await config("dynamic-pool", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("access-list 1 permit 192.168.10.0 0.0.0.255"),
    g("ip nat pool TTL-POOL 192.168.20.101 192.168.20.102 netmask 255.255.255.0"),
    g("ip nat inside source list 1 pool TTL-POOL"), i("end"),
  ]);
  await sleep(1000);
  await record("dynamic-pool", "PC0", "ping 192.168.20.10", "", 1000);
  await record("dynamic-pool", "PC2", "ping 192.168.20.10", "", 1000);
  await sleep(1000);
  await captureRouter("dynamic-pool", 2000);

  await config("pat-overload", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("no ip nat inside source list 1 pool TTL-POOL"),
    g("no ip nat pool TTL-POOL"),
    g("no ip nat inside source static 192.168.10.10 192.168.20.100"), i("end"),
  ]);
  await record("pat-preclear", "Router0", "clear ip nat translation *", "enable");
  await sleep(1000);
  await config("pat-overload", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("ip nat inside source list 1 interface gigabitEthernet 0/0.20 overload"), i("end"),
  ]);
  await record("pat-overload", "PC0", "ping 192.168.20.10", "", 1000);
  await record("pat-overload", "PC2", "ping 192.168.20.10", "", 1000);
  await sleep(1000);
  await captureRouter("pat-overload", 2000);
  await record("clear-dynamic-translations", "Router0", "clear ip nat translation *", "enable");
  await captureRouter("after-clear", 1000);
} finally {
  await restore();
}

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/natpat-research-pt.json", `${JSON.stringify({ capturedAt: stamp(), backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", observations, topology: ["Existing PC0 192.168.10.10 and PC2 192.168.10.11 share the existing VLAN 10 inside network through Router0 Gi0/0.10", "Existing PC1 192.168.20.10 is on VLAN 20 and Router0 Gi0/0.20 is the outside network", "No device, cable, or endpoint configuration was added"], cmlAvailability: "vmrun was not available in PATH, so a CML VM could not be checked or used.", blockedExperiments: ["Static NAT inbound ping from PC1 to 192.168.20.100 was not captured: the PT bridge returned a truncated command echo (C:\\>ing 192.168.20.100) and Invalid Command; translation-table evidence is retained."], restoration: "Temporary NAT roles, static mapping, ACL, pool, overload mapping, and dynamic translations removed; Router0 NAT state and existing-host connectivity recaptured." }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/natpat-research-pt.json" }));
