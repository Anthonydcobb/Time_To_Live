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
  id: "nat-static-and-pat",
  description: "Inside and outside hosts through a router with static NAT",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "interface gigabitEthernet 0/0", "ip address 10.0.0.1 255.255.255.0", "ip nat inside", "no shutdown", "interface gigabitEthernet 0/1", "ip address 203.0.113.1 255.255.255.0", "ip nat outside", "no shutdown", "ip nat inside source static 10.0.0.10 203.0.113.100", "end",
    ] },
    { name: "Inside", type: "pc", ip: "10.0.0.10/24", gateway: "10.0.0.1" },
    { name: "Outside", type: "pc", ip: "203.0.113.2/24", gateway: "203.0.113.1" },
  ],
  links: [
    { a: "Inside Fa0", b: "R1 Gi0/0" },
    { a: "Outside Fa0", b: "R1 Gi0/1" },
  ],
};

function text(result) { return (result?.lines ?? []).join("\n"); }

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const inbound = await request({ op: "exec", device: "Outside", line: "ping -n 4 203.0.113.100" });
  const outbound = await request({ op: "exec", device: "Inside", line: "ping -n 4 203.0.113.2" });
  const translations = await request({ op: "exec", device: "R1", line: "show ip nat translations" });
  const statistics = await request({ op: "exec", device: "R1", line: "show ip nat statistics" });
  if (!/Reply from 203\.0\.113\.100/i.test(text(inbound))) throw new Error("Static NAT inbound reachability failed");
  if (!/Reply from 203\.0\.113\.2/i.test(text(outbound))) throw new Error("Inside-to-outside reachability failed");
  if (!/203\.0\.113\.100/i.test(text(translations))) throw new Error("Static translation was not recorded");
  if (!/Inside interfaces: GigabitEthernet0\/0/i.test(text(statistics))) throw new Error("NAT statistics omitted inside interface");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { inbound: text(inbound), outbound: text(outbound), translations: text(translations), statistics: text(statistics) } };
  const outputPath = resolve(root, "harness/artifacts/sim-nat-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
