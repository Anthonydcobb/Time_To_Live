import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });
const stamp = () => new Date().toISOString();
async function record(experiment, device, input, mode = "enable", waitedMs = 0) {
  const response = await executeDeviceCommand(device, input, mode);
  observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.0(2)SE4 / 15.1", experiment, device, input, mode, status: response.result?.status ?? null, rawOutput: String(response.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs, capturedAt: stamp() });
  return response;
}
async function config(experiment, device, lines) {
  for (const command of await configureDevice(device, lines)) {
    observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.0(2)SE4 / 15.1", experiment, device, input: command.command, mode: command.mode, status: command.result.result?.status ?? null, rawOutput: String(command.result.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs: 0, capturedAt: stamp() });
    await sleep(250);
  }
}
async function pair(name, left, right, waitedMs = 5000) {
  await config(name, "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no channel-group"), i(`channel-group 1 mode ${left}`), g("interface fastEthernet 0/5"), i("no channel-group"), i(`channel-group 1 mode ${left}`), i("end")]);
  await config(name, "Switch1", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no channel-group"), i(`channel-group 1 mode ${right}`), g("interface fastEthernet 0/3"), i("no channel-group"), i(`channel-group 1 mode ${right}`), i("end")]);
  await sleep(waitedMs);
  await record(name, "Switch0", "show etherchannel summary", "enable", waitedMs);
  await record(name, "Switch1", "show etherchannel summary", "enable", waitedMs);
}

await record("baseline", "Switch0", "show interfaces status");
await record("baseline", "Switch1", "show interfaces status");
await record("baseline", "Switch0", "show cdp neighbors detail", "enable", 65000);

await pair("active-active", "active", "active", 35000);
for (const command of ["show etherchannel summary", "show etherchannel port-channel 1", "show interfaces port-channel 1", "show lacp neighbor", "show pagp neighbor", "show etherchannel load-balance", "show spanning-tree"]) await record("active-active", "Switch0", command, "enable", 35000);

for (const [name, left, right] of [["active-passive", "active", "passive"], ["passive-passive", "passive", "passive"], ["desirable-auto", "desirable", "auto"], ["auto-auto", "auto", "auto"], ["desirable-desirable", "desirable", "desirable"], ["on-on", "on", "on"], ["on-active", "on", "active"]]) await pair(name, left, right);

await config("mismatch-member-settings", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no channel-group"), i("switchport mode trunk"), i("channel-group 20 mode active"), g("interface fastEthernet 0/5"), i("no channel-group"), i("switchport mode access"), i("speed 10"), i("duplex half"), i("channel-group 20 mode active"), i("end")]);
await config("mismatch-member-settings", "Switch1", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no channel-group"), i("switchport mode trunk"), i("channel-group 20 mode active"), g("interface fastEthernet 0/3"), i("no channel-group"), i("switchport mode trunk"), i("channel-group 20 mode active"), i("end")]);
await sleep(5000);
for (const command of ["show etherchannel summary", "show interfaces status", "show logging"]) await record("mismatch-member-settings", "Switch0", command, "enable", 5000);
await config("member-failure", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/5"), i("shutdown"), i("end")]);
await sleep(5000);
await record("member-failure", "Switch0", "show etherchannel summary", "enable", 5000);
await config("member-recovery", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/5"), i("no shutdown"), i("end")]);
await sleep(35000);
await record("member-recovery", "Switch0", "show etherchannel summary", "enable", 35000);

await config("l3-switch-off", "Switch2", [{ mode: "enable", line: "configure terminal" }, i("no ip routing"), g("interface fastEthernet 0/7"), i("no switchport"), i("ip address 10.0.0.1 255.255.255.0"), i("no shutdown"), i("end")]);
await record("l3-switch-off", "Switch2", "show ip interface brief");
await config("l3-switch-on", "Switch2", [{ mode: "enable", line: "configure terminal" }, i("ip routing"), i("end")]);
await record("l3-switch-on", "Switch2", "show ip route");

await config("svi-routing", "Switch2", [{ mode: "enable", line: "configure terminal" }, g("vlan 30"), g("interface vlan 30"), i("ip address 192.168.30.1 255.255.255.0"), i("no shutdown"), i("end")]);
await sleep(35000);
await record("svi-routing", "Switch2", "show ip interface brief", "enable", 35000);
await record("svi-routing", "Switch2", "show ip route", "enable", 35000);
await config("default-route", "Switch2", [{ mode: "enable", line: "configure terminal" }, i("ip route 0.0.0.0 0.0.0.0 192.168.30.254"), i("end")]);
await record("default-route", "Switch2", "show ip route");
await config("routed-etherchannel", "Switch2", [{ mode: "enable", line: "configure terminal" }, g("interface port-channel 30"), i("no switchport"), i("ip address 172.31.0.2 255.255.255.252"), i("no shutdown"), i("end")]);
await record("routed-etherchannel", "Switch2", "show running-config");

// Restore the baseline: the two existing parallel links remain trunks and no temporary L3/SVI config remains.
await config("restore", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("no interface port-channel 1"), g("interface fastEthernet 0/1"), i("no channel-group"), i("switchport mode trunk"), i("no shutdown"), g("interface fastEthernet 0/5"), i("no channel-group"), i("switchport mode access"), i("speed auto"), i("duplex auto"), i("shutdown"), i("no shutdown"), i("end")]);
await config("restore", "Switch1", [{ mode: "enable", line: "configure terminal" }, g("no interface port-channel 1"), g("interface fastEthernet 0/1"), i("no channel-group"), i("switchport mode trunk"), i("no shutdown"), g("interface fastEthernet 0/3"), i("no channel-group"), i("switchport mode access"), i("speed auto"), i("duplex auto"), i("shutdown"), i("no shutdown"), i("end")]);
await config("restore", "Switch2", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/7"), i("shutdown"), i("no switchport"), i("no ip address"), g("no interface vlan 30"), i("no ip route 0.0.0.0 0.0.0.0 192.168.30.254"), i("end")]);
await sleep(35000);
for (const [device, command] of [["Switch0", "show interfaces status"], ["Switch1", "show interfaces status"], ["Switch2", "show vlan brief"], ["PC0", "ping 192.168.10.1"], ["PC1", "ping 192.168.20.1"]]) await record("restore-verification", device, command, device.startsWith("PC") ? "" : "enable", 35000);

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/l3-etherchannel-research-pt.json", `${JSON.stringify({ capturedAt: stamp(), backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.0(2)SE4 / 15.1", observations, blockedExperiments: ["routed-etherchannel on a 2960; a 3560 multilayer switch was not added without owner approval"] }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/l3-etherchannel-research-pt.json" }));
