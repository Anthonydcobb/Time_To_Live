import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
const g = (line) => ({ mode: "global", line });
const i = (line) => ({ mode: "", line });
async function record(experiment, device, input, mode = device.startsWith("PC") ? "" : "enable", waitedMs = 0) {
  const response = await executeDeviceCommand(device, input, mode);
  observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Catalyst 2960-24TT / IOS 15.0(2)SE4", experiment, device, input, mode, status: response.result?.status ?? null, rawOutput: String(response.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs, capturedAt: stamp() });
  return response;
}
async function config(experiment, device, lines) {
  for (const entry of await configureDevice(device, lines)) {
    observations.push({ backend: "pt", version: "Packet Tracer live bridge", image: "Catalyst 2960-24TT / IOS 15.0(2)SE4", experiment, device, input: entry.command, mode: entry.mode, status: entry.result.result?.status ?? null, rawOutput: String(entry.result.result?.output ?? ""), prompt: null, promptStatus: "bridge does not expose console prompts or interactive settlement", settlements: [], waitedMs: 0, capturedAt: stamp() });
    await sleep(500);
  }
}
async function switchState(experiment, waitedMs = 0) {
  for (const command of ["show port-security interface fastEthernet 0/2", "show port-security address", "show running-config", "show interfaces status", "show interfaces fastEthernet 0/2", "show mac address-table"]) await record(experiment, "Switch0", command, "enable", waitedMs);
  await record(experiment, "Switch0", "show logging", "enable", waitedMs);
}

await record("baseline", "Switch0", "show running-config");
await record("baseline", "Switch0", "show port-security interface fastEthernet 0/2");
await record("baseline", "Switch0", "show errdisable recovery");
await record("baseline", "Switch0", "show mac address-table");
await sleep(5000);
await record("baseline-connectivity", "PC0", "ping 192.168.10.1", "", 5000);

try {
  await config("sticky-and-maximum", "Switch0", [
    { mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/2"),
    i("switchport mode access"), i("switchport access vlan 10"), i("switchport port-security"), i("switchport port-security maximum 2"),
    i("switchport port-security mac-address sticky"), i("end"),
  ]);
  await record("sticky-and-maximum", "PC0", "ping 192.168.10.1", "", 1000);
  await switchState("sticky-and-maximum", 1000);

  await config("enable-auto-recovery", "Switch0", [
    { mode: "enable", line: "configure terminal" }, g("errdisable recovery cause psecure-violation"),
    g("errdisable recovery interval 30"), i("end"),
  ]);
  for (const violation of ["protect", "restrict", "shutdown"]) {
    const unauthorizedMac = { protect: "0011.2233.4455", restrict: "0011.2233.4456", shutdown: "0011.2233.4457" }[violation];
    await config(`violation-${violation}`, "Switch0", [
      { mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/2"),
      i("no switchport port-security mac-address sticky"), i("no switchport port-security"), i("switchport mode access"), i("switchport access vlan 10"), i("shutdown"), i("no shutdown"), i("clear mac address-table dynamic interface fastEthernet 0/2"), i("switchport port-security"),
      i("switchport port-security maximum 1"), i(`switchport port-security violation ${violation}`),
      i(`switchport port-security mac-address ${unauthorizedMac}`), i("end"),
    ]);
    await record(`violation-${violation}-trigger`, "PC0", "ping 192.168.10.1", "", 1000);
    await switchState(`violation-${violation}`, 1000);
    if (violation === "shutdown") {
      await sleep(35000);
      await switchState("errdisable-recovery-wait", 35000);
      await record("errdisable-recovery-wait", "Switch0", "show interfaces status", "enable", 35000);
      await record("errdisable-recovery-wait", "Switch0", "show port-security interface fastEthernet 0/2", "enable", 35000);
      await config("manual-recovery", "Switch0", [{ mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/2"), i(`no switchport port-security mac-address ${unauthorizedMac}`), i("switchport port-security mac-address 00e0.a379.2d27"), i("shutdown"), i("no shutdown"), i("end")]);
      await record("manual-recovery", "PC0", "ping 192.168.10.1", "", 1000);
      await record("manual-recovery", "Switch0", "show interfaces status", "enable", 1000);
      await record("manual-recovery", "Switch0", "show port-security interface fastEthernet 0/2", "enable", 1000);
    }
  }
} finally {
  await config("restore", "Switch0", [
    { mode: "enable", line: "configure terminal" }, g("interface fastEthernet 0/2"),
    i("no switchport port-security mac-address sticky"),
    i("no switchport port-security mac-address 0011.2233.4455"), i("no switchport port-security mac-address 0011.2233.4456"), i("no switchport port-security mac-address 0011.2233.4457"),
    i("no switchport port-security"), i("switchport mode access"), i("switchport access vlan 10"), i("shutdown"), i("no shutdown"),
    g("no errdisable recovery cause psecure-violation"), g("no errdisable recovery interval"), i("end"),
  ]);
  await sleep(35000);
  await record("restore-verification", "Switch0", "show running-config", "enable", 35000);
  await record("restore-verification", "Switch0", "show port-security interface fastEthernet 0/2", "enable", 35000);
  await record("restore-verification", "Switch0", "show errdisable recovery", "enable", 35000);
  await record("restore-verification", "Switch0", "show interfaces status", "enable", 35000);
  await record("restore-verification", "PC0", "ping 192.168.10.1", "", 35000);
}

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/port-security-research-pt.json", `${JSON.stringify({ capturedAt: stamp(), backend: "pt", version: "Packet Tracer live bridge", image: "Catalyst 2960-24TT / IOS 15.0(2)SE4", cmlAvailability: "vmrun was not available in PATH; live CML capture unavailable", observations, topology: ["Existing PC0 connects directly to Switch0 Fa0/2 on VLAN 10; the access port receives PC0's source MAC", "No device, cable, or endpoint configuration was added"], restoration: "Port security and auto-recovery experiments removed, original Fa0/2 access VLAN 10 restored and no-shutdown, and final running-config/status/connectivity captured." }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/port-security-research-pt.json" }));
