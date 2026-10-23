import { health } from "./pt-bridge-client.mjs";
import { captureDeviceSnapshot, discoverDevices, discoverLinks } from "./pt-adapter.mjs";

function commandResult(snapshot, command) {
  return snapshot.commands.find((entry) => entry.command === command)?.result?.result;
}

function parseInterfaces(output = "") {
  return output.split("\n")
    .map((line) => line.trim().match(/^(\S+)\s+(\S+)\s+\S+\s+(\S+)\s+(administratively down|up|down)\s+(up|down)\s*$/i))
    .filter(Boolean)
    .map((match) => ({ name: match[1], ipAddress: match[2], method: match[3], status: match[4], protocol: match[5] }));
}

function parseVlans(output = "") {
  return output.split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\S[^\s]*)\s+(active|suspended|act\/unsup)\s*(.*)$/i))
    .filter(Boolean)
    .map((match) => ({ id: Number(match[1]), name: match[2], status: match[3], ports: match[4].trim() }));
}

function parseCdpNeighbors(output = "") {
  return output.split("\n")
    .map((line) => line.match(/^(.+?)\s{2,}(?:Fas|Gig|Eth|Ser)\s+(\S+)\s+(\d+)\s+([A-Za-z]+)\s+(\S+)\s+(?:Fas|Gig|Eth|Ser)\s+(\S+)$/))
    .filter(Boolean)
    .map((match) => ({
      deviceId: match[1].trim(),
      localInterface: match[2],
      holdTime: Number(match[3]),
      capability: match[4],
      platform: match[5],
      remoteInterface: match[6],
    }));
}

export async function captureNormalizedTopology() {
  const bridge = await health();
  const discovered = await discoverDevices();
  const discoveredLinks = await discoverLinks();
  const devices = [];

  for (const identity of discovered.devices) {
    const snapshot = await captureDeviceSnapshot(identity.name);
    const version = commandResult(snapshot, "show version");
    const interfaces = commandResult(snapshot, "show ip interface brief");
    const vlans = commandResult(snapshot, "show vlan brief");
    const spanningTree = commandResult(snapshot, "show spanning-tree");
    const cdp = commandResult(snapshot, "show cdp neighbors");
    devices.push({
      ...identity,
      cliCapable: version?.status === "STATUS_OK",
      interfaceSummary: parseInterfaces(interfaces?.output),
      vlanSummary: parseVlans(vlans?.output),
      spanningTree: spanningTree?.status === "STATUS_OK" ? { status: spanningTree.status, raw: spanningTree.output } : null,
      cdpNeighbors: parseCdpNeighbors(cdp?.output),
      raw: snapshot.commands,
    });
  }

  const edges = [];
  const seen = new Set();
  for (const device of devices) {
    for (const neighbor of device.cdpNeighbors) {
      const key = [device.name, neighbor.localInterface, neighbor.deviceId, neighbor.remoteInterface].join("|");
      const reverse = [neighbor.deviceId, neighbor.remoteInterface, device.name, neighbor.localInterface].join("|");
      if (seen.has(key) || seen.has(reverse)) continue;
      seen.add(key);
      edges.push({
        source: { device: device.name, interface: neighbor.localInterface },
        target: { deviceId: neighbor.deviceId, interface: neighbor.remoteInterface },
        capability: neighbor.capability,
        platform: neighbor.platform,
      });
    }
  }

  return { capturedAt: new Date().toISOString(), bridge, links: discoveredLinks.links, devices, edges };
}
