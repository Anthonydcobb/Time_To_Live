import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });
async function record(experiment, device, input, mode = "enable", waitedMs = 0) {
  const response = await executeDeviceCommand(device, input, mode);
  observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", experiment, device, input, mode, status: response.result?.status ?? null, rawOutput: String(response.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs, capturedAt: stamp() });
  return response;
}
async function config(experiment, device, lines) {
  for (const entry of await configureDevice(device, lines)) {
    observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", experiment, device, input: entry.command, mode: entry.mode, status: entry.result.result?.status ?? null, rawOutput: String(entry.result.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs: 0, capturedAt: stamp() });
    await sleep(750);
  }
}
const capture = async (experiment, device, commands, waitedMs = 0) => {
  for (const command of commands) await record(experiment, device, command, "enable", waitedMs);
};
const restore = async () => {
  for (const device of ["Router0", "Router1"]) {
    await config("restore", device, [
      { mode: "enable", line: "configure terminal" },
      g("no router ospf 1"),
      g("no ip route 0.0.0.0 0.0.0.0 192.168.20.254"),
      g("interface gigabitEthernet 0/0.20"), i("no ip ospf cost"), i("no ip ospf priority"),
      ...(device === "Router1" ? [g("interface gigabitEthernet 0/1"), i("shutdown"), i("no ip address")] : []),
      i("end"),
    ]);
  }
  await sleep(5000);
  await capture("restore-verification", "Router0", ["show running-config", "show ip interface brief", "show ip route", "show ip ospf neighbor"], 5000);
  await capture("restore-verification", "Router1", ["show running-config", "show ip interface brief", "show ip route", "show ip ospf neighbor"], 5000);
};

await capture("baseline", "Router0", ["show running-config", "show ip route", "show ip ospf neighbor"]);
await capture("baseline", "Router1", ["show running-config", "show ip route", "show ip ospf neighbor"]);

try {
  await config("ospfv2-baseline", "Router0", [
    { mode: "enable", line: "configure terminal" }, g("router ospf 1"), i("router-id 1.1.1.1"),
    i("network 192.168.20.0 0.0.0.255 area 0"), i("end"),
  ]);
  await config("ospfv2-baseline", "Router1", [
    { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"),
    i("ip address 10.30.0.1 255.255.255.0"), i("no shutdown"), i("ip ospf priority 1"),
    g("interface gigabitEthernet 0/0.20"), i("ip ospf priority 1"),
    g("router ospf 1"), i("router-id 2.2.2.2"),
    i("network 192.168.20.0 0.0.0.255 area 0"), i("network 10.30.0.0 0.0.0.255 area 0"), i("end"),
  ]);
  await capture("configuration-verification", "Router0", ["show running-config | section router ospf"]);
  await capture("configuration-verification", "Router1", ["show running-config | section interface", "show running-config | section router ospf"]);
  await sleep(45000);
  for (const device of ["Router0", "Router1"]) await capture("ospfv2-baseline", device, [
    "show ip ospf neighbor", "show ip ospf neighbor detail", "show ip ospf interface",
    "show ip ospf database", "show ip route", "show ip protocols",
  ], 45000);

  await config("passive-interface", "Router1", [
    { mode: "enable", line: "configure terminal" }, g("router ospf 1"), i("passive-interface gigabitEthernet 0/1"), i("end"),
  ]);
  await sleep(5000);
  await capture("passive-interface", "Router1", ["show ip ospf neighbor", "show ip ospf interface gigabitEthernet 0/1", "show ip route", "show running-config"], 5000);

  await config("cost", "Router1", [
    { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/1"), i("ip ospf cost 25"), i("end"),
  ]);
  await sleep(5000);
  await capture("cost", "Router0", ["show ip route", "show ip ospf database router"], 5000);
  await capture("cost", "Router1", ["show ip ospf interface gigabitEthernet 0/1", "show ip route"], 5000);

  await config("default-information-originate", "Router0", [
    { mode: "enable", line: "configure terminal" }, g("ip route 0.0.0.0 0.0.0.0 192.168.20.254"),
    g("router ospf 1"), i("default-information originate"), i("end"),
  ]);
  await sleep(5000);
  await capture("default-information-originate", "Router1", ["show ip route", "show ip ospf database external", "show ip protocols"], 5000);
} finally {
  await restore();
}

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/ospfv2-research-pt.json", `${JSON.stringify({ capturedAt: stamp(), backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", observations, topology: ["Router0 and Router1 share the existing VLAN 20 broadcast segment over the existing switch trunks", "Router1 GigabitEthernet0/1 was already cabled to the existing Switch4/PC3 segment and was shut down at baseline"], restoration: "Temporary OSPF, route, cost, priority, passive-interface, and Router1 Gi0/1 address/up state removed; baseline configs and interfaces recaptured." }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/ospfv2-research-pt.json" }));
