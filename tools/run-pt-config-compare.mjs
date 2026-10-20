import { mkdir, writeFile } from "node:fs/promises";
import { executeDeviceCommand } from "./pt-adapter.mjs";
import { makeConfigPlan, applyConfigPlan } from "./pt-config.mjs";

const device = process.env.PT_CONFIG_DEVICE ?? "Switch0";
const plan = makeConfigPlan({
  device,
  reason: "Verified Vlan1 management description",
  commands: [
    { mode: "enable", line: "configure terminal" },
    { mode: "global", line: "interface vlan 1" },
    { mode: "", line: "description TTL management interface" },
    { mode: "", line: "end" },
  ],
});

const before = await executeDeviceCommand(device, "show running-config", "enable");
const results = await applyConfigPlan(plan);
const after = await executeDeviceCommand(device, "show running-config", "enable");

const beforeLines = new Set((before.result?.output ?? "").split("\n"));
const afterLines = new Set((after.result?.output ?? "").split("\n"));
const added = [...afterLines].filter((line) => line && !beforeLines.has(line));
const removed = [...beforeLines].filter((line) => line && !afterLines.has(line));

const artifact = {
  capturedAt: new Date().toISOString(),
  device,
  plan,
  before,
  results,
  after,
  diff: { added, removed },
};

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-config-compare.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  device,
  commandStatuses: results.map(({ command, mode, result }) => ({ command, mode, status: result.result?.status })),
  added,
  removed,
  artifact: "harness/artifacts/pt-config-compare.json",
}, null, 2));
