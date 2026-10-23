import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const { dentist } = await vite.ssrLoadModule("/src/sim/scenarios/dentist.ts");
const { Switch } = await vite.ssrLoadModule("/src/sim/devices/switch.ts");
const { parseIpv4: ip } = await vite.ssrLoadModule("/src/sim/addr.ts");
const { finish } = await vite.ssrLoadModule("/tests/helpers.ts");
const stamp = () => new Date().toISOString();
const observations = [];
const logs = new Map();
const output = (r) => [...r.lines, ...(r.job ? finish(r.device ?? r, r.job) : [])];

function settle(d) {
  const interactions = [];
  for (let i = 0; i < 8; i++) {
    const prompt = d.console.prompt();
    if (prompt === "") {
      const r = d.console.input("");
      interactions.push({ prompt, response: "", rawOutput: r.lines, promptAfter: d.console.prompt() });
    } else if (prompt.includes("[confirm]") || prompt.includes("Destination filename")) {
      const r = d.console.input("");
      interactions.push({ prompt, response: "", rawOutput: r.lines, promptAfter: d.console.prompt() });
    } else break;
  }
  return interactions;
}
function enable(d) {
  const pre = settle(d);
  if (d.console.prompt().endsWith(">")) {
    const prompt = d.console.prompt(); const r = d.console.input("enable");
    pre.push({ prompt, response: "enable", rawOutput: r.lines, promptAfter: d.console.prompt() });
  }
  if (d.console.prompt().includes("(config")) {
    const prompt = d.console.prompt(); const r = d.console.ctrlZ();
    pre.push({ prompt, response: "__ctrlz__", rawOutput: r.lines, promptAfter: d.console.prompt() });
  }
  return pre;
}
function record(d, experiment, input, { keepMode = false, extra = {} } = {}) {
  const preSettlements = keepMode ? [] : enable(d);
  const promptBefore = d.console.prompt();
  const r = d.console.input(input);
  const lines = output({ ...r, device: d });
  const settlements = settle(d);
  if (!keepMode && !d.console.prompt().endsWith("#")) {
    const prompt = d.console.prompt(); const x = d.console.ctrlZ();
    settlements.push({ prompt, response: "__ctrlz__", rawOutput: x.lines, promptAfter: d.console.prompt() });
  }
  observations.push({ backend: "sim", experiment, device: d.id, input, mode: promptBefore, status: "ok", rawOutput: lines.join("\n"), promptBefore, promptAfter: d.console.prompt(), preSettlements, settlements, logs: logs.get(d.id)?.splice(0) ?? [], ...extra, capturedAt: stamp() });
}
function config(d, experiment, lines) {
  enable(d);
  if (lines[0] !== "configure terminal") record(d, experiment, "configure terminal", { keepMode: true });
  for (const input of lines) record(d, experiment, input, { keepMode: true });
  enable(d);
}

const { net, r1, s1, frontDesk, xray } = dentist();
const s2 = net.add(new Switch("S2"));
net.connect(s1.port("GigabitEthernet0/2"), s2.port("GigabitEthernet0/1"));
for (const d of [r1, s1, s2]) {
  const bucket = []; logs.set(d.id, bucket); d.onOutput((line) => bucket.push(line)); settle(d);
}
net.clock.advance(35_000);

config(s1, "dentist-vlans", [
  "configure terminal", "vlan 10", "name STAFF", "exit", "vlan 20", "name XRAY", "exit",
  "interface fastEthernet 0/1", "switchport mode access", "switchport access vlan 10",
  "interface fastEthernet 0/2", "switchport mode access", "switchport access vlan 10",
  "interface fastEthernet 0/3", "switchport mode access", "switchport access vlan 20",
  "interface gigabitEthernet 0/1", "switchport mode trunk", "switchport trunk allowed vlan 10,20", "end",
]);
for (const input of ["show vlan brief", "show vlan id 10", "show interfaces trunk", "show interfaces gigabitEthernet 0/1 switchport"]) record(s1, "dentist-show", input);

const dtpCases = [
  ["auto-auto", "switchport mode dynamic auto", "switchport mode dynamic auto"],
  ["auto-desirable", "switchport mode dynamic auto", "switchport mode dynamic desirable"],
  ["desirable-desirable", "switchport mode dynamic desirable", "switchport mode dynamic desirable"],
  ["trunk-auto", "switchport mode trunk", "switchport mode dynamic auto"],
  ["trunk-nonegotiate-desirable", ["switchport mode trunk", "switchport nonegotiate"], "switchport mode dynamic desirable"],
  ["access-desirable", "switchport mode access", "switchport mode dynamic desirable"],
];
for (const [name, a, b] of dtpCases) {
  config(s1, "dtp-" + name, ["interface gigabitEthernet 0/2", ...(Array.isArray(a) ? a : [a]), "end"]);
  config(s2, "dtp-" + name, ["interface gigabitEthernet 0/1", ...(Array.isArray(b) ? b : [b]), "end"]);
  net.clock.advance(3_000);
  record(s1, "dtp-" + name, "show interfaces gigabitEthernet 0/2 switchport", { extra: { operationalMode: s1.operationalMode(s1.port("Gi0/2")) } });
  record(s2, "dtp-" + name, "show interfaces gigabitEthernet 0/1 switchport", { extra: { operationalMode: s2.operationalMode(s2.port("Gi0/1")) } });
}
config(s1, "nonegotiate-rejection", ["interface gigabitEthernet 0/2", "switchport mode dynamic auto", "switchport nonegotiate", "end"]);

config(s1, "allowed-vlan-mutations", [
  "interface gigabitEthernet 0/2", "switchport mode trunk", "switchport trunk allowed vlan 10,20",
  "switchport trunk allowed vlan add 30", "switchport trunk allowed vlan remove 20",
  "switchport trunk allowed vlan except 30", "switchport trunk allowed vlan none", "end",
]);
record(s1, "allowed-vlan-mutations", "show interfaces trunk");
record(s1, "allowed-vlan-mutations", "show interfaces gigabitEthernet 0/2 switchport");

config(s1, "native-mismatch", ["vlan 99", "exit", "interface gigabitEthernet 0/2", "switchport mode trunk", "switchport trunk native vlan 99", "end"]);
config(s2, "native-mismatch", ["vlan 99", "exit", "interface gigabitEthernet 0/1", "switchport mode trunk", "switchport trunk native vlan 1", "end"]);
// CDP advertisements are periodic at 60 seconds; wait past the interval
// before inspecting the native-VLAN mismatch log.
net.clock.advance(65_000);
record(s1, "native-mismatch", "show logging");
record(s2, "native-mismatch", "show logging");

config(r1, "router-on-a-stick", [
  "interface gigabitEthernet 0/0", "no shutdown", "interface gigabitEthernet 0/0.10",
  "encapsulation dot1Q 10", "ip address 192.168.10.1 255.255.255.0",
  "interface gigabitEthernet 0/0.20", "encapsulation dot1Q 20", "ip address 192.168.20.1 255.255.255.0", "end",
]);
net.clock.advance(3_000);
record(r1, "router-on-a-stick", "show ip interface brief");
frontDesk.configure(ip("192.168.10.10"), ip("255.255.255.0"), ip("192.168.10.1"));
xray.configure(ip("192.168.20.10"), ip("255.255.255.0"), ip("192.168.20.1"));
net.clock.advance(35_000);
const ping = xray.shell.execute("ping -n 2 192.168.10.10");
observations.push({ backend: "sim", experiment: "inter-vlan-ping", device: "PC2", input: "ping -n 2 192.168.10.10", mode: "pc-shell", status: "ok", rawOutput: output({ ...ping, device: xray }).join("\n"), capturedAt: stamp() });

config(s1, "svi-autostate", ["vlan 30", "exit", "interface vlan 30", "ip address 192.168.30.1 255.255.255.0", "no shutdown", "end"]);
record(s1, "svi-autostate", "show ip interface brief");
config(s1, "svi-autostate-active", ["interface fastEthernet 0/1", "switchport access vlan 30", "end"]);
net.clock.advance(3_000);
record(s1, "svi-autostate-active", "show ip interface brief");

config(s1, "voice-vlan", ["interface fastEthernet 0/2", "switchport mode access", "switchport voice vlan 150", "end"]);
record(s1, "voice-vlan", "show interfaces fastEthernet 0/2 switchport");

config(s1, "deleted-vlan", ["vlan 77", "exit", "interface fastEthernet 0/4", "switchport mode access", "switchport access vlan 77", "end"]);
record(s1, "deleted-vlan", "show interfaces fastEthernet 0/4 switchport");
config(s1, "deleted-vlan", ["no vlan 77"]);
record(s1, "deleted-vlan", "show interfaces fastEthernet 0/4 switchport");

config(s1, "restore", [
  "interface fastEthernet 0/1", "switchport access vlan 10",
  "interface fastEthernet 0/2", "switchport access vlan 10", "no switchport voice vlan",
  "interface fastEthernet 0/3", "switchport access vlan 20",
  "interface vlan 30", "shutdown", "no ip address", "exit",
  "no vlan 30", "no vlan 99", "no vlan 150",
  "interface gigabitEthernet 0/2", "switchport mode trunk", "switchport trunk native vlan 1", "switchport trunk allowed vlan 10,20", "end",
]);
config(s2, "restore", ["interface gigabitEthernet 0/1", "switchport mode dynamic auto", "switchport trunk native vlan 1", "switchport trunk allowed vlan 10,20", "end"]);
record(s1, "restore", "show vlan brief");
record(r1, "restore", "show ip interface brief");
for (const [pc, target] of [[frontDesk, "192.168.10.1"], [xray, "192.168.20.1"]]) {
  const result = pc.shell.execute("ping " + target);
  if (result.job) net.clock.runUntil(net.clock.now + 600_000, () => result.job.done);
  observations.push({ backend: "sim", experiment: "restore-verification", device: pc.id, input: "ping " + target, mode: "pc-shell", status: "ok", rawOutput: output({ ...result, device: pc }).join("\n"), capturedAt: stamp() });
}
await mkdir(resolve(root, "harness/artifacts"), { recursive: true });
await writeFile(resolve(root, "harness/artifacts/vlans-research-sim.json"), JSON.stringify({ capturedAt: stamp(), backend: "sim", version: "workspace-sim", image: "src/sim", observations }, null, 2) + "\n");
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/vlans-research-sim.json" }));
await vite.close();
