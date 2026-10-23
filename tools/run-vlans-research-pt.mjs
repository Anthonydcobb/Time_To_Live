import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });

async function record(experiment, device, input, mode = device.startsWith("PC") ? "" : "enable") {
  const response = await executeDeviceCommand(device, input, mode);
  observations.push({
    backend: "pt", experiment, device, input, mode,
    status: response.result?.status ?? null,
    rawOutput: String(response.result?.output ?? ""),
    prompt: null,
    promptStatus: "bridge does not expose console prompts or interactive settlement",
    settlements: [],
    capturedAt: new Date().toISOString(),
  });
  return response;
}

async function config(experiment, device, lines) {
  for (const command of await configureDevice(device, lines)) {
    observations.push({
      backend: "pt", experiment, device, input: command.command, mode: command.mode,
      status: command.result.result?.status ?? null,
      rawOutput: String(command.result.result?.output ?? ""),
      prompt: null,
      promptStatus: "bridge does not expose console prompts or interactive settlement",
      settlements: [],
      capturedAt: new Date().toISOString(),
    });
    await sleep(250);
  }
}

// Baseline captures and the dentist job's VLAN/trunk commands.
for (const [device, command] of [
  ["Switch0", "show running-config"], ["Switch1", "show running-config"],
  ["Router0", "show running-config"], ["Switch0", "show cdp neighbors detail"],
]) await record("baseline", device, command);

await config("dentist-vlans", "Switch0", [
  { mode: "enable", line: "configure terminal" }, g("vlan 10"), i("name STAFF"), g("vlan 20"), i("name XRAY"),
  g("interface fastEthernet 0/2"), i("switchport mode access"), i("switchport access vlan 10"),
  g("interface fastEthernet 0/5"), i("switchport mode access"), i("switchport access vlan 20"),
  i("end"),
]);
for (const command of ["show vlan brief", "show vlan id 10", "show interfaces fastEthernet 0/2 switchport", "show interfaces status"]) await record("dentist-show", "Switch0", command);

const dtpCases = [
  ["auto-auto", "dynamic auto", "dynamic auto"],
  ["auto-desirable", "dynamic auto", "dynamic desirable"],
  ["desirable-desirable", "dynamic desirable", "dynamic desirable"],
  ["trunk-auto", "trunk", "dynamic auto"],
  ["access-desirable", "access", "dynamic desirable"],
];
for (const [name, left, right] of dtpCases) {
  await config("dtp-" + name, "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no switchport nonegotiate"), i("switchport mode " + left), i("end")]);
  await config("dtp-" + name, "Switch1", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("no switchport nonegotiate"), i("switchport mode " + right), i("end")]);
  await sleep(1200);
  await record("dtp-" + name, "Switch0", "show interfaces fastEthernet 0/1 switchport");
  await record("dtp-" + name, "Switch1", "show interfaces fastEthernet 0/1 switchport");
}
await config("dtp-nonegotiate", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport nonegotiate"), i("end")]);
await config("dtp-nonegotiate", "Switch1", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode dynamic desirable"), i("end")]);
await sleep(1200);
await record("dtp-nonegotiate", "Switch0", "show interfaces fastEthernet 0/1 switchport");
await record("dtp-nonegotiate", "Switch1", "show interfaces fastEthernet 0/1 switchport");
await config("dtp-nonegotiate-rejection", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode dynamic auto"), i("end")]);

await config("trunk-allowed", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport trunk allowed vlan 10,20"), i("switchport trunk allowed vlan add 30"), i("switchport trunk allowed vlan remove 20"), i("switchport trunk allowed vlan except 30"), i("switchport trunk allowed vlan none"), i("end")]);
for (const command of ["show interfaces trunk", "show interfaces fastEthernet 0/1 switchport"]) await record("trunk-allowed", "Switch0", command);

await config("native-mismatch", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("vlan 99"), g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport trunk native vlan 99"), i("end")]);
await config("native-mismatch", "Switch1", [{ mode: "enable", line: "configure terminal" }, g("vlan 99"), g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport trunk native vlan 1"), i("end")]);
await sleep(1500);
await record("native-mismatch", "Switch0", "show logging");
await record("native-mismatch", "Switch1", "show logging");

await config("router-on-a-stick", "Router0", [
  { mode: "enable", line: "configure terminal" }, g("interface gigabitEthernet 0/0"), i("no shutdown"),
  g("interface gigabitEthernet 0/0.99"), i("encapsulation dot1Q 99 native"), i("ip address 192.168.99.1 255.255.255.0"), i("end"),
]);
for (const command of ["show ip interface brief", "show interfaces gigabitEthernet 0/0.99"]) await record("router-on-a-stick", "Router0", command);
for (const [device, command] of [["PC0", "ipconfig /all"], ["PC1", "ipconfig /all"], ["PC0", "ping 192.168.20.1"], ["PC1", "ping 192.168.10.1"]]) await record("inter-vlan-ping", device, command, "");

await config("svi-autostate", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("vlan 30"), g("interface vlan 30"), i("ip address 192.168.30.1 255.255.255.0"), i("no shutdown"), i("end")]);
await record("svi-autostate", "Switch0", "show ip interface brief");
await config("svi-autostate-active", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/2"), i("switchport access vlan 30"), i("end")]);
await sleep(1000);
await record("svi-autostate-active", "Switch0", "show ip interface brief");

await config("voice-vlan", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/5"), i("switchport mode access"), i("switchport voice vlan 150"), i("end")]);
await record("voice-vlan", "Switch0", "show interfaces fastEthernet 0/5 switchport");
await config("deleted-vlan", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("vlan 77"), g("interface fastEthernet 0/5"), i("switchport access vlan 77"), i("end")]);
await record("deleted-vlan", "Switch0", "show interfaces fastEthernet 0/5 switchport");
await config("deleted-vlan", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("no vlan 77"), i("end")]);
await record("deleted-vlan", "Switch0", "show interfaces fastEthernet 0/5 switchport");

// Restore the live lab to the captured baseline before health verification.
await config("restore", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport trunk native vlan 1"), i("switchport trunk allowed vlan 10,20"), i("no switchport nonegotiate"), g("interface fastEthernet 0/2"), i("switchport mode access"), i("switchport access vlan 10"), g("interface fastEthernet 0/5"), i("no switchport voice vlan"), i("switchport access vlan 1"), g("interface vlan 30"), i("shutdown"), i("no ip address"), g("no vlan 30"), g("no vlan 99"), g("no vlan 150"), i("end")]);
await config("restore", "Switch1", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/1"), i("switchport mode trunk"), i("switchport trunk native vlan 1"), i("switchport trunk allowed vlan 10,20"), i("no switchport nonegotiate"), i("end")]);
await config("restore", "Router0", [{ mode: "enable", line: "configure terminal" }, g("no interface gigabitEthernet 0/0.99"), i("end")]);
await sleep(1500);
for (const [device, command] of [["Switch0", "show vlan brief"], ["Switch0", "show interfaces trunk"], ["Router0", "show ip interface brief"], ["PC0", "ping 192.168.10.1"], ["PC1", "ping 192.168.20.1"]]) await record("restore-verification", device, command, device.startsWith("PC") ? "" : "enable");

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/vlans-research-pt.json", `${JSON.stringify({ capturedAt: new Date().toISOString(), backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.0(2)SE4 / 15.1", observations, blockedExperiments: [] }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/vlans-research-pt.json" }));
