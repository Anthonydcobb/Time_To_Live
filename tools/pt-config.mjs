import { configureDevice } from "./pt-adapter.mjs";

export function makeConfigPlan({ device, commands, reason }) {
  return {
    planVersion: 1,
    device,
    reason,
    commands: commands.map((command, index) => ({ sequence: index + 1, ...command })),
  };
}

export async function applyConfigPlan(plan) {
  if (process.env.PT_APPLY_CONFIG !== "true") {
    throw new Error("Configuration blocked. Set PT_APPLY_CONFIG=true to apply a plan.");
  }
  return configureDevice(plan.device, plan.commands);
}
