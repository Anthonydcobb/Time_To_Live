import { formatIpv4, formatMacCisco, formatMacWindows, maskToPrefix, parseIpv4 } from "../addr";
import type { Pc } from "../devices/pc";

/** The desktop command prompt on a PC, modeled on Windows `ipconfig`, `ping` and `arp`. */
export class PcShell {
  readonly banner = "Cryptis Desktop Command Line 1.0";

  constructor(private readonly pc: Pc) {}

  prompt(): string {
    return "C:\\>";
  }

  execute(line: string): string[] {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return [];
    switch (cmd.toLowerCase()) {
      case "ipconfig":
        return this.ipconfig(args);
      case "ping":
        return this.ping(args);
      case "arp":
        return args[0]?.toLowerCase() === "-a" ? this.arp() : ["Usage: arp -a"];
      case "help":
      case "?":
        return [
          "Available commands:",
          "  arp -a                         Show the ARP cache",
          "  help                           Show this list",
          "  ipconfig                       Show IP settings",
          "  ipconfig /all                  Show IP settings and the MAC address",
          "  ipconfig <ip> <mask> [<gw>]    Set a static IP address",
          "  ping [-n count] <ip>           Send ICMP echo requests",
        ];
      default:
        return ["Invalid Command."];
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

  private ping(args: string[]): string[] {
    let count = 4;
    const rest = [...args];
    if (rest[0]?.toLowerCase() === "-n") {
      count = Math.max(1, Math.min(100, Number(rest[1]) || 4));
      rest.splice(0, 2);
    }
    const target = rest[0] ? parseIpv4(rest[0]) : null;
    if (target === null) return ["Ping request could not find host. Please check the name and try again."];
    const shown = formatIpv4(target);
    const pc = this.pc;
    if (pc.ip === null || !pc.nic.protocolUp) return ["PING: transmit failed. General failure."];

    const lines = [`Pinging ${shown} with 32 bytes of data:`, ""];
    const rtts: number[] = [];
    const id = pc.stack.newPingId();
    for (let seq = 0; seq < count; seq++) {
      const r = pc.stack.ping(target, id, seq, 2000);
      if (r.kind === "reply") {
        rtts.push(r.rttMs);
        const time = r.rttMs < 1 ? "time<1ms" : `time=${Math.round(r.rttMs)}ms`;
        lines.push(`Reply from ${formatIpv4(r.from)}: bytes=32 ${time} TTL=${r.ttl}`);
      } else if (r.kind === "unreachable") {
        lines.push(`Reply from ${formatIpv4(r.from)}: Destination host unreachable.`);
      } else if (r.kind === "ttl-expired") {
        lines.push(`Reply from ${formatIpv4(r.from)}: TTL expired in transit.`);
      } else {
        lines.push("Request timed out.");
      }
    }
    const received = rtts.length;
    const lost = count - received;
    lines.push(
      "",
      `Ping statistics for ${shown}:`,
      `    Packets: Sent = ${count}, Received = ${received}, Lost = ${lost} (${Math.round((lost / count) * 100)}% loss),`,
    );
    if (received) {
      const ms = (n: number) => `${Math.round(n)}ms`;
      lines.push(
        "Approximate round trip times in milli-seconds:",
        `    Minimum = ${ms(Math.min(...rtts))}, Maximum = ${ms(Math.max(...rtts))}, Average = ${ms(rtts.reduce((a, b) => a + b, 0) / received)}`,
      );
    }
    lines.push("");
    return lines;
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

