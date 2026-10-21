import { parseIpv4, prefixToMask } from "./addr";
import { Network, type Device } from "./network";
import { Router } from "./devices/router";
import { Switch } from "./devices/switch";
import { Pc } from "./devices/pc";
import { resetMacAllocator } from "./addr";

export type TopologyDeviceSpec = {
  name: string;
  type: "router" | "switch" | "pc";
  hostname?: string;
  startupConfig?: string[];
  ip?: string;
  gateway?: string | null;
};

export type TopologyLinkSpec = {
  a: string;
  b: string;
  cable?: "ethernet" | "console";
};

export type TopologySpec = {
  id?: string;
  description?: string;
  devices: TopologyDeviceSpec[];
  links: TopologyLinkSpec[];
};

export type LoadedTopology = {
  network: Network;
  devices: Map<string, Device>;
};

function createDevice(spec: TopologyDeviceSpec): Router | Switch | Pc {
  if (spec.type === "router") return new Router(spec.name, spec.hostname ?? spec.name);
  if (spec.type === "switch") return new Switch(spec.name, spec.hostname ?? spec.name);
  if (spec.type === "pc") return new Pc(spec.name, spec.hostname ?? spec.name);
  throw new Error(`Unsupported device type: ${String(spec.type)}`);
}

function configurePc(device: Pc, spec: TopologyDeviceSpec): void {
  if (!spec.ip) return;
  const [ipText, prefixText] = spec.ip.split("/");
  const ip = parseIpv4(ipText);
  const prefix = Number(prefixText ?? 24);
  const mask = prefixToMask(prefix);
  const gateway = spec.gateway ? parseIpv4(spec.gateway) : null;
  if (ip === null || mask === null || (spec.gateway && gateway === null)) throw new Error(`Invalid PC address for ${spec.name}`);
  device.configure(ip, mask, gateway);
}

function applyStartupConfig(device: Router | Switch, lines: string[]): void {
  device.console.input("");
  for (const line of lines) {
    const result = device.console.input(line);
    if (result.lines?.some((text) => /% (Invalid|Incomplete|Ambiguous)/i.test(text))) {
      throw new Error(`Startup configuration failed on ${device.id}: ${line}`);
    }
  }
}

function endpoint(value: string): { device: string; port: string } {
  const [device, port] = value.trim().split(/\s+/, 2);
  if (!device || !port) throw new Error(`Invalid topology link endpoint: ${value}`);
  return { device, port };
}

/** Build a deterministic simulator network from the harness JSON shape. */
export function loadTopology(spec: TopologySpec): LoadedTopology {
  resetMacAllocator();
  const network = new Network();
  const devices = new Map<string, Device>();
  for (const deviceSpec of spec.devices ?? []) {
    if (devices.has(deviceSpec.name)) throw new Error(`Duplicate device: ${deviceSpec.name}`);
    const device = createDevice(deviceSpec);
    network.add(device);
    devices.set(deviceSpec.name, device);
    if (device.kind === "pc") configurePc(device, deviceSpec);
    else if (deviceSpec.startupConfig) applyStartupConfig(device, deviceSpec.startupConfig);
  }
  for (const link of spec.links ?? []) {
    const a = endpoint(link.a);
    const b = endpoint(link.b);
    const aDevice = devices.get(a.device);
    const bDevice = devices.get(b.device);
    if (!aDevice || !bDevice) throw new Error(`Topology link references an unknown device: ${link.a} / ${link.b}`);
    network.connect(aDevice.port(a.port), bDevice.port(b.port), link.cable ?? "ethernet");
  }
  return { network, devices };
}
