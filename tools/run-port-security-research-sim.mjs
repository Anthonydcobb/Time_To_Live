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
  id: "port-security-research",
  description: "Three PCs through two switches; secure S1 uplink sees multiple learned source MACs",
  devices: [
    { name: "S1", type: "switch", hostname: "S1", startupConfig: ["enable", "configure terminal", "interface fa0/1", "switchport mode trunk", "interface fa0/2", "switchport mode access", "end"] },
    { name: "S2", type: "switch", hostname: "S2", startupConfig: ["enable", "configure terminal", "interface fa0/1", "switchport mode trunk", "interface fa0/2", "switchport mode access", "interface fa0/3", "switchport mode access", "end"] },
    { name: "PC0", type: "pc", ip: "192.168.10.10/24" },
    { name: "PC1", type: "pc", ip: "192.168.10.11/24" },
    { name: "PC2", type: "pc", ip: "192.168.10.12/24" },
  ],
  links: [
    { a: "PC0 Fa0", b: "S1 Fa0/2" },
    { a: "S1 Fa0/1", b: "S2 Fa0/1" },
    { a: "PC1 Fa0", b: "S2 Fa0/2" },
    { a: "PC2 Fa0", b: "S2 Fa0/3" },
  ],
};

const stamp = () => new Date().toISOString();
function output(result) { return (result?.lines ?? []).join("\n"); }
async function record(experiment, device, input, mode = "enable") {
  const result = await request({ op: "exec", device, line: input });
  observations.push({ backend: "sim", experiment, device, input, mode, status: "ok", rawOutput: output(result), prompt: result?.prompt ?? null, capturedAt: stamp() });
  return output(result);
}
async function configure(experiment, commands) {
  for (const command of commands) await record(experiment, "S1", command);
}
async function advance(experiment, ms) {
  const result = await request({ op: "advance", ms });
  observations.push({ backend: "sim", experiment, operation: "advance", waitedMs: ms, logs: result.logs, capturedAt: stamp() });
  return result;
}
async function snapshot(experiment) {
  const result = await request({ op: "snapshot" });
  observations.push({ backend: "sim", experiment, operation: "snapshot", rawOutput: JSON.stringify(result.devices.find((device) => device.id === "S1")?.config?.interfaces?.["FastEthernet0/1"] ?? null, null, 2), capturedAt: stamp() });
}
async function state(experiment) {
  for (const command of ["show port-security interface fa0/1", "show running-config", "show interfaces status", "show mac address-table"]) await record(experiment, "S1", command);
  await snapshot(experiment);
}

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await advance("stp-convergence", 35_000);
  for (const [pc, target] of [["PC0", "192.168.10.11"], ["PC0", "192.168.10.12"]]) await record("baseline-connectivity", pc, `ping -n 2 ${target}`, "pc-shell");
  await state("baseline");

  await configure("sticky-and-maximum", ["enable", "configure terminal", "interface fa0/1", "switchport port-security", "switchport port-security maximum 4", "switchport port-security mac-address sticky", "end"]);
  await record("sticky-and-maximum", "PC0", "ping -n 2 192.168.10.11", "pc-shell");
  await record("sticky-and-maximum", "PC0", "ping -n 2 192.168.10.12", "pc-shell");
  await state("sticky-and-maximum");

  for (const mode of ["protect", "restrict", "shutdown"]) {
    await configure(`violation-${mode}`, ["enable", "configure terminal", "interface fa0/1", "no switchport port-security", "switchport mode trunk", "switchport port-security", "switchport port-security maximum 1", `switchport port-security violation ${mode}`, "switchport port-security mac-address sticky", "end"]);
    await record(`violation-${mode}-learn-first`, "PC0", "ping -n 2 192.168.10.11", "pc-shell");
    const unauthorized = await record(`violation-${mode}-second-mac`, "PC0", "ping -n 2 192.168.10.12", "pc-shell");
    await advance(`violation-${mode}-logs`, 0);
    await state(`violation-${mode}`);
    observations.push({ backend: "sim", experiment: `violation-${mode}`, device: "PC0", input: "ping -n 2 192.168.10.12", rawOutput: unauthorized, capturedAt: stamp() });
    if (mode === "shutdown") {
      await record("errdisable-recovery-probe", "S1", "show errdisable recovery");
      await configure("errdisable-recovery-probe", ["enable", "configure terminal", "errdisable recovery cause psecure-violation", "errdisable recovery interval 30", "end"]);
      await advance("errdisable-recovery-wait", 35_000);
      await state("errdisable-recovery-wait");
      await configure("shutdown-reenable", ["enable", "configure terminal", "interface fa0/1", "no shutdown", "no switchport port-security", "switchport mode trunk", "end"]);
    }
  }

  const artifact = { capturedAt: stamp(), backend: "sim", topology, observations, harnessNote: "The simulator network was isolated in sim-server and discarded on exit." };
  const outputPath = resolve(root, "harness/artifacts/port-security-research-sim.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/port-security-research-sim.json" }));
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
