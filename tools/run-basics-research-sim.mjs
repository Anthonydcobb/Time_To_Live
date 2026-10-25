import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const sim = await vite.ssrLoadModule("/src/sim/index.ts");
const { loadTopology, resetMacAllocator } = sim;
const stamp = () => new Date().toISOString();
const commands = [
  "show ip interface brief", "show running-config", "show running-config | include interface",
  "show running-config | section interface", "show startup-config",
  "show interfaces GigabitEthernet0/0", "show interfaces status", "show version",
  "show vlan brief", "show mac address-table", "show arp", "show ip arp",
  "show cdp neighbors", "show cdp neighbors detail", "show ip route",
  "show history", "show clock", "show users", "show ip",
  "show definitely-not-a-command", "show i", "sh ip int br", "show ip interface br",
  "copy running-config startup-config", "write memory",
];
const switchCommands = commands.map((line) => line
  .replaceAll("GigabitEthernet0/0", "FastEthernet0/1")
  .replaceAll("GigabitEthernet0/1", "FastEthernet0/5"));

function topology() {
  return { id: "basics-corner-store", devices: [
    { name: "Router0", type: "router", hostname: "Router", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "no shutdown",
      "interface gigabitEthernet 0/0.10", "encapsulation dot1q 10", "ip address 192.168.10.1 255.255.255.0", "no shutdown",
      "interface gigabitEthernet 0/0.20", "encapsulation dot1q 20", "ip address 192.168.20.1 255.255.255.0", "no shutdown", "end",
    ] },
    { name: "Switch0", type: "switch", hostname: "Switch", startupConfig: [
      "enable", "configure terminal", "vlan 10", "name USERS", "exit", "vlan 20", "name SERVERS", "exit",
      "interface fastEthernet 0/1", "switchport mode trunk", "switchport trunk allowed vlan 10,20", "no shutdown", "exit",
      "interface fastEthernet 0/2", "switchport mode access", "switchport access vlan 10", "no shutdown", "exit",
      "interface fastEthernet 0/3", "switchport mode access", "switchport access vlan 10", "no shutdown", "end",
    ] },
    { name: "PC0", type: "pc" }, { name: "PC2", type: "pc" },
  ], links: [
    { a: "Router0 Gi0/0", b: "Switch0 Fa0/1" },
    { a: "PC0 Fa0", b: "Switch0 Fa0/2" }, { a: "PC2 Fa0", b: "Switch0 Fa0/3" },
  ] };
}

function output(result) { return (result.lines ?? []).join("\n"); }

function settle(device) {
  const settlements = [];
  for (let i = 0; i < 8; i++) {
    const prompt = device.console.prompt();
    if (prompt === device.hostname + "#") break;
    let answer = null;
    if (prompt.includes("[yes/no")) answer = "no";
    else if (prompt === "") answer = "";
    else if (prompt.startsWith("Password")) answer = "";
    else if (prompt.includes("[confirm]") || prompt.includes("Destination filename")) answer = "";
    else break;
    const result = device.console.input(answer);
    settlements.push({ prompt, response: answer, rawOutput: output(result), promptAfter: device.console.prompt() });
  }
  return settlements;
}

function ensureEnable(device) {
  const interactions = settle(device);
  if (device.console.prompt().endsWith(">")) {
    const prompt = device.console.prompt();
    const result = device.console.input("enable");
    interactions.push({ prompt, response: "enable", rawOutput: output(result), promptAfter: device.console.prompt() });
  }
  if (!device.console.prompt().endsWith("#")) {
    const prompt = device.console.prompt();
    const result = device.console.ctrlZ();
    interactions.push({ prompt, response: "__ctrlz__", rawOutput: output(result), promptAfter: device.console.prompt() });
  }
  return interactions;
}

function runCommand(net, device, input) {
  const promptBefore = device.console.prompt();
  const result = device.console.input(input);
  if (result.job) net.clock.runUntil(net.clock.now + 600000, () => result.job.done);
  return { promptBefore, rawOutput: output(result) };
}

const observations = [];
function record(net, device, experiment, input) {
  const preSettlements = ensureEnable(device);
  const command = runCommand(net, device, input);
  const settlements = settle(device);
  if (!device.console.prompt().endsWith("#")) {
    const prompt = device.console.prompt();
    const result = device.console.ctrlZ();
    settlements.push({ prompt, response: "__ctrlz__", rawOutput: output(result), promptAfter: device.console.prompt() });
  }
  observations.push({ backend: "sim", experiment, device: device.id, input, mode: command.promptBefore, status: "ok", rawOutput: command.rawOutput, promptBefore: command.promptBefore, promptAfter: device.console.prompt(), preSettlements, settlements, capturedAt: stamp() });
}

try {
  resetMacAllocator();
  const loaded = loadTopology(topology());
  const net = loaded.network;
  const devices = loaded.devices;
  for (const device of devices.values()) if (device.console) settle(device);
  net.clock.advance(35000);
  for (const [id, list] of [["Router0", commands], ["Switch0", switchCommands]]) {
    for (const input of list) record(net, devices.get(id), "basics", input);
  }
  record(net, devices.get("Router0"), "admin-down", "show interfaces GigabitEthernet0/1");
  record(net, devices.get("Switch0"), "admin-down", "show interfaces FastEthernet0/5");
  for (const [id, input] of [["Router0", "show ?"], ["Router0", "show ip ?"], ["Switch0", "show ?"], ["Switch0", "show vlan ?"]]) {
    const device = devices.get(id);
    const preSettlements = ensureEnable(device);
    const promptBefore = device.console.prompt();
    const result = device.console.help(input);
    observations.push({ backend: "sim", experiment: "help", device: id, input, mode: promptBefore, status: "ok", rawOutput: (result.lines ?? []).join("\n"), promptBefore, promptAfter: device.console.prompt(), preSettlements, settlements: settle(device), helpLine: result.line, capturedAt: stamp() });
  }
  for (const input of ["show v", "show ip int br"]) {
    const device = devices.get("Router0");
    const preSettlements = ensureEnable(device);
    const promptBefore = device.console.prompt();
    const completion = device.console.complete(input);
    observations.push({ backend: "sim", experiment: "tab-completion", device: "Router0", input, mode: promptBefore, status: "ok", rawOutput: "", promptBefore, promptAfter: device.console.prompt(), preSettlements, settlements: settle(device), completion, capturedAt: stamp() });
  }
  const router = devices.get("Router0");
  const preSettlements = ensureEnable(router);
  for (const input of ["configure terminal", "do show version", "interface gigabitEthernet 0/0", "do show version", "end"]) {
    const promptBefore = router.console.prompt();
    const result = router.console.input(input);
    observations.push({ backend: "sim", experiment: "config-mode", device: "Router0", input, mode: promptBefore, status: "ok", rawOutput: output(result), promptBefore, promptAfter: router.console.prompt(), preSettlements: input === "configure terminal" ? preSettlements : [], settlements: settle(router), capturedAt: stamp() });
  }
  ensureEnable(router);
  const pc0 = devices.get("PC0"); const pc2 = devices.get("PC2");
  pc0.shell.execute("ipconfig 192.168.10.10 255.255.255.0 192.168.10.1");
  pc2.shell.execute("ipconfig 192.168.10.11 255.255.255.0 192.168.10.1");
  net.clock.advance(3000);
  for (const [device, input] of [[pc0, "ping 192.168.10.1"], [pc2, "ping 192.168.10.1"]]) {
    const result = device.shell.execute(input);
    if (result.job) net.clock.runUntil(net.clock.now + 600000, () => result.job.done);
    observations.push({ backend: "sim", experiment: "restore-verification", device: device.id, input, mode: "pc-shell", status: "ok", rawOutput: output(result), capturedAt: stamp() });
  }
  await mkdir(resolve(root, "harness/artifacts"), { recursive: true });
  await writeFile(resolve(root, "harness/artifacts/basics-research-sim.json"), JSON.stringify({ capturedAt: stamp(), backend: "sim", version: "workspace-sim", image: "src/sim", observations, topology: topology() }, null, 2) + "\n");
  console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/basics-research-sim.json" }));
} finally {
  await vite.close();
}
