import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const scenarioResults = [];

async function command(device, line, mode = "enable") {
  const response = await executeDeviceCommand(device, line, mode);
  return response.result ?? response;
}

async function configure(commands) {
  return configureDevice("Switch0", commands);
}

async function observe() {
  const ipconfig = await command("PC0", "ipconfig", "");
  const ping = await command("PC0", "ping 192.168.10.1", "");
  const interfaces = await command("Switch0", "show ip interface brief");
  const vlans = await command("Switch0", "show vlan brief");
  const macs = await command("Switch0", "show mac address-table");
  const text = (result) => String(result?.output ?? "");
  const interfaceText = text(interfaces);
  const macText = text(macs);
  return {
    pcIpConfigured: /IPv4 Address.*192\.168\.10\.10/i.test(text(ipconfig)),
    pingReachable: /Reply from 192\.168\.10\.1/i.test(text(ping)),
    accessPortUp: /FastEthernet0\/2\s+\S+\s+YES\s+\S+\s+up\s+up/i.test(interfaceText),
    accessPortAdminDown: /FastEthernet0\/2\s+\S+\s+YES\s+\S+\s+administratively down\s+down/i.test(interfaceText),
    pcMacOnVlan1: /\b1\s+00e0\.a379\.2d27\s+\w+\s+Fa0\/2/i.test(macText),
    vlan20Present: /\n20\s+FAULT_TEST\s+active/i.test(text(vlans)),
    raw: { ipconfig: text(ipconfig), ping: text(ping), interfaces: interfaceText, vlans: text(vlans), macs: macText },
  };
}

async function runScenario(id, description, inject, restore) {
  const before = await observe();
  const injected = await inject();
  const during = await observe();
  await restore();
  const after = await observe();
  scenarioResults.push({ id, description, before, injected, during, after });
  console.log(`${id}: fault observed=${JSON.stringify(during)} restored=${after.pingReachable && after.pcMacOnVlan1}`);
}

await runScenario(
  "access-port-shutdown",
  "Disable Switch0 Fa0/2 while leaving the PC configured.",
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/2", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/2", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await runScenario(
  "wrong-access-vlan",
  "Move PC0 Fa0/2 to VLAN 20 while the SVI remains on VLAN 1.",
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "vlan 20", mode: "global" },
    { line: "name FAULT_TEST", mode: "" },
    { line: "exit", mode: "" },
    { line: "interface fastethernet 0/2", mode: "global" },
    { line: "switchport access vlan 20", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/2", mode: "global" },
    { line: "switchport access vlan 1", mode: "" },
    { line: "end", mode: "" },
    { line: "configure terminal", mode: "enable" },
    { line: "no vlan 20", mode: "global" },
    { line: "end", mode: "" },
  ]),
);

await runScenario(
  "wrong-svi-address",
  "Change Switch0 VLAN 1 from 192.168.10.1 to 192.168.20.1.",
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface vlan 1", mode: "global" },
    { line: "ip address 192.168.20.1 255.255.255.0", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface vlan 1", mode: "global" },
    { line: "ip address 192.168.10.1 255.255.255.0", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await runScenario(
  "wrong-pc-address",
  "Give PC0 an address on the wrong subnet while the switch remains on 192.168.10.0/24.",
  async () => {
    const result = await command("PC0", "ipconfig 192.168.20.10 255.255.255.0 192.168.20.1", "");
    return result;
  },
  async () => {
    const result = await command("PC0", "ipconfig 192.168.10.10 255.255.255.0 192.168.10.1", "");
    return result;
  },
);

await runScenario(
  "svi-shutdown",
  "Disable Switch0 VLAN 1 while leaving the physical access port connected.",
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface vlan 1", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure([
    { line: "configure terminal", mode: "enable" },
    { line: "interface vlan 1", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-fault-scenarios.json", JSON.stringify({ capturedAt: new Date().toISOString(), scenarios: scenarioResults }, null, 2));
console.log("Wrote harness/artifacts/pt-fault-scenarios.json");
