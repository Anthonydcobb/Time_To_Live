import type { IosDevice } from "../src/sim/devices/ios-device";
import type { Pc } from "../src/sim/devices/pc";
import type { Job } from "../src/sim/job";
import type { Device } from "../src/sim/network";

/** Advances simulated time until the job finishes, then returns its output as lines. */
export function finish(device: Device, job: Job, limitMs = 600_000): string[] {
  const clock = device.clock;
  const deadline = clock.now + limitMs;
  clock.runUntil(deadline, () => job.done);
  if (!job.done) throw new Error("job did not finish");
  const lines = job.output.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Types each line into the device console and returns everything it printed, waiting out any jobs. */
export function type(device: IosDevice, ...lines: string[]): string[] {
  return lines.flatMap((l) => {
    const r = device.console.input(l);
    return r.job ? [...r.lines, ...finish(device, r.job)] : r.lines;
  });
}

/** Runs a command at a PC's prompt, waiting out any job. */
export function run(pc: Pc, line: string): string[] {
  const r = pc.shell.execute(line);
  return r.job ? [...r.lines, ...finish(pc, r.job)] : r.lines;
}

/** Collects unsolicited console messages (%LINK, %LINEPROTO, ...). */
export function captureLogs(device: IosDevice): string[] {
  const logs: string[] = [];
  // Timestamps are checked once in captures.test.ts; everywhere else only the message matters.
  device.onOutput((t) => logs.push(t.replace(/^\*\w{3} [ \d]\d \d\d:\d\d:\d\d\.\d{3}: /, "")));
  return logs;
}
