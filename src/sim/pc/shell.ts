import { formatIpv4, formatMacCisco, formatMacWindows, maskToPrefix, parseIpv4 } from "../addr";
import type { Pc } from "../devices/pc";
import { Job } from "../job";
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
    if (this.pc.terminal.active) {
      if (cmd.toLowerCase() === "disconnect") return this.pc.terminal.close();
      return this.pc.terminal.input(line);
    }
    switch (cmd.toLowerCase()) {
      case "terminal":
        return this.pc.terminal.open();
      case "ipconfig":
        return this.ipconfig(args);
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
          "  ipconfig /dhcp                 Obtain an IP address automatically",
          "  ipconfig /renew                Ask the DHCP server for a new lease",
          "  ipconfig /release              Give the DHCP lease back",
          "  ipconfig <ip> <mask> [<gw>]    Set a static IP address",
          "  ping [-n count] <ip>           Send ICMP echo requests",
          "  tracert <ip>                   Trace the route to a host",
          "  terminal                       Open the console cable terminal",
          "  disconnect                     Close the console terminal",
        ] };
      default:
        return { lines: ["Invalid Command."] };
    }
  }

  private ipconfig(args: string[]): ShellOutput {
    const flag = args[0]?.toLowerCase();
    if (args.length === 0 || flag === "/all") return { lines: this.showIp(flag === "/all") };
    if (flag === "/dhcp") return this.dhcp();
    if (flag === "/renew") return this.renew();
    if (flag === "/release") return this.release();
    return { lines: this.setStatic(args) };
  }

  /** Stands in for ticking "Obtain an IP address automatically" in the adapter settings. */
  private dhcp(): ShellOutput {
    if (this.pc.dhcp) return this.renew();
    this.pc.dhcp = true;
    return this.renew();
  }

  private renew(): ShellOutput {
    const pc = this.pc;
    if (!pc.dhcp) return { lines: ["", "The operation failed as no adapter is in the state permissible for", "this operation.", ""] };
    if (!pc.nic.protocolUp) {
      return { lines: ["", "No operation can be performed on FastEthernet0 while it has its media disconnected.", ""] };
    }
    const job = new Job();
    pc.renew((lease) => {
      if (job.done) return;
      if (lease) job.write(this.showIp(false).join("\n") + "\n");
      else job.write("An error occurred while renewing interface FastEthernet0 : unable to contact your DHCP server. Request has timed out.\n");
      job.finish();
    });
    job.onAbort(() => pc.dhcpClient.cancel());
    return { lines: [], job };
  }

  private release(): ShellOutput {
    const pc = this.pc;
    if (!pc.dhcp) return { lines: ["", "The operation failed as no adapter is in the state permissible for", "this operation.", ""] };
    pc.release();
    return { lines: this.showIp(false) };
  }

  private setStatic(args: string[]): string[] {
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
    if (all) {
      lines.push(
        `   Physical Address................: ${formatMacWindows(pc.nic.mac)}`,
        `   DHCP Enabled....................: ${pc.dhcp ? "Yes" : "No"}`,
      );
    }
    const addr = (ip: number | null) => (ip === null ? "0.0.0.0" : formatIpv4(ip));
    lines.push(
      "   Connection-specific DNS Suffix..: ",
      `   ${pc.autoconfigured ? "Autoconfiguration IPv4 Address.." : "IPv4 Address...................."}: ${addr(pc.ip)}`,
      `   Subnet Mask.....................: ${addr(pc.mask)}`,
      `   Default Gateway.................: ${addr(pc.gateway)}`,
    );
    if (all && pc.lease) lines.push(`   DHCP Server.....................: ${formatIpv4(pc.lease.server)}`);
    if (all) lines.push(`   DNS Servers.....................: ${pc.dnsServers.length ? pc.dnsServers.map(formatIpv4).join(", ") : "0.0.0.0"}`);
    lines.push("");
    return lines;
  }

  private ping(args: string[]): ShellOutput {
    let count = 4;
    const rest = [...args];
    if (rest[0]?.toLowerCase() === "-n") {
      count = Math.max(1, Math.min(100, Number(rest[1]) || 4));
      rest.splice(0, 2);
    }
    const name = rest[0] ?? "";
    const target = parseIpv4(name);
    if (target !== null) return this.pingAddress(target, count);
    const job = new Job();
    this.pc.resolve(name, (resolved) => {
      if (!resolved) { job.write("Ping request could not find host. Please check the name and try again.\n"); job.finish(); return; }
      this.pc.clock.schedule(0, () => {
        if (job.done) return;
        const failed = this.cannotSend(resolved);
        if (failed) { job.write(failed.join("\n") + "\n"); job.finish(); return; }
        const inner = winPing({ stack: this.pc.stack, clock: this.pc.clock }, resolved, count, name);
        inner.onData((text) => job.write(text));
        inner.onDone(() => job.finish());
      });
    });
    return { lines: [], job };
  }

  private pingAddress(target: number, count: number): ShellOutput {
    const failed = this.cannotSend(target);
    if (failed) return { lines: failed };
    return { lines: [], job: winPing({ stack: this.pc.stack, clock: this.pc.clock }, target, count) };
  }

  private tracert(args: string[]): ShellOutput {
    const name = args[0] ?? "";
    const target = parseIpv4(name);
    if (target !== null) return this.tracertAddress(target, name);
    const job = new Job();
    this.pc.resolve(name, (resolved) => {
      if (!resolved) { job.write("Unable to resolve target system name.\n"); job.finish(); return; }
      this.pc.clock.schedule(0, () => {
        if (job.done) return;
        const result = this.tracertAddress(resolved, name).job;
        if (!result) { job.finish(); return; }
        result.onData((text) => job.write(text));
        result.onDone(() => job.finish());
      });
    });
    return { lines: [], job };
  }

  private tracertAddress(target: number, label: string): ShellOutput {
    const failed = this.cannotSend(target);
    if (failed) return { lines: failed };
    const shown = label === formatIpv4(target) ? label : `${label} [${formatIpv4(target)}]`;
    return { lines: [`Tracing route to ${shown} over a maximum of 30 hops: `, ""], job: winTracert({ stack: this.pc.stack, clock: this.pc.clock }, target) };
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

