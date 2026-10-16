import type { IosDevice } from "../src/sim/devices/ios-device";

/** Types each line into the device console and returns everything it printed. */
export function type(device: IosDevice, ...lines: string[]): string[] {
  return lines.flatMap((l) => device.console.input(l).lines);
}

/** Collects unsolicited console messages (%LINK, %LINEPROTO, ...). */
export function captureLogs(device: IosDevice): string[] {
  const logs: string[] = [];
  device.onOutput((t) => logs.push(t));
  return logs;
}
