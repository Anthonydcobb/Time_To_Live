import { mkdir, writeFile } from "node:fs/promises";
import { health, runCommand } from "./pt-bridge-client.mjs";

const status = await health();
const device = process.env.PT_SPIKE_DEVICE ?? "Switch0";
const line = process.env.PT_SPIKE_COMMAND ?? "show spanning-tree";
const result = await runCommand({ device, line, mode: "enable" });
const artifact = { capturedAt: new Date().toISOString(), bridge: status,
  request: { device, line, mode: "enable" }, result };

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-spike-bridge.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify(artifact, null, 2));
