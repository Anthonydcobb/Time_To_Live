import { formatIpv4, formatMacCisco, formatMacWindows, maskToPrefix, parseIpv4 } from "../addr";
import type { Pc } from "../devices/pc";
import type { Job } from "../job";
import { winPing, winTracert } from "../tools";

export interface ShellOutput {
  lines: string[];
  /** Set when the command keeps running in simulated time. */
  job?: Job;
}

/** The desktop command prompt on a PC, modeled on Windows `ipconfig`, `ping` and `arp`. */
export class PcShell {
  readonly banner = "Cryptis Desktop Command Line 1.0";

  constructor(private readonly pc: Pc) {}

  prompt(): string {
    return "C:\\>";
  }

  execute(line: string): ShellOutput {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return { lines: [] };
    switch (cmd.toLowerCase()) {
      case "ipconfig":
        return { lines: this.ipconfig(args) };
      case "ping":
        return this.ping(args);
      case "tracert":
        return this.tracert(args);
      case "arp":
        return { lines: args[0]?.toLowerCase() === "-a" ? this.arp() : ["Usage: arp -a"] };
      case "help":
      case "?":
        return { lines: [
          "Available commands:",
          "  arp -a                         Show the ARP cache",
          "  help                           Show this list",
          "  ipconfig                       Show IP settings",
          "  ipconfig /all                  Show IP settings and the MAC address",
          "  ipconfig <ip> <mask> [<gw>]    Set a static IP address",
          "  ping [-n count] <ip>           Send ICMP echo requests",
          "  tracert <ip>                   Trace the route to a host",
        ] };
      default:
        return { lines: ["Invalid Command."] };
    }
  }

  private ipconfig(args: string[]): string[] {
    if (args.length === 0 || args[0].toLowerCase() === "/all") return this.showIp(args[0]?.toLowerCase() === "/all");
    const ip = parseIpv4(args[0]);
    const mask = args[1] ? parseIpv4(args[1]) : null;
    const gw = args[2] ? parseIpv4(args[2]) : null;
    if (ip === null || mask === null || maskToPrefix(mask) === null || (args[2] && gw === null) || args.length > 3) {
      return ["Usage: ipconfig <ip> <mask> [<gateway>]"];
    }
    this.pc.configure(ip, mask, gw);
    return [];
  }

  private showIp(all: boolean): string[] {
    const pc = this.pc;
    const lines = ["", "FastEthernet0 Connection:(default port)", ""];
    if (all) lines.push(`   Physical Address................: ${formatMacWindows(pc.nic.mac)}`);
    lines.push(
      "   Connection-specific DNS Suffix..: ",
      `   IPv4 Address....................: ${pc.ip === null ? "0.0.0.0" : formatIpv4(pc.ip)}`,
      `   Subnet Mask.....................: ${pc.mask === null ? "0.0.0.0" : formatIpv4(pc.mask)}`,
      `   Default Gateway.................: ${pc.gateway === null ? "0.0.0.0" : formatIpv4(pc.gateway)}`,
      "",
    );
    return lines;
  }

  private ping(args: string[]): ShellOutput {
    let count = 4;
    const rest = [...args];
    if (rest[0]?.toLowerCase() === "-n") {
      count = Math.max(1, Math.min(100, Number(rest[1]) || 4));
      rest.splice(0, 2);
    }
    const target = rest[0] ? parseIpv4(rest[0]) : null;
    if (target === null) return { lines: ["Ping request could not find host. Please check the name and try again."] };
    const failed = this.cannotSend(target);
    if (failed) return { lines: failed };
    return { lines: [], job: winPing({ stack: this.pc.stack, clock: this.pc.clock }, target, count) };
  }

  private tracert(args: string[]): ShellOutput {
    const target = args[0] ? parseIpv4(args[0]) : null;
    if (target === null) return { lines: ["Unable to resolve target system name."] };
    const failed = this.cannotSend(target);
    if (failed) return { lines: failed };
    return {
      lines: [`Tracing route to ${formatIpv4(target)} over a maximum of 30 hops: `, ""],
      job: winTracert({ stack: this.pc.stack, clock: this.pc.clock }, target),
    };
  }

  /** Windows refuses to send at all without an address, a link or a route. */
  private cannotSend(target: number): string[] | null {
    const pc = this.pc;
    if (pc.ip === null || !pc.nic.protocolUp || pc.stack.sourceFor(target) === null) {
      return ["PING: transmit failed. General failure."];
    }
    return null;
  }

  private arp(): string[] {
    const entries = [...this.pc.stack.arp.values()];
    if (!entries.length) return ["No ARP Entries Found"];
    return [
      "  Internet Address      Physical Address      Type",
      ...entries.map((e) => `  ${formatIpv4(e.ip).padEnd(22)}${formatMacCisco(e.mac).padEnd(22)}dynamic`),
    ];
  }
}

