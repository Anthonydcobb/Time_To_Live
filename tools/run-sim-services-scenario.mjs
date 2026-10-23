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
  id: "services-and-management",
  description: "Router services and secure management configuration",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal",
      "interface gigabitEthernet 0/0", "ip address 10.0.50.1 255.255.255.0", "no shutdown",
      "ip dns server", "ip host printer.lab 10.0.50.20",
      "ntp server 192.0.2.10", "logging host 192.0.2.20", "logging trap 4",
      "snmp-server community monitor ro",
      "ip domain-name ttl.local", "crypto key generate rsa", "username admin secret cisco",
      "line vty 0 4", "login local", "transport input ssh", "end",
    ] },
    { name: "PC1", type: "pc", ip: "10.0.50.10/24", gateway: "10.0.50.1" },
  ],
  links: [{ a: "PC1 Fa0", b: "R1 Gi0/0" }],
};

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 3_000 });
  const hosts = await request({ op: "exec", device: "R1", line: "show hosts" });
  const ntp = await request({ op: "exec", device: "R1", line: "show ntp status" });
  const associations = await request({ op: "exec", device: "R1", line: "show ntp associations" });
  const logging = await request({ op: "exec", device: "R1", line: "show logging" });
  const snmp = await request({ op: "exec", device: "R1", line: "show snmp" });
  const ssh = await request({ op: "exec", device: "R1", line: "show ssh" });
  const running = await request({ op: "exec", device: "R1", line: "show running-config" });
  const ping = await request({ op: "exec", device: "PC1", line: "ping -n 2 10.0.50.1" });
  if (!/10\.0\.50\.20\s+printer\.lab/i.test(text(hosts))) throw new Error("DNS host record was not installed");
  if (!/Clock is synchronized/i.test(text(ntp))) throw new Error("NTP did not reach synchronized state");
  if (!/192\.0\.2\.10/i.test(text(associations))) throw new Error("NTP association was not recorded");
  if (!/192\.0\.2\.20/i.test(text(logging))) throw new Error("Syslog collector was not recorded");
  if (!/monitor \(ro\)/i.test(text(snmp))) throw new Error("SNMP read-only community was not recorded");
  if (!/SSH Enabled/i.test(text(ssh))) throw new Error("SSH was not enabled after key generation");
  if (!/transport input ssh/i.test(text(running)) || !/username admin secret 5/i.test(text(running))) throw new Error("Secure VTY configuration was not rendered");
  if (!/Reply from 10\.0\.50\.1/i.test(text(ping))) throw new Error("Management LAN reachability failed");
  const artifact = {
    capturedAt: new Date().toISOString(), backend: "sim", topology,
    observations: { hosts: text(hosts), ntp: text(ntp), associations: text(associations), logging: text(logging), snmp: text(snmp), ssh: text(ssh), running: text(running), ping: text(ping) },
  };
  const outputPath = resolve(root, "harness/artifacts/sim-services-scenario.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
