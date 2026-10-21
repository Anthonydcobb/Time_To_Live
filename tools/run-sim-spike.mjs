import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = spawn(process.execPath, [resolve(root, "tools/sim-server.mjs")], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
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
let stderr = "";
server.stderr.on("data", (chunk) => { stderr += chunk; });

function request(payload) {
  return new Promise((resolveRequest, reject) => {
    pending.push((response) => response.ok ? resolveRequest(response.result) : reject(new Error(response.error)));
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

const topology = {
  id: "phase-0-basic-lan",
  description: "One router, one switch and one static PC",
  devices: [
    {
      name: "R1",
      type: "router",
      hostname: "R1",
      startupConfig: [
        "enable",
        "configure terminal",
        "interface gigabitEthernet0/0",
        "ip address 192.168.1.1 255.255.255.0",
        "no shutdown",
        "end",
      ],
    },
    { name: "S1", type: "switch", hostname: "S1" },
    { name: "PC1", type: "pc", ip: "192.168.1.10/24", gateway: "192.168.1.1" },
  ],
  links: [
    { a: "R1 Gi0/0", b: "S1 Gi0/1" },
    { a: "PC1 Fa0", b: "S1 Fa0/1" },
  ],
};

try {
  const observations = [];
  observations.push({ op: "reset", result: await request({ op: "reset" }) });
  observations.push({ op: "load", result: await request({ op: "load", topology }) });
  const helpResult = await request({ op: "help", device: "R1", line: "show ip " });
  if (!helpResult.lines.some((line) => line.includes("route"))) throw new Error("sim help did not list show ip route");
  observations.push({ op: "help", result: helpResult });
  const completionResult = await request({ op: "complete", device: "R1", line: "show ip ro" });
  if (completionResult.completion !== "show ip route ") throw new Error(`unexpected completion: ${completionResult.completion}`);
  observations.push({ op: "complete", result: completionResult });
  observations.push({ op: "advance", result: await request({ op: "advance", ms: 35_000 }) });
  observations.push({ op: "exec", result: await request({ op: "exec", device: "R1", line: "show ip interface brief" }) });
  observations.push({ op: "exec", result: await request({ op: "exec", device: "PC1", line: "ipconfig" }) });
  const pingResult = await request({ op: "exec", device: "PC1", line: "ping 192.168.1.1" });
  if (!pingResult.lines.some((line) => /Reply from 192\.168\.1\.1/i.test(line))) throw new Error("sim startup configuration did not make the gateway reachable");
  observations.push({ op: "exec", result: pingResult });
  observations.push({ op: "snapshot", result: await request({ op: "snapshot" }) });
  const artifact = {
    experimentId: topology.id,
    runId: new Date().toISOString(),
    backend: "sim",
    backendVersion: "local",
    topology,
    observations,
  };
  const outputPath = resolve(root, "harness/artifacts/sim-spike.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
