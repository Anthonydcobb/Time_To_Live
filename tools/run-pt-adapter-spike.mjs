import { mkdir, writeFile } from "node:fs/promises";
import { health } from "./pt-bridge-client.mjs";
import { captureDeviceSnapshot } from "./pt-adapter.mjs";

const device = process.env.PT_ADAPTER_DEVICE ?? "Switch0";
const bridge = await health();
const snapshot = await captureDeviceSnapshot(device);
const artifact = {
  capturedAt: new Date().toISOString(),
  bridge,
  snapshot,
};

await mkdir("harness/artifacts", { recursive: true });
await writeFile(
  "harness/artifacts/pt-adapter-snapshot.json",
  `${JSON.stringify(artifact, null, 2)}\n`,
);

console.log(JSON.stringify({
  device,
  commandCount: snapshot.commands.length,
  statuses: snapshot.commands.map(({ command, result }) => ({
    command,
    status: result.result?.status,
  })),
  artifact: "harness/artifacts/pt-adapter-snapshot.json",
}, null, 2));
