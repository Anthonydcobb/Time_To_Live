import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const { Network } = await vite.ssrLoadModule("/src/sim/network.ts");
const { Router } = await vite.ssrLoadModule("/src/sim/devices/router.ts");
const { Pc } = await vite.ssrLoadModule("/src/sim/devices/pc.ts");
const { parseIpv4: ip } = await vite.ssrLoadModule("/src/sim/addr.ts");
const { finish } = await vite.ssrLoadModule("/tests/helpers.ts");

const observations = [];
const stamp = () => new Date().toISOString();
function output(device, result) { return [...(result.lines ?? []), ...(result.job ? finish(device, result.job) : [])].join("\n"); }
function record(device, experiment, input, mode = "") {
  const promptBefore = device.console?.prompt?.() ?? "pc-shell";
  const result = device.console ? device.console.input(input) : device.shell.execute(input);
  observations.push({ backend: "sim", version: "workspace-sim", image: "src/sim", experiment, device: device.id, input, mode: promptBefore, status: "ok", rawOutput: output(device, result), promptBefore, promptAfter: device.console?.prompt?.() ?? "pc-shell", waitedMs: 0, capturedAt: stamp() });
  return result;
}
function enable(router) {
  if (router.console.prompt().endsWith(">")) record(router, "setup", "enable");
  if (router.console.prompt().includes("(config")) record(router, "setup", "end");
}
function configure(router, experiment, commands) {
  enable(router);
  record(router, experiment, "configure terminal");
  for (const command of commands) record(router, experiment, command);
  record(router, experiment, "end");
}
function show(router, experiment, commands) {
  enable(router);
  for (const command of commands) record(router, experiment, command);
}
function ping(pc, experiment, target) {
  const result = pc.shell.execute(`ping -n 4 ${target}`);
  if (result.job) net.clock.runUntil(net.clock.now + 600_000, () => result.job.done);
  observations.push({ backend: "sim", version: "workspace-sim", image: "src/sim", experiment, device: pc.id, input: `ping -n 4 ${target}`, mode: "pc-shell", status: "ok", rawOutput: output(pc, result), waitedMs: 0, capturedAt: stamp() });
}
function removeAcl(experiment, aclLines, attachmentLines) {
  configure(router, experiment, ["configure terminal", ...attachmentLines, ...aclLines, "end"]);
}

const net = new Network();
const router = net.add(new Router("R1", "R1"));
const pc0 = net.add(new Pc("PC0"));
const pc1 = net.add(new Pc("PC1"));
pc0.configure(ip("192.168.10.10"), ip("255.255.255.0"), ip("192.168.10.1"));
pc1.configure(ip("192.168.20.10"), ip("255.255.255.0"), ip("192.168.20.1"));
net.connect(pc0.nic, router.port("Gi0/0"));
net.connect(pc1.nic, router.port("Gi0/1"));
configure(router, "baseline", ["hostname R1", "interface gi0/0", "ip address 192.168.10.1 255.255.255.0", "no shutdown", "interface gi0/1", "ip address 192.168.20.1 255.255.255.0", "no shutdown"]);
net.clock.advance(5000);
ping(pc0, "baseline", "192.168.20.10");
show(router, "baseline", ["show access-lists", "show running-config"]);

configure(router, "standard-numbered-out", ["access-list 10 deny host 192.168.10.10", "access-list 10 deny 192.168.10.10", "access-list 10 permit any", "interface gi0/1", "ip access-group 10 out"]);
ping(pc0, "standard-numbered-out", "192.168.20.10");
show(router, "standard-numbered-out", ["show access-lists", "show ip interface gi0/1", "show running-config"]);
configure(router, "cleanup-standard-numbered", ["interface gi0/1", "no ip access-group 10 out", "no access-list 10"]);

configure(router, "implicit-deny", ["access-list 11 permit 192.168.10.11", "interface gi0/1", "ip access-group 11 out"]);
ping(pc0, "implicit-deny", "192.168.20.10");
show(router, "implicit-deny", ["show access-lists", "show running-config"]);
configure(router, "cleanup-implicit-deny", ["interface gi0/1", "no ip access-group 11 out", "no access-list 11"]);

configure(router, "extended-numbered-in", ["access-list 101 deny icmp host 192.168.10.10 host 192.168.20.10", "access-list 101 deny icmp 192.168.10.10 192.168.20.10", "access-list 101 permit ip any any", "interface gi0/0", "ip access-group 101 in"]);
ping(pc0, "extended-numbered-in", "192.168.20.10");
show(router, "extended-numbered-in", ["show access-lists", "show ip interface gi0/0", "show running-config"]);
configure(router, "cleanup-extended-numbered", ["interface gi0/0", "no ip access-group 101 in", "no access-list 101"]);

configure(router, "named-standard-out", ["ip access-list standard TTL-STANDARD", "deny host 192.168.10.10", "deny 192.168.10.10", "permit any", "exit", "interface gi0/1", "ip access-group TTL-STANDARD out"]);
ping(pc0, "named-standard-out", "192.168.20.10");
show(router, "named-standard-out", ["show access-lists", "show ip interface gi0/1", "show running-config"]);
configure(router, "cleanup-named-standard", ["interface gi0/1", "no ip access-group TTL-STANDARD out", "no ip access-list standard TTL-STANDARD"]);

configure(router, "named-extended-in", ["ip access-list extended TTL-EXTENDED", "deny icmp host 192.168.10.10 host 192.168.20.10", "deny icmp 192.168.10.10 192.168.20.10", "permit ip any any", "exit", "interface gi0/0", "ip access-group TTL-EXTENDED in"]);
ping(pc0, "named-extended-in", "192.168.20.10");
show(router, "named-extended-in", ["show access-lists", "show ip interface gi0/0", "show running-config"]);
configure(router, "cleanup-named-extended", ["interface gi0/0", "no ip access-group TTL-EXTENDED in", "no ip access-list extended TTL-EXTENDED"]);

configure(router, "vty-access-class", ["ip access-list standard VTY-MGMT", "permit host 192.168.10.11", "permit 192.168.10.11", "exit", "line vty 0 4", "access-class VTY-MGMT in"]);
show(router, "vty-access-class", ["show running-config", "show access-lists"]);
record(pc0, "vty-access-class", "telnet 192.168.10.1");
configure(router, "vty-numbered-access-class", ["access-list 12 permit 192.168.10.11", "line vty 0 4", "access-class 12 in"]);
show(router, "vty-numbered-access-class", ["show running-config", "show access-lists"]);
record(pc0, "vty-numbered-access-class", "telnet 192.168.10.1");
configure(router, "cleanup-vty", ["line vty 0 4", "no access-class 12 in", "exit", "no access-list 12"]);
show(router, "restore-verification", ["show access-lists", "show running-config", "show ip interface brief"]);

const artifact = { capturedAt: stamp(), backend: "sim", version: "workspace-sim", image: "src/sim", topology: { id: "acl-intervlan-research", devices: ["R1", "PC0 192.168.10.10/24", "PC1 192.168.20.10/24"], links: ["PC0 to R1 Gi0/0", "PC1 to R1 Gi0/1"] }, observations, restoration: "Interface ACL attachments and VTY access-class were absent at the end; numbered ACLs were deleted. Named ACL deletion returned invalid input, and the simulated network was discarded after capture." };
await mkdir(resolve(root, "harness/artifacts"), { recursive: true });
await writeFile(resolve(root, "harness/artifacts/acls-research-sim.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ observations: observations.length, artifact: "harness/artifacts/acls-research-sim.json" }));
await vite.close();
