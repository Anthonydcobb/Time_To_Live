import type { ConsoleOutput } from "../ios/console";
import type { IosDevice } from "../devices/ios-device";
import type { Pc } from "../devices/pc";

/** The lightweight terminal program a PC uses over an attached console cable. */
export class PcTerminal {
  active = false;

  constructor(private readonly pc: Pc) {}

  target(): IosDevice | null {
    return this.pc.consoleTarget();
  }

  open(): ConsoleOutput {
    const target = this.target();
    if (!target) return { lines: ["No console cable is connected."] };
    this.active = true;
    return { lines: [`[Connected to ${target.hostname} console]`, target.console.prompt()] };
  }

  close(): ConsoleOutput {
    this.active = false;
    return { lines: ["[Console connection closed]"] };
  }

  input(line: string): ConsoleOutput {
    const target = this.target();
    if (!target) {
      this.active = false;
      return { lines: ["% Console cable disconnected."] };
    }
    return target.console.input(line);
  }
}
