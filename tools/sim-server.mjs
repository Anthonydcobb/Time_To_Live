import readline from "node:readline";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  logLevel: "error",
});

const sim = await vite.ssrLoadModule("/src/sim/index.ts");
const { Network, Router, Switch, Pc, parseIpv4, prefixToMask, resetMacAllocator } = sim;

let net = null;
let devices = new Map();
let logListeners = [];

function reset() {
  resetMacAllocator();
  net = new Network();
  devices = new Map();
  logListeners = [];
  return { now: net.clock.now, devices: [] };
}

function addDevice(spec) {
  let device;
  if (spec.type === "router") device = new Router(spec.name, spec.hostname ?? spec.name);
  else if (spec.type === "switch") device = new Switch(spec.name, spec.hostname ?? spec.name);
  else if (spec.type === "pc") device = new Pc(spec.name, spec.hostname ?? spec.name);
  else throw new Error(`Unsupported device type: ${spec.type}`);
  net.add(device);
  devices.set(spec.name, device);
  if (device.kind === "pc" && spec.ip) {
    const [ipText, prefixText] = spec.ip.split("/");
    const ip = parseIpv4(ipText);
    const prefix = Number(prefixText ?? 24);
    const mask = prefixToMask(prefix);
    const gateway = spec.gateway ? parseIpv4(spec.gateway) : null;
    if (ip === null || mask === null || (spec.gateway && gateway === null)) throw new Error(`Invalid PC address for ${spec.name}`);
    device.configure(ip, mask, gateway);
  }
  const logs = [];
  device.onOutput((text) => logs.push(text));
  logListeners.push({ name: spec.name, logs });
}

function load(topology) {
  reset();
  for (const spec of topology.devices ?? []) addDevice(spec);
  for (const link of topology.links ?? []) {
    const [aName, aPort] = link.a.split(/\s+/, 2);
    const [bName, bPort] = link.b.split(/\s+/, 2);
    net.connect(devices.get(aName).port(aPort), devices.get(bName).port(bPort), link.cable ?? "ethernet");
  }
  return snapshot();
}

function runJob(device, result, maxMs) {
  if (!result.job) return result.lines;
  const deadline = net.clock.now + maxMs;
  net.clock.runUntil(deadline, () => result.job.done);
  if (!result.job.done) throw new Error(`job exceeded ${maxMs}ms simulated time`);
  const output = result.job.output;
  return [...result.lines, ...(output ? output.split("\n").filter((line, index, lines) => !(index === lines.length - 1 && line === "")) : [])];
}

function exec(request) {
  const device = devices.get(request.device);
  if (!device) throw new Error(`No device ${request.device}`);
  const maxMs = request.maxMs ?? 600_000;
  const result = device.kind === "pc" ? device.shell.execute(request.line) : device.console.input(request.line);
  return { device: request.device, line: request.line, lines: runJob(device, result, maxMs), now: net.clock.now };
}

function help(request) {
  const device = devices.get(request.device);
  if (!device) throw new Error(`No device ${request.device}`);
  if (device.kind === "pc") throw new Error("PC devices do not expose IOS help");
  return { device: request.device, ...device.console.help(request.line ?? "") };
}

function complete(request) {
  const device = devices.get(request.device);
  if (!device) throw new Error(`No device ${request.device}`);
  if (device.kind === "pc") throw new Error("PC devices do not expose IOS completion");
  return { device: request.device, line: request.line ?? "", completion: device.console.complete(request.line ?? "") };
}

function advance(ms) {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("advance requires a non-negative number");
  net.clock.advance(ms);
  const logs = logListeners.flatMap(({ name, logs }) => logs.splice(0).map((text) => ({ device: name, text })));
  return { now: net.clock.now, logs };
}

function snapshot() {
  return {
    now: net?.clock.now ?? 0,
    devices: [...devices.values()].map((device) => ({
      id: device.id,
      kind: device.kind,
      hostname: device.hostname,
      ports: device.ports.filter((port) => port.kind === "ethernet").map((port) => ({
        name: port.name,
        peer: port.peer ? `${port.peer.device.id} ${port.peer.name}` : null,
        linkUp: port.linkUp,
        protocolUp: port.protocolUp,
      })),
      address: device.kind === "pc" ? { ip: device.ip, mask: device.mask, gateway: device.gateway } : undefined,
    })),
  };
}

async function handle(request) {
  if (request.op === "reset") return reset();
  if (request.op === "load") return load(request.topology);
  if (request.op === "exec") return exec(request);
  if (request.op === "help") return help(request);
  if (request.op === "complete") return complete(request);
  if (request.op === "advance") return advance(request.ms);
  if (request.op === "snapshot") return snapshot();
  throw new Error(`Unknown operation: ${request.op}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const result = await handle(JSON.parse(line));
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}

await vite.close();
