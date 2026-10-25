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
let stderr = "";
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
  id: "sim-stp-link-failure",
  description: "Three-switch triangle with an intentional root-link failure",
  devices: [
    { name: "S1", type: "switch", hostname: "S1", startupConfig: [
      "enable", "configure terminal", "spanning-tree vlan 1 priority 24576",
      "interface gigabitEthernet 0/1", "switchport mode trunk", "interface gigabitEthernet 0/2", "switchport mode trunk", "end",
    ] },
    { name: "S2", type: "switch", hostname: "S2", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/1", "switchport mode trunk", "interface gigabitEthernet 0/2", "switchport mode trunk", "end",
    ] },
    { name: "S3", type: "switch", hostname: "S3", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/1", "switchport mode trunk", "interface gigabitEthernet 0/2", "switchport mode trunk", "end",
    ] },
  ],
  links: [
    { a: "S1 Gi0/1", b: "S2 Gi0/1" },
    { a: "S2 Gi0/2", b: "S3 Gi0/1" },
    { a: "S3 Gi0/2", b: "S1 Gi0/2" },
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

async function observe(label) {
  const outputs = {};
  for (const device of ["S1", "S2", "S3"]) {
    outputs[device] = text(await exec(device, "show spanning-tree", "enable"));
  }
  const all = Object.values(outputs).join("\n");
  return {
    label,
    rootPriority: /Root ID\s+Priority\s+(\d+)/i.exec(outputs.S1)?.[1] ?? null,
    forwardingPorts: (all.match(/\bFWD\b/g) ?? []).length,
    blockingPorts: (all.match(/\bBLK\b|\bAltn\b|\bAlternate\b/gi) ?? []).length,
    converged: /Spanning tree enabled/i.test(all) && /\bFWD\b/i.test(all),
    raw: outputs,
  };
}

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await advance(35_000);
  const before = await observe("before link failure");

  await configure("S1", ["enable", "configure terminal", "interface gigabitEthernet 0/1", "shutdown", "end"]);
  await advance(35_000);
  const during = await observe("during root-link failure");

  await configure("S1", ["enable", "configure terminal", "interface gigabitEthernet 0/1", "no shutdown", "end"]);
  await advance(35_000);
  const after = await observe("after link restoration");

  const artifact = {
    capturedAt: new Date().toISOString(),
    backend: "sim",
    topology,
    scenario: {
      id: "stp-root-link-failure",
      description: "Shut the root switch's S1 Gi0/1 link, observe reconvergence, then restore it.",
      before,
      during,
      after,
    },
  };
  const outputPath = resolve(root, "harness/artifacts/sim-stp-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
