import { mkdir, writeFile } from "node:fs/promises";
import { makeConfigPlan, applyConfigPlan } from "./pt-config.mjs";

const plan = makeConfigPlan({
  device: process.env.PT_CONFIG_DEVICE ?? "Switch0",
  reason: "Example reviewed configuration sequence; dry-run until explicitly enabled.",
  commands: [
    { mode: "enable", line: "configure terminal" },
    { mode: "global", line: "interface vlan 1" },
    { mode: "", line: "description TTL management interface" },
    { mode: "", line: "end" },
  ],
});

const artifact = {
  capturedAt: new Date().toISOString(),
  dryRun: process.env.PT_APPLY_CONFIG !== "true",
  plan,
};

if (!artifact.dryRun) {
  artifact.results = await applyConfigPlan(plan);
}

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-config-plan.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  device: plan.device,
  dryRun: artifact.dryRun,
  commandCount: plan.commands.length,
  artifact: "harness/artifacts/pt-config-plan.json",
}, null, 2));
