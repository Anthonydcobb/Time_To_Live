import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = spawn(process.execPath, [resolve(root, "tools/sim-server.mjs")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
let stderr = "";
const pending = [];
server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    pending.shift()?.(JSON.parse(line));
  }
});
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => { stderr += chunk; });

function request(payload) {
  return new Promise((resolveRequest, reject) => {
    pending.push((response) => response.ok ? resolveRequest(response.result) : reject(new Error(response.error)));
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function text(result) { return (result?.lines ?? []).join("\n"); }

const eigrpTopology = {
  id: "eigrp-adjacency-and-route",
  description: "Two EIGRP routers advertise LANs between PCs",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "interface gigabitEthernet 0/1", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "router eigrp 100", "network 10.0.1.0 0.0.0.255", "network 10.0.12.0 0.0.0.3", "end",
    ] },
    { name: "R2", type: "router", hostname: "R2", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.2.1 255.255.255.0", "no shutdown", "interface gigabitEthernet 0/1", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "router eigrp 100", "network 10.0.2.0 0.0.0.255", "network 10.0.12.0 0.0.0.3", "end",
    ] },
    { name: "PC1", type: "pc", ip: "10.0.1.10/24", gateway: "10.0.1.1" },
    { name: "PC2", type: "pc", ip: "10.0.2.10/24", gateway: "10.0.2.1" },
  ],
  links: [
    { a: "PC1 Fa0", b: "R1 Gi0/0" },
    { a: "R1 Gi0/1", b: "R2 Gi0/1" },
    { a: "PC2 Fa0", b: "R2 Gi0/0" },
  ],
};

const hsrpTopology = {
  id: "hsrp-gateway-failover",
  description: "Two routers provide a resilient virtual gateway to a PC",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.10.1 255.255.255.0", "standby 1 ip 10.0.10.254", "standby 1 priority 110", "no shutdown", "end",
    ] },
    { name: "R2", type: "router", hostname: "R2", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.10.2 255.255.255.0", "standby 1 ip 10.0.10.254", "no shutdown", "end",
    ] },
    { name: "S1", type: "switch", hostname: "S1" },
    { name: "PC1", type: "pc", ip: "10.0.10.10/24", gateway: "10.0.10.254" },
  ],
  links: [
    { a: "R1 Gi0/0", b: "S1 Fa0/1" },
    { a: "R2 Gi0/0", b: "S1 Fa0/2" },
    { a: "PC1 Fa0", b: "S1 Fa0/3" },
  ],
};

try {
  await request({ op: "reset" });
  await request({ op: "load", topology: eigrpTopology });
  await request({ op: "advance", ms: 35_000 });
  const neighbors = await request({ op: "exec", device: "R1", line: "show ip eigrp neighbors" });
  const eigrpTopologyOutput = await request({ op: "exec", device: "R1", line: "show ip eigrp topology" });
  const route = await request({ op: "exec", device: "R1", line: "show ip route" });
  const ping = await request({ op: "exec", device: "PC1", line: "ping -n 4 10.0.2.10" });
  if (!/10\.0\.12\.2/i.test(text(neighbors))) throw new Error("EIGRP neighbor did not form");
  if (!/10\.0\.2\.0\/24/i.test(text(eigrpTopologyOutput))) throw new Error("EIGRP topology omitted the remote LAN");
  if (!/10\.0\.2\.0\/24/i.test(text(route)) || !/\bD\b/i.test(text(route))) throw new Error("EIGRP route was not installed");
  if (!/Reply from 10\.0\.2\.10/i.test(text(ping))) throw new Error("EIGRP end-to-end ping failed");
  const eigrp = { neighbors: text(neighbors), topology: text(eigrpTopologyOutput), route: text(route), ping: text(ping) };

  await request({ op: "reset" });
  await request({ op: "load", topology: hsrpTopology });
  await request({ op: "advance", ms: 35_000 });
  const activeBefore = await request({ op: "exec", device: "R1", line: "show standby" });
  const standbyBefore = await request({ op: "exec", device: "R2", line: "show standby" });
  const pingBefore = await request({ op: "exec", device: "PC1", line: "ping -n 3 10.0.10.254" });
  const configure = await request({ op: "exec", device: "R1", line: "configure terminal" });
  await request({ op: "exec", device: "R1", line: "interface gigabitEthernet 0/0" });
  await request({ op: "exec", device: "R1", line: "shutdown" });
  await request({ op: "exec", device: "R1", line: "end" });
  await request({ op: "advance", ms: 2_000 });
  const activeAfter = await request({ op: "exec", device: "R2", line: "show standby" });
  const pingAfter = await request({ op: "exec", device: "PC1", line: "ping -n 3 10.0.10.254" });
  if (!/State is Active/i.test(text(activeBefore))) throw new Error("HSRP preferred router did not become active");
  if (!/State is Standby/i.test(text(standbyBefore))) throw new Error("HSRP backup router did not become standby");
  if (!/Reply from 10\.0\.10\.254/i.test(text(pingBefore))) throw new Error("HSRP baseline gateway ping failed");
  if (!/State is Active/i.test(text(activeAfter))) throw new Error("HSRP did not fail over after the active link shutdown");
  if (!/Reply from 10\.0\.10\.254/i.test(text(pingAfter))) throw new Error("HSRP gateway ping failed after failover");
  const hsrp = { activeBefore: text(activeBefore), standbyBefore: text(standbyBefore), pingBefore: text(pingBefore), configure: text(configure), activeAfter: text(activeAfter), pingAfter: text(pingAfter) };

  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", scenarios: { eigrp, hsrp } };
  const outputPath = resolve(root, "harness/artifacts/sim-routing-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
