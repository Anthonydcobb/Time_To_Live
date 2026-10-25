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
  id: "ipv6-ospfv3-adjacency",
  description: "Two routers running OSPFv3 with a remote IPv6 PC",
  devices: [
    { name: "R1", type: "router", hostname: "R1", startupConfig: [
      "enable", "configure terminal", "ipv6 unicast-routing", "interface gigabitEthernet 0/1", "ipv6 address 2001:db8:12::1/64", "no shutdown", "ipv6 router ospf 1", "end", "configure terminal", "interface gigabitEthernet 0/1", "ipv6 ospf 1 area 0", "end",
    ] },
    { name: "R2", type: "router", hostname: "R2", startupConfig: [
      "enable", "configure terminal", "ipv6 unicast-routing", "interface gigabitEthernet 0/0", "ipv6 address 2001:db8:12::2/64", "no shutdown", "interface gigabitEthernet 0/1", "ipv6 address 2001:db8:20::1/64", "no shutdown", "ipv6 router ospf 1", "end", "configure terminal", "interface gigabitEthernet 0/0", "ipv6 ospf 1 area 0", "interface gigabitEthernet 0/1", "ipv6 ospf 1 area 0", "end",
    ] },
    { name: "PC2", type: "pc", ipv6: "2001:db8:20::10/64", ipv6Gateway: "2001:db8:20::1" },
  ],
  links: [
    { a: "R1 Gi0/1", b: "R2 Gi0/0" },
    { a: "R2 Gi0/1", b: "PC2 Fa0" },
  ],
};

function text(result) { return (result?.lines ?? []).join("\n"); }

try {
  await request({ op: "reset" });
  await request({ op: "load", topology });
  await request({ op: "advance", ms: 35_000 });
  const neighbor = await request({ op: "exec", device: "R1", line: "show ipv6 ospf neighbor" });
  const route = await request({ op: "exec", device: "R1", line: "show ipv6 route" });
  const ping = await request({ op: "exec", device: "R1", line: "ping ipv6 2001:db8:20::10" });
  if (!/FULL/i.test(text(neighbor))) throw new Error("OSPFv3 adjacency did not reach FULL");
  if (!/2001:0db8:0020/i.test(text(route))) throw new Error("OSPFv3 did not install the remote IPv6 route");
  if (!/Success rate is 100 percent/i.test(text(ping))) throw new Error("OSPFv3 IPv6 route did not reach PC2");
  const artifact = { capturedAt: new Date().toISOString(), backend: "sim", topology, observations: { neighbor: text(neighbor), route: text(route), ping: text(ping) } };
  const outputPath = resolve(root, "harness/artifacts/sim-ipv6-ospf.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  server.stdin.end();
  await once(server, "close");
  if (server.exitCode && stderr) process.stderr.write(stderr);
}
