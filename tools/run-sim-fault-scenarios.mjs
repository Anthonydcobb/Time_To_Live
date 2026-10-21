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
  id: "sim-fault-scenarios",
  description: "One router, one switch and one static PC for intentional faults",
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

async function exec(device, line, mode = "") {
  return request({ op: "exec", device, line, mode });
}

async function advance(ms) {
  return request({ op: "advance", ms });
}

async function configure(device, lines) {
  for (const line of lines) await exec(device, line);
}

function text(result) {
  return (result?.lines ?? []).join("\n");
}

async function observe() {
  const ping = await exec("PC1", "ping -n 1 192.168.1.1");
  const status = await exec("S1", "show interfaces status", "enable");
  const errors = await exec("R1", "show interfaces counters errors", "enable");
  return {
    pingReachable: /Reply from 192\.168\.1\.1/i.test(text(ping)),
    switchStatus: text(status),
    routerErrors: text(errors),
  };
}

async function runScenario(id, description, inject, restore) {
  const before = await observe();
  await inject();
  await advance(1000);
  const during = await observe();
  await restore();
  await advance(35_000);
  const after = await observe();
  return { id, description, before, during, after };
}

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await advance(35_000);
  const scenarios = [];
  scenarios.push(await runScenario(
    "access-port-shutdown",
    "Disable S1 Fa0/1 while PC1 remains configured.",
    () => configure("S1", ["enable", "configure terminal", "interface fastEthernet 0/1", "shutdown", "end"]),
    () => configure("S1", ["enable", "configure terminal", "interface fastEthernet 0/1", "no shutdown", "end"]),
  ));
  scenarios.push(await runScenario(
    "forced-speed-mismatch",
    "Force R1 Gi0/0 to 100 Mbps and S1 Gi0/1 to 1000 Mbps.",
    async () => {
      await configure("R1", ["enable", "configure terminal", "interface gigabitEthernet 0/0", "speed 100", "end"]);
      await configure("S1", ["enable", "configure terminal", "interface gigabitEthernet 0/1", "speed 1000", "end"]);
    },
    async () => {
      await configure("R1", ["enable", "configure terminal", "interface gigabitEthernet 0/0", "no speed", "end"]);
      await configure("S1", ["enable", "configure terminal", "interface gigabitEthernet 0/1", "no speed", "end"]);
    },
  ));
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, scenarios };
  const outputPath = resolve(root, "harness/artifacts/sim-fault-scenarios.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
