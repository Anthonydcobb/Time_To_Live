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

const topology = {
  id: "dhcp-lan-assignment",
  description: "Router DHCP pool serving a switch-connected PC",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 192.168.30.1 255.255.255.0", "no shutdown", "ip dhcp excluded-address 192.168.30.1 192.168.30.20", "ip dhcp pool USERS", "network 192.168.30.0 255.255.255.0", "default-router 192.168.30.1", "dns-server 192.168.30.53", "end",
    ] },
    { name: "S1", type: "switch", hostname: "S1" },
    { name: "PC1", type: "pc" },
  ],
  links: [
    { a: "R1 Gi0/0", b: "S1 Gi0/1" },
    { a: "PC1 Fa0", b: "S1 Fa0/1" },
  ],
};

function text(result) { return (result?.lines ?? []).join("\n"); }

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const ipconfig = await request({ op: "exec", device: "PC1", line: "ipconfig /dhcp" });
  await request({ op: "advance", ms: 2_000 });
  const binding = await request({ op: "exec", device: "R1", line: "show ip dhcp binding" });
  const snapshot = await request({ op: "snapshot" });
  if (!/192\.168\.30\.(?:2[1-9]|[3-9]\d|1\d\d|2[0-4]\d)/i.test(text(ipconfig))) throw new Error("DHCP did not assign an address outside the excluded range");
  if (!/192\.168\.30\./i.test(text(binding))) throw new Error("DHCP binding table did not record PC1");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { ipconfig: text(ipconfig), binding: text(binding), snapshot } };
  const outputPath = resolve(root, "harness/artifacts/sim-dhcp-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
