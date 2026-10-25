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
  id: "ipv6-pc-gateway",
  description: "Router and PC with IPv6 addressing loaded from JSON",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "ipv6 unicast-routing",
      "interface gigabitEthernet 0/0", "ipv6 address 2001:db8:10::1/64", "no shutdown", "end",
    ] },
    { name: "S1", type: "switch", hostname: "S1" },
    { name: "PC1", type: "pc", ipv6: "2001:db8:10::10/64", ipv6Gateway: "2001:db8:10::1" },
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
  const ping = await request({ op: "exec", device: "R1", line: "ping ipv6 2001:db8:10::10" });
  const neighbors = await request({ op: "exec", device: "R1", line: "show ipv6 neighbors" });
  const snapshot = await request({ op: "snapshot" });
  if (!/Success rate is 100 percent/i.test(text(ping))) throw new Error("IPv6 gateway scenario did not reach PC1");
  if (!/2001:0db8:0010:0000:0000:0000:0000:0010/i.test(text(neighbors))) throw new Error("IPv6 neighbor discovery did not learn PC1");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { ping: text(ping), neighbors: text(neighbors), snapshot } };
  const outputPath = resolve(root, "harness/artifacts/sim-ipv6-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
