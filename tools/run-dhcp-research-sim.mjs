import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const child = spawn(process.execPath, [resolve(root, "tools/sim-server.mjs")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
const pending = [];
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const cut = buffer.indexOf("\n");
    if (cut < 0) break;
    const line = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 1);
    pending.shift()?.(JSON.parse(line));
  }
});

function request(payload) {
  return new Promise((resolveRequest, reject) => {
    pending.push((response) => response.ok ? resolveRequest(response.result) : reject(new Error(response.error)));
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

const text = (result) => (result?.lines ?? []).join("\n");
const observations = [];
async function record(experiment, backend, device, line, op = "exec") {
  const result = await request(op === "help" ? { op, device, line } : { op, device, line });
  observations.push({ backend, experiment, device, input: line, status: "ok", rawOutput: text(result), result });
  return result;
}
async function load(experiment, topology, settle = 35_000) {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  if (settle) await request({ op: "advance", ms: settle });
  observations.push({ backend: "sim", experiment, device: "__network__", input: `advance ${settle}`, status: "ok", rawOutput: "", result: { now: settle } });
}
const base = (id, host = id) => ({ name: id, type: "router", hostname: host });
const pc = (name) => ({ name, type: "pc" });
const sw = (name) => ({ name, type: "switch", hostname: name });

try {
  const basic = { id: "dhcp-basic", devices: [
    { ...base("R1"), startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 192.168.30.1 255.255.255.0", "no shutdown",
      "ip dhcp excluded-address 192.168.30.1 192.168.30.20", "ip dhcp pool USERS", "network 192.168.30.0 255.255.255.0",
      "default-router 192.168.30.1", "dns-server 192.168.30.53", "lease 0 1", "end",
    ] }, sw("S1"), pc("PC1")], links: [{ a: "R1 Gi0/0", b: "S1 Gi0/1" }, { a: "PC1 Fa0", b: "S1 Fa0/1" }] };
  await load("basic-pool-and-client", basic);
  await record("basic-pool-and-client", "sim", "PC1", "ipconfig /dhcp");
  await record("basic-pool-and-client", "sim", "PC1", "ipconfig /renew");
  await record("basic-pool-and-client", "sim", "PC1", "ipconfig /release");
  await record("basic-pool-and-client", "sim", "PC1", "ipconfig /all");
  for (const line of ["show ip dhcp binding", "show ip dhcp pool", "show ip dhcp conflict", "show ip dhcp server statistics", "show running-config | section dhcp"]) await record("basic-pool-and-client", "sim", "R1", line);
  await record("basic-pool-and-client", "sim", "R1", "clear ip dhcp binding *");
  await record("basic-pool-and-client", "sim", "R1", "clear ip dhcp binding 192.168.30.21");
  await record("basic-pool-and-client", "sim", "R1", "configure terminal");
  await record("basic-pool-and-client", "sim", "R1", "ip dhcp ?", "help");
  await record("basic-pool-and-client", "sim", "R1", "ip dhcp", "complete");
  await record("basic-pool-and-client", "sim", "R1", "end");

  const relay = { id: "dhcp-relay", devices: [
    { ...base("RELAY"), startupConfig: ["enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.10.0.1 255.255.255.0", "ip helper-address 10.20.0.1", "no shutdown", "interface gigabitEthernet 0/1", "ip address 10.0.0.1 255.255.255.0", "no shutdown", "ip route 10.20.0.0 255.255.255.0 10.0.0.2", "end"] },
    { ...base("SERVER"), startupConfig: ["enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.0.2 255.255.255.0", "no shutdown", "interface gigabitEthernet 0/1", "ip address 10.20.0.1 255.255.255.0", "no shutdown", "ip route 10.10.0.0 255.255.255.0 10.0.0.1", "ip dhcp pool USERS", "network 10.10.0.0 255.255.255.0", "default-router 10.10.0.1", "end"] }, pc("CLIENT")], links: [{ a: "CLIENT Fa0", b: "RELAY Gi0/0" }, { a: "RELAY Gi0/1", b: "SERVER Gi0/0" }] };
  await load("relay", relay, 3_000);
  await record("relay", "sim", "CLIENT", "ipconfig /dhcp");
  await record("relay", "sim", "CLIENT", "ipconfig /renew");
  await request({ op: "advance", ms: 15_000 });
  await record("relay", "sim", "CLIENT", "ipconfig /all");
  await record("relay", "sim", "RELAY", "show running-config | section dhcp");

  const exhaustion = { id: "dhcp-exhaustion", devices: [
    { ...base("R1"), startupConfig: ["enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.50.0.1 255.255.255.0", "no shutdown", "ip dhcp excluded-address 10.50.0.1 10.50.0.253", "no ip dhcp excluded-address 10.50.0.3 10.50.0.253", "ip dhcp pool TINY", "network 10.50.0.0 255.255.255.0", "default-router 10.50.0.1", "end"] }, sw("S1"), pc("PC1"), pc("PC2")], links: [{ a: "R1 Gi0/0", b: "S1 Gi0/1" }, { a: "PC1 Fa0", b: "S1 Fa0/1" }, { a: "PC2 Fa0", b: "S1 Fa0/2" }] };
  await load("exhaustion-and-exclusion", exhaustion);
  await record("exhaustion-and-exclusion", "sim", "PC1", "ipconfig /dhcp");
  await record("exhaustion-and-exclusion", "sim", "PC2", "ipconfig /dhcp");
  await record("exhaustion-and-exclusion", "sim", "PC1", "ipconfig /renew");
  await record("exhaustion-and-exclusion", "sim", "PC2", "ipconfig /renew");
  await record("exhaustion-and-exclusion", "sim", "R1", "show ip dhcp binding");
  await record("exhaustion-and-exclusion", "sim", "R1", "show ip dhcp pool");

  const wrongGateway = { id: "dhcp-wrong-gateway", devices: [{ ...base("R1"), startupConfig: ["enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.60.0.1 255.255.255.0", "no shutdown", "ip dhcp pool WRONG", "network 10.60.0.0 255.255.255.0", "default-router 10.60.0.254", "end"] }, sw("S1"), pc("PC1")], links: [{ a: "R1 Gi0/0", b: "S1 Gi0/1" }, { a: "PC1 Fa0", b: "S1 Fa0/1" }] };
  await load("wrong-default-router", wrongGateway);
  await record("wrong-default-router", "sim", "PC1", "ipconfig /dhcp");
  await record("wrong-default-router", "sim", "PC1", "ipconfig /renew");
  await record("wrong-default-router", "sim", "PC1", "ipconfig /all");

  const noServer = { id: "dhcp-apipa", devices: [sw("S1"), pc("PC1")], links: [{ a: "PC1 Fa0", b: "S1 Fa0/1" }] };
  await load("no-server-apipa", noServer, 35_000);
  await record("no-server-apipa", "sim", "PC1", "ipconfig /dhcp");
  await record("no-server-apipa", "sim", "PC1", "ipconfig /renew");
  await record("no-server-apipa", "sim", "PC1", "ipconfig /all");

  const snooping = { id: "dhcp-snooping", devices: [
    { ...base("R1"), startupConfig: ["enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.70.0.1 255.255.255.0", "no shutdown", "ip dhcp pool USERS", "network 10.70.0.0 255.255.255.0", "default-router 10.70.0.1", "end"] }, sw("S1"), pc("PC1")], links: [{ a: "R1 Gi0/0", b: "S1 Gi0/1" }, { a: "PC1 Fa0", b: "S1 Fa0/1" }] };
  await load("snooping-trust", snooping);
  for (const line of ["enable", "configure terminal", "ip dhcp snooping", "ip dhcp snooping vlan 1", "interface gigabitEthernet 0/1", "ip dhcp snooping trust", "end"]) await record("snooping-trust", "sim", "S1", line);
  await record("snooping-trust", "sim", "PC1", "ipconfig /dhcp");
  await record("snooping-trust", "sim", "PC1", "ipconfig /renew");
  for (const line of ["show ip dhcp snooping", "show ip dhcp snooping binding", "show ip dhcp snooping statistics"]) await record("snooping-trust", "sim", "S1", line);

  const outputPath = resolve(root, "harness/artifacts/dhcp-research-sim.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), backend: "sim", version: "workspace-sim", image: "src/sim", observations }, null, 2)}\n`);
  console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/dhcp-research-sim.json" }, null, 2));
} finally {
  child.stdin.end();
  await once(child, "close");
}
