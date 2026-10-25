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
    await sleep(750);
  }
}
async function runCase(name, accessListConfig, attachConfig, aclId, direction, iface) {
  await config(name, "Router0", [{ mode: "enable", line: "configure terminal" }, ...accessListConfig, g(`interface ${iface}`), i(`ip access-group ${aclId} ${direction}`), i("end")]);
  await record(name, "PC0", "ping 192.168.20.10", "", 1000);
  await record(name, "Router0", "show access-lists", "enable", 1000);
  await record(name, "Router0", `show ip interface ${iface}`, "enable", 1000);
  await record(name, "Router0", "show running-config", "enable", 1000);
  await config(`cleanup-${name}`, "Router0", [{ mode: "enable", line: "configure terminal" }, g(`interface ${iface}`), i(`no ip access-group ${aclId} ${direction}`), ...attachConfig, i("end")]);
}
async function restore() {
  await config("restore", "Router0", [
    { mode: "enable", line: "configure terminal" },
    g("interface gigabitEthernet 0/0.10"), i("no ip access-group 101 in"), i("no ip access-group TTL-EXTENDED in"),
    g("interface gigabitEthernet 0/0.20"), i("no ip access-group 10 out"), i("no ip access-group 11 out"), i("no ip access-group TTL-STANDARD out"),
    g("line vty 0 4"), i("no access-class VTY-MGMT in"), i("no access-class 12 in"), i("end"),
    g("no access-list 10"), g("no access-list 11"), g("no access-list 12"), g("no access-list 101"),
    g("no ip access-list standard TTL-STANDARD"), g("no ip access-list extended TTL-EXTENDED"), g("no ip access-list standard VTY-MGMT"),
    i("end"),
  ]);
  await sleep(2000);
  for (const [device, commands] of [["Router0", ["show running-config", "show access-lists", "show ip interface gigabitEthernet 0/0.10", "show ip interface gigabitEthernet 0/0.20"]], ["PC0", ["ipconfig /all"]], ["PC1", ["ipconfig /all"]]]) {
    for (const command of commands) await record("restore-verification", device, command, device.startsWith("PC") ? "" : "enable", 2000);
  }
}

await record("baseline", "Router0", "show running-config");
await record("baseline", "Router0", "show access-lists");
await record("baseline", "PC0", "ipconfig /all", "");
await record("baseline", "PC1", "ipconfig /all", "");
await sleep(5000);
await record("baseline", "PC0", "ping 192.168.20.10", "", 5000);

try {
  await runCase("standard-numbered-out", [g("access-list 10 deny host 192.168.10.10"), g("access-list 10 permit any")], [g("no access-list 10")], "10", "out", "gigabitEthernet 0/0.20");
  await runCase("implicit-deny", [g("access-list 11 permit host 192.168.10.11")], [g("no access-list 11")], "11", "out", "gigabitEthernet 0/0.20");
  await runCase("extended-numbered-in", [g("access-list 101 deny icmp host 192.168.10.10 host 192.168.20.10"), g("access-list 101 permit ip any any")], [g("no access-list 101")], "101", "in", "gigabitEthernet 0/0.10");
  await runCase("named-standard-out", [g("ip access-list standard TTL-STANDARD"), i("deny host 192.168.10.10"), i("permit any"), i("exit")], [g("no ip access-list standard TTL-STANDARD")], "TTL-STANDARD", "out", "gigabitEthernet 0/0.20");
  await runCase("named-extended-in", [g("ip access-list extended TTL-EXTENDED"), i("deny icmp host 192.168.10.10 host 192.168.20.10"), i("permit ip any any"), i("exit")], [g("no ip access-list extended TTL-EXTENDED")], "TTL-EXTENDED", "in", "gigabitEthernet 0/0.10");

  await config("vty-access-class", "Router0", [
    { mode: "enable", line: "configure terminal" }, g("ip access-list standard VTY-MGMT"), i("permit host 192.168.10.11"), i("exit"),
    g("line vty 0 4"), i("access-class VTY-MGMT in"), i("end"),
  ]);
  await record("vty-named-acl-probe", "Router0", "show running-config | section line vty");
  await record("vty-named-acl-probe", "Router0", "show access-lists");
  await config("vty-access-class", "Router0", [
    { mode: "enable", line: "configure terminal" }, g("line vty 0 4"), i("no access-class VTY-MGMT in"),
    g("access-list 12 permit host 192.168.10.11"), g("line vty 0 4"), i("access-class 12 in"), i("end"),
  ]);
  await record("vty-access-class", "Router0", "show running-config | section line vty");
  await record("vty-access-class", "Router0", "show access-lists");
  await record("vty-access-class", "PC0", "telnet 192.168.10.1", "", 1000);
} finally {
  await restore();
}

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/acls-research-pt.json", `${JSON.stringify({ capturedAt: stamp(), backend: "pt", version: "Packet Tracer live bridge", image: "Cisco IOS 15.1(4)M4 on 2911", observations, topology: ["PC0 192.168.10.10/24 on VLAN 10 and PC1 192.168.20.10/24 on VLAN 20 use the existing Router0 subinterfaces", "No cabling or devices added"], restoration: "Temporary numbered and named ACLs, interface attachments, and VTY access-class removed; router interface and PC baseline state recaptured. PT PC command responses may include previous terminal history." }, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/acls-research-pt.json" }));
