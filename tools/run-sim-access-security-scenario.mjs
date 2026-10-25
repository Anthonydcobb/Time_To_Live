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

function text(result) { return (result?.lines ?? []).join("\n"); }

const topology = {
  id: "access-layer-security",
  description: "Secure access port with DHCP snooping and Dynamic ARP Inspection",
  devices: [
    { name: "S1", type: "switch", hostname: "S1", startupConfig: [
      "enable", "configure terminal", "ip dhcp snooping", "ip dhcp snooping vlan 1", "ip arp inspection vlan 1",
      "interface fa0/1", "switchport mode access", "switchport port-security", "switchport port-security maximum 1", "switchport port-security mac-address sticky", "ip dhcp snooping limit rate 10", "end",
    ] },
    { name: "PC1", type: "pc", ip: "10.0.60.10/24", gateway: "10.0.60.1" },
  ],
  links: [{ a: "PC1 Fa0", b: "S1 Fa0/1" }],
};

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const switchport = await request({ op: "exec", device: "S1", line: "show interfaces fa0/1 switchport" });
  const security = await request({ op: "exec", device: "S1", line: "show port-security interface fa0/1" });
  const snooping = await request({ op: "exec", device: "S1", line: "show ip dhcp snooping" });
  const snoopingStats = await request({ op: "exec", device: "S1", line: "show ip dhcp snooping statistics" });
  const inspection = await request({ op: "exec", device: "S1", line: "show ip arp inspection" });
  const inspectionStats = await request({ op: "exec", device: "S1", line: "show ip arp inspection statistics" });
  const running = await request({ op: "exec", device: "S1", line: "show running-config" });
  if (!/Port Security: Enabled/i.test(text(switchport))) throw new Error("Port security was not enabled on the access port");
  if (!/Fa0\/1\s+1\s+0/i.test(text(security))) throw new Error("Port-security maximum was not recorded");
  if (!/DHCP snooping is active/i.test(text(snooping))) throw new Error("DHCP snooping did not enable");
  if (!/Inspection VLANs: 1/i.test(text(inspection))) throw new Error("Dynamic ARP Inspection did not enable");
  if (!/ip dhcp snooping/i.test(text(running)) || !/ip arp inspection vlan 1/i.test(text(running))) throw new Error("Security configuration was not rendered");
  const artifact = {
    capturedAt: new Date().toISOString(), backend: "sim", topology,
    observations: { switchport: text(switchport), security: text(security), snooping: text(snooping), snoopingStats: text(snoopingStats), inspection: text(inspection), inspectionStats: text(inspectionStats), running: text(running) },
  };
  const outputPath = resolve(root, "harness/artifacts/sim-access-security-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
