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

const topology = {
  id: "vlan-trunk-switching",
  description: "VLAN 10 carried across an 802.1Q trunk between switches",
  devices: [
    { name: "S1", type: "switch", hostname: "S1", startupConfig: [
      "enable", "configure terminal", "vlan 10", "name USERS", "exit",
      "interface fa0/1", "switchport mode access", "switchport access vlan 10",
      "interface gigabitEthernet 0/1", "switchport mode trunk", "end",
    ] },
    { name: "S2", type: "switch", hostname: "S2", startupConfig: [
      "enable", "configure terminal", "vlan 10", "name USERS", "exit",
      "interface fa0/1", "switchport mode access", "switchport access vlan 10",
      "interface gigabitEthernet 0/1", "switchport mode trunk", "end",
    ] },
    { name: "PC1", type: "pc", ip: "10.10.0.1/24" },
    { name: "PC2", type: "pc", ip: "10.10.0.2/24" },
  ],
  links: [
    { a: "PC1 Fa0", b: "S1 Fa0/1" },
    { a: "S1 Gi0/1", b: "S2 Gi0/1" },
    { a: "PC2 Fa0", b: "S2 Fa0/1" },
  ],
};

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const vlan = await request({ op: "exec", device: "S1", line: "show vlan brief" });
  const trunk = await request({ op: "exec", device: "S1", line: "show interfaces trunk" });
  const spanning = await request({ op: "exec", device: "S1", line: "show spanning-tree" });
  const switchport = await request({ op: "exec", device: "S1", line: "show interfaces fa0/1 switchport" });
  const ping = await request({ op: "exec", device: "PC1", line: "ping -n 4 10.10.0.2" });
  if (!/10\s+USERS/i.test(text(vlan))) throw new Error("VLAN 10 was not created");
  if (!/Gi0\/1.*trunking/i.test(text(trunk))) throw new Error("Trunk output did not show the forwarding trunk");
  if (!/Spanning tree enabled/i.test(text(spanning)) || !/FWD/i.test(text(spanning))) throw new Error("STP did not converge on the switching topology");
  if (!/Access Mode VLAN: 10/i.test(text(switchport))) throw new Error("Access port was not assigned to VLAN 10");
  if (!/Reply from 10\.10\.0\.2/i.test(text(ping))) throw new Error("VLAN 10 end-to-end ping failed");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { vlan: text(vlan), trunk: text(trunk), spanning: text(spanning), switchport: text(switchport), ping: text(ping) } };
  const outputPath = resolve(root, "harness/artifacts/sim-switching-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
