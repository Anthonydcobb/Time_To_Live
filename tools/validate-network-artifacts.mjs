import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expected = [
  "sim-spike.json",
  "sim-fault-scenarios.json",
  "sim-stp-scenario.json",
  "sim-ipv6-scenario.json",
  "sim-ipv6-ospf.json",
  "sim-dhcp-scenario.json",
  "sim-nat-scenario.json",
  "sim-acl-scenario.json",
  "sim-routing-scenario.json",
  "sim-services-scenario.json",
  "sim-access-security-scenario.json",
];

const checks = [];
for (const name of expected) {
  const path = resolve(root, "harness", "artifacts", name);
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    const validEnvelope = Boolean(value && typeof value === "object" && (value.capturedAt || value.runId) && value.backend === "sim");
    const validPayload = name === "sim-routing-scenario.json"
      ? Boolean(value.scenarios?.eigrp?.neighbors && value.scenarios?.hsrp?.activeAfter)
      : Object.keys(value).some((key) => key !== "capturedAt" && key !== "backend");
    checks.push({ artifact: name, ok: validEnvelope && validPayload, bytes: (await readFile(path)).byteLength });
  } catch (error) {
    checks.push({ artifact: name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const ok = checks.every((check) => check.ok);
const result = { ok, artifactCount: checks.length, checks };
console.log(JSON.stringify(result, null, 2));
if (!ok) process.exitCode = 1;
