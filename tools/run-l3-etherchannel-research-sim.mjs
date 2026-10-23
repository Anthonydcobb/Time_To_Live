import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const { Network } = await vite.ssrLoadModule("/src/sim/network.ts");
const { Switch } = await vite.ssrLoadModule("/src/sim/devices/switch.ts");
const { Router } = await vite.ssrLoadModule("/src/sim/devices/router.ts");
const { Pc } = await vite.ssrLoadModule("/src/sim/devices/pc.ts");
const { parseIpv4: ip, resetMacAllocator } = await vite.ssrLoadModule("/src/sim/addr.ts");
const { finish } = await vite.ssrLoadModule("/tests/helpers.ts");

const observations = [];
const stamp = () => new Date().toISOString();
const output = (d, result) => [...(result.lines ?? []), ...(result.job ? finish(d, result.job) : [])];
function settle(d) {
  const items = [];
  for (let n = 0; n < 8; n++) {
    const p = d.console.prompt();
    if (p === "" || p.includes("[confirm]") || p.includes("Destination filename")) {
      const r = d.console.input("");
      items.push({ prompt: p, response: "", rawOutput: r.lines, promptAfter: d.console.prompt() });
    } else break;
  }
  return items;
}
function enable(d) {
  const preSettlements = settle(d);
  if (d.console.prompt().endsWith(">")) d.console.input("enable");
  if (d.console.prompt().includes("(config")) d.console.ctrlZ();
  return preSettlements;
}
function record(d, experiment, input, extra = {}) {
  const preSettlements = extra.keepMode ? [] : enable(d);
  const promptBefore = d.console.prompt();
  const result = d.console.input(input);
  const lines = output(d, result);
  const promptAfter = d.console.prompt();
  observations.push({ backend: "sim", version: "workspace-sim", image: "src/sim", experiment, device: d.id, input, mode: promptBefore, status: "ok", rawOutput: lines.join("\n"), promptBefore, promptAfter, preSettlements, waitedMs: extra.waitedMs ?? 0, ...extra, capturedAt: stamp() });
  return result;
}
function config(d, experiment, lines) {
  enable(d);
  record(d, experiment, "configure terminal");
  for (const line of lines) record(d, experiment, line, { keepMode: true });
  enable(d);
}
function ping(pc, experiment, target, net, waitedMs = 3000) {
  const result = pc.shell.execute(`ping -n 4 ${target}`);
  if (result.job) net.clock.runUntil(net.clock.now + 600000, () => result.job.done);
  observations.push({ backend: "sim", version: "workspace-sim", image: "src/sim", experiment, device: pc.id, input: `ping -n 4 ${target}`, mode: "pc-shell", status: "ok", rawOutput: output(pc, result).join("\n"), waitedMs, capturedAt: stamp() });
}

resetMacAllocator();
const net = new Network();
const a = net.add(new Switch("SWA", "SWA"));
const b = net.add(new Switch("SWB", "SWB"));
const left = net.add(new Pc("LEFT"));
const right = net.add(new Pc("RIGHT"));
const core = net.add(new Switch("CORE", "CORE"));
const r1 = net.add(new Router("R1", "R1"));
const l3left = net.add(new Pc("L3LEFT"));
const l3right = net.add(new Pc("L3RIGHT"));
const vlan10 = net.add(new Pc("VLAN10"));
const vlan20 = net.add(new Pc("VLAN20"));
for (const d of [a, b, core, r1]) settle(d);

net.connect(a.port("Gi0/1"), b.port("Gi0/1"));
net.connect(a.port("Gi0/2"), b.port("Gi0/2"));
config(a, "etherchannel-baseline", ["interface gi0/1", "switchport mode trunk", "channel-group 1 mode active", "interface gi0/2", "switchport mode trunk", "channel-group 1 mode active", "end"]);
config(b, "etherchannel-baseline", ["interface gi0/1", "switchport mode trunk", "channel-group 1 mode active", "interface gi0/2", "switchport mode trunk", "channel-group 1 mode active", "end"]);
net.clock.advance(35000);
for (const command of ["show etherchannel summary", "show etherchannel port-channel 1", "show interfaces port-channel 1", "show lacp neighbor", "show pagp neighbor", "show etherchannel load-balance", "show spanning-tree"]) record(a, "etherchannel-active-active", command, { waitedMs: 35000 });

const matrix = [["active-passive", "active", "passive"], ["passive-passive", "passive", "passive"], ["desirable-auto", "desirable", "auto"], ["auto-auto", "auto", "auto"], ["on-on", "on", "on"], ["on-active", "on", "active"]];
let group = 10;
for (const [name, leftMode, rightMode] of matrix) {
  config(a, `matrix-${name}`, ["interface range gi0/1 - 2", "no channel-group", `channel-group ${group} mode ${leftMode}`, "end"]);
  config(b, `matrix-${name}`, ["interface range gi0/1 - 2", "no channel-group", `channel-group ${group} mode ${rightMode}`, "end"]);
  net.clock.advance(5000);
  record(a, `matrix-${name}`, "show etherchannel summary", { waitedMs: 5000 });
  group++;
}

config(a, "mismatch-member-settings", ["interface gi0/1", "no channel-group", "switchport mode trunk", "channel-group 20 mode active", "interface gi0/2", "no channel-group", "switchport mode access", "speed 10", "duplex half", "channel-group 20 mode active", "end"]);
config(b, "mismatch-member-settings", ["interface range gi0/1 - 2", "no channel-group", "switchport mode trunk", "channel-group 20 mode active", "end"]);
net.clock.advance(5000);
for (const command of ["show etherchannel summary", "show interfaces status", "show logging"]) record(a, "mismatch-member-settings", command, { waitedMs: 5000 });
net.disconnect(a.port("Gi0/2"));
net.clock.advance(5000);
record(a, "member-failure", "show etherchannel summary", { waitedMs: 5000 });
net.connect(a.port("Gi0/2"), b.port("Gi0/2"));
net.clock.advance(35000);
record(a, "member-recovery", "show etherchannel summary", { waitedMs: 35000 });

config(core, "l3-switch-off", ["interface gi0/1", "no switchport", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "interface gi0/2", "no switchport", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "end"]);
net.connect(l3left.nic, core.port("Gi0/1"));
net.connect(l3right.nic, core.port("Gi0/2"));
l3left.configure(ip("10.0.0.10"), ip("255.255.255.0"), ip("10.0.0.1"));
l3right.configure(ip("10.0.1.10"), ip("255.255.255.0"), ip("10.0.1.1"));
net.clock.advance(3000);
ping(l3left, "l3-ip-routing-off", "10.0.1.10", net);
config(core, "l3-ip-routing-on", ["ip routing", "end"]);
net.clock.advance(3000);
ping(l3left, "l3-ip-routing-on", "10.0.1.10", net);
record(core, "l3-ip-routing-on", "show ip route", { waitedMs: 3000 });

config(core, "svi-routing", ["vlan 10", "vlan 20", "interface vlan 10", "ip address 192.168.10.1 255.255.255.0", "no shutdown", "interface vlan 20", "ip address 192.168.20.1 255.255.255.0", "no shutdown", "interface fastEthernet 0/1", "switchport mode access", "switchport access vlan 10", "interface fastEthernet 0/2", "switchport mode access", "switchport access vlan 20", "end"]);
net.connect(vlan10.nic, core.port("Fa0/1"));
net.connect(vlan20.nic, core.port("Fa0/2"));
vlan10.configure(ip("192.168.10.10"), ip("255.255.255.0"), ip("192.168.10.1"));
vlan20.configure(ip("192.168.20.10"), ip("255.255.255.0"), ip("192.168.20.1"));
net.clock.advance(35000);
ping(vlan10, "svi-inter-vlan", "192.168.20.10", net, 35000);
record(core, "svi-inter-vlan", "show ip route", { waitedMs: 35000 });

config(core, "default-route", ["interface fastEthernet 0/5", "no switchport", "ip address 172.16.0.2 255.255.255.0", "no shutdown", "exit", "ip route 0.0.0.0 0.0.0.0 172.16.0.1", "end"]);
record(core, "default-route", "show ip route");
config(core, "routed-etherchannel", ["interface port-channel 30", "no switchport", "ip address 172.31.0.2 255.255.255.252", "no shutdown", "end"]);
record(core, "routed-etherchannel", "show running-config");

await mkdir(resolve(root, "harness/artifacts"), { recursive: true });
await writeFile(resolve(root, "harness/artifacts/l3-etherchannel-research-sim.json"), JSON.stringify({ capturedAt: stamp(), backend: "sim", version: "workspace-sim", image: "src/sim", observations }, null, 2) + "\n");
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/l3-etherchannel-research-sim.json" }));
await vite.close();
