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
  id: "acl-intervlan-filter",
  description: "Two routed LANs with an extended ACL blocking ICMP",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "interface gigabitEthernet 0/1", "ip address 10.0.1.1 255.255.255.0", "no shutdown", "end",
    ] },
    { name: "PC1", type: "pc", ip: "10.0.0.10/24", gateway: "10.0.0.1" },
    { name: "PC2", type: "pc", ip: "10.0.1.10/24", gateway: "10.0.1.1" },
  ],
  links: [
    { a: "PC1 Fa0", b: "R1 Gi0/0" },
    { a: "PC2 Fa0", b: "R1 Gi0/1" },
  ],
};

function text(result) { return (result?.lines ?? []).join("\n"); }
async function ping() { return text(await request({ op: "exec", device: "PC1", line: "ping -n 4 10.0.1.10" })); }
async function configure(lines) {
  for (const line of lines) await request({ op: "exec", device: "R1", line });
}

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const before = await ping();
  await configure(["enable", "configure terminal", "access-list 101 deny icmp 10.0.0.10 10.0.1.10", "access-list 101 permit ip any any", "interface gigabitEthernet 0/0", "ip access-group 101 in", "end"]);
  const during = await ping();
  const blockedAcl = text(await request({ op: "exec", device: "R1", line: "show access-lists" }));
  await configure(["enable", "configure terminal", "interface gigabitEthernet 0/0", "no ip access-group 101 in", "end"]);
  const after = await ping();
  if (!/Reply from 10\.0\.1\.10/i.test(before)) throw new Error("Baseline routed ping did not pass");
  if (/Reply from 10\.0\.1\.10/i.test(during)) throw new Error("ACL did not block ICMP");
  if (!/deny icmp/i.test(blockedAcl)) throw new Error("ACL output did not show the deny rule");
  if (!/Reply from 10\.0\.1\.10/i.test(after)) throw new Error("Removing the ACL did not restore reachability");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { before, during, blockedAcl, after } };
  const outputPath = resolve(root, "harness/artifacts/sim-acl-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
