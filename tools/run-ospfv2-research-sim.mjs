import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const { Network } = await vite.ssrLoadModule("/src/sim/network.ts");
const { Router } = await vite.ssrLoadModule("/src/sim/devices/router.ts");
const { Switch } = await vite.ssrLoadModule("/src/sim/devices/switch.ts");
const { Pc } = await vite.ssrLoadModule("/src/sim/devices/pc.ts");
const { parseIpv4: ip } = await vite.ssrLoadModule("/src/sim/addr.ts");

const observations = [];
const stamp = () => new Date().toISOString();
const run = (device, experiment, input) => {
  const before = device.console.prompt();
  const result = device.console.input(input);
  observations.push({ backend: "sim", version: "workspace-sim", image: "src/sim", experiment, device: device.id, input, mode: before, status: "ok", rawOutput: [...(result.lines ?? [])].join("\n"), promptBefore: before, promptAfter: device.console.prompt(), waitedMs: 0, capturedAt: stamp() });
  return result;
};
const exec = (device, experiment, command) => {
  if (device.console.prompt().endsWith(">")) run(device, experiment, "enable");
  if (device.console.prompt().includes("(config")) run(device, experiment, "end");
  return run(device, experiment, command);
};
const conf = (device, experiment, commands) => {
  if (device.console.prompt().endsWith(">")) run(device, experiment, "enable");
  run(device, experiment, "configure terminal");
  for (const command of commands) run(device, experiment, command);
  run(device, experiment, "end");
};
const wait = (ms) => net.clock.advance(ms);
const capture = (device, experiment, commands, waitedMs = 0) => {
  for (const command of commands) {
    const before = observations.length;
    exec(device, experiment, command);
    observations[before].waitedMs = waitedMs;
  }
};

const net = new Network();
const r0 = net.add(new Router("R0", "R0"));
const r1 = net.add(new Router("R1", "R1"));
const sw = net.add(new Switch("SW", "SW"));
const swLan = net.add(new Switch("SWLAN", "SWLAN"));
const lan = net.add(new Pc("LAN"));
net.connect(r0.port("Gi0/0"), sw.port("Fa0/1"));
net.connect(r1.port("Gi0/0"), sw.port("Fa0/2"));
net.connect(r1.port("Gi0/1"), swLan.port("Fa0/1"));
net.connect(lan.nic, swLan.port("Fa0/2"));
lan.configure(ip("10.30.0.10"), ip("255.255.255.0"), ip("10.30.0.1"));
for (const r of [r0, r1]) if (r.console.prompt().includes("[confirm]")) r.console.input("");

capture(r0, "baseline", ["show ip ospf neighbor", "show ip route"]);
capture(r1, "baseline", ["show ip ospf neighbor", "show ip route"]);

conf(r0, "ospfv2-baseline", ["hostname R0", "interface gi0/0", "ip address 192.168.20.1 255.255.255.0", "no shutdown", "ip ospf priority 1", "router ospf 1", "router-id 1.1.1.1", "network 192.168.20.0 0.0.0.255 area 0"]);
conf(r1, "ospfv2-baseline", ["hostname R1", "interface gi0/0", "ip address 192.168.20.2 255.255.255.0", "no shutdown", "ip ospf priority 1", "interface gi0/1", "ip address 10.30.0.1 255.255.255.0", "no shutdown", "router ospf 1", "router-id 2.2.2.2", "network 192.168.20.0 0.0.0.255 area 0", "network 10.30.0.0 0.0.0.255 area 0"]);
wait(45000);
capture(r0, "ospfv2-baseline", ["show ip ospf neighbor", "show ip ospf neighbor detail", "show ip ospf interface", "show ip ospf database", "show ip route", "show ip protocols"], 45000);
capture(r1, "ospfv2-baseline", ["show ip ospf neighbor", "show ip ospf interface", "show ip ospf database", "show ip route"], 45000);

conf(r1, "passive-interface", ["router ospf 1", "passive-interface gi0/1"]);
wait(5000);
capture(r1, "passive-interface", ["show ip ospf neighbor", "show ip ospf interface gi0/1", "show ip route", "show running-config"], 5000);
capture(r0, "passive-interface", ["show ip ospf neighbor", "show ip route"], 5000);

conf(r1, "cost", ["interface gi0/1", "ip ospf cost 25"]);
wait(5000);
capture(r1, "cost", ["show ip ospf interface gi0/1", "show ip route"], 5000);
capture(r0, "cost", ["show ip route"], 5000);

conf(r0, "default-information-originate", ["ip route 0.0.0.0 0.0.0.0 192.168.20.254", "router ospf 1", "default-information originate"]);
wait(5000);
capture(r1, "default-information-originate", ["show ip route", "show ip ospf database external", "show ip protocols"], 5000);

const artifact = { capturedAt: stamp(), backend: "sim", version: "workspace-sim", image: "src/sim", observations, topology: ["R0 Gi0/0 and R1 Gi0/0 share a simulated broadcast switch segment", "R1 Gi0/1 serves 10.30.0.0/24 through a second switch with one end host"], restoration: "Simulation is ephemeral; network discarded after capture." };
await mkdir(resolve(root, "harness/artifacts"), { recursive: true });
await writeFile(resolve(root, "harness/artifacts/ospfv2-research-sim.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/ospfv2-research-sim.json" }));
await vite.close();
