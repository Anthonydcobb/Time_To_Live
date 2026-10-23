import { mkdir, writeFile } from "node:fs/promises";
import { health } from "./pt-bridge-client.mjs";
import { captureDeviceSnapshot, discoverDevices, discoverLinks } from "./pt-adapter.mjs";

const bridge = await health();
const discovery = await discoverDevices();
const links = await discoverLinks();
const snapshots = [];
for (const device of discovery.devices) {
  snapshots.push(await captureDeviceSnapshot(device.name));
}

const artifact = {
  capturedAt: new Date().toISOString(),
  bridge,
  discovery: discovery.response,
  devices: discovery.devices,
  links: links.links,
  snapshots,
};
await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-topology-snapshot.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  deviceCount: artifact.devices.length,
  linkCount: artifact.links.length,
  links: artifact.links,
  devices: artifact.devices,
  snapshotCount: artifact.snapshots.length,
  artifact: "harness/artifacts/pt-topology-snapshot.json",
}, null, 2));
