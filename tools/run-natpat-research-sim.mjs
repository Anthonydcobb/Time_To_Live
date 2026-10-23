import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = spawn(process.execPath, [resolve(root, "tools/sim-server.mjs")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
let stderr = "";
const pending = [];
const observations = [];
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
  id: "natpat-research",
  description: "Two inside hosts and one outside host for static NAT, pool translation, and PAT",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 192.168.10.1 255.255.255.0", "ip nat inside", "no shutdown", "interface gigabitEthernet 0/1", "ip address 192.168.20.1 255.255.255.0", "ip nat outside", "no shutdown", "end",
    ] },
    { name: "InsideSwitch", type: "switch" },
    { name: "PC0", type: "pc", ip: "192.168.10.10/24", gateway: "192.168.10.1" },
    { name: "PC2", type: "pc", ip: "192.168.10.11/24", gateway: "192.168.10.1" },
    { name: "PC1", type: "pc", ip: "192.168.20.10/24", gateway: "192.168.20.1" },
  ],
  links: [
    { a: "PC0 Fa0", b: "InsideSwitch Fa0/1" },
    { a: "PC2 Fa0", b: "InsideSwitch Fa0/2" },
    { a: "InsideSwitch Fa0/24", b: "R1 Gi0/0" },
    { a: "PC1 Fa0", b: "R1 Gi0/1" },
  ],
};

const stamp = () => new Date().toISOString();
function output(result) { return (result?.lines ?? []).join("\n"); }
async function record(experiment, device, input, mode = "enable") {
  const result = await request({ op: "exec", device, line: input });
  observations.push({ backend: "sim", experiment, device, input, mode, status: "ok", rawOutput: output(result), prompt: result?.prompt ?? null, capturedAt: stamp() });
  return output(result);
}
async function config(experiment, commands) {
  for (const command of commands) await record(experiment, "R1", command);
}
async function capture(experiment) {
  for (const command of ["show running-config", "show ip nat translations", "show ip nat statistics", "show ip interface gigabitEthernet 0/0", "show ip interface gigabitEthernet 0/1"]) await record(experiment, "R1", command);
}

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  await capture("baseline");
  for (const pc of ["PC0", "PC2"]) await record("baseline-connectivity", pc, "ping -n 4 192.168.20.10", "pc-shell");

  await config("static-nat", ["enable", "configure terminal", "ip nat inside source static 192.168.10.10 192.168.20.100", "end"]);
  await record("static-nat", "PC1", "ping -n 4 192.168.20.100", "pc-shell");
  await capture("static-nat");
  await record("clear-dynamic-with-static-present", "R1", "clear ip nat translation *");
  await record("static-after-clear", "R1", "show ip nat translations");
  await record("static-after-clear", "R1", "show ip nat statistics");

  await config("dynamic-pool", ["enable", "configure terminal", "access-list 1 permit 192.168.10.0 0.0.0.255", "ip nat pool TTL-POOL 192.168.20.101 192.168.20.102 netmask 255.255.255.0", "ip nat inside source list 1 pool TTL-POOL", "end"]);
  await record("dynamic-pool", "PC0", "ping -n 4 192.168.20.10", "pc-shell");
  await record("dynamic-pool", "PC2", "ping -n 4 192.168.20.10", "pc-shell");
  await capture("dynamic-pool");

  await config("pat-overload", ["enable", "configure terminal", "no ip nat inside source list 1 pool TTL-POOL", "no ip nat pool TTL-POOL", "no ip nat inside source static 192.168.10.10 192.168.20.100", "end"]);
  await record("pat-preclear", "R1", "clear ip nat translation *");
  await config("pat-overload", ["enable", "configure terminal", "ip nat inside source list 1 interface gigabitEthernet 0/1 overload", "end"]);
  await record("pat-overload", "PC0", "ping -n 4 192.168.20.10", "pc-shell");
  await record("pat-overload", "PC2", "ping -n 4 192.168.20.10", "pc-shell");
  await capture("pat-overload");
  await record("clear-dynamic-translations", "R1", "clear ip nat translation *");
  await capture("after-clear");

  const artifact = { capturedAt: stamp(), backend: "sim", topology, observations, cmlAvailability: "vmrun was not available in PATH, so a CML VM could not be checked or used.", harnessNote: "The simulator network was loaded in an isolated sim-server process and discarded on exit." };
  const outputPath = resolve(root, "harness/artifacts/natpat-research-sim.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/natpat-research-sim.json" }));
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
