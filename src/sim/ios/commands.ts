// The IOS command set, per mode. Each entry is a token sequence plus a handler.
import { broadcastOf, formatIpv4, maskToPrefix, networkOf, parseIpv4, parseIpv6, parseIpv6Prefix, type Ipv4, type Ipv6 } from "../addr";
import type { IosDevice } from "../devices/ios-device";
import type { Router } from "../devices/router";
import type { Switch } from "../devices/switch";
import type { DeviceKind } from "../network";
import { newDhcpPool, type AclAddress, type DhcpPool, type LineConfig } from "./config";
import type { IosConsole, Mode } from "./console";
import { kw, type Arg, type Command, type Token, type Word } from "./parser";
import { type5Hash } from "./passwords";
import * as show from "./show";
import type { Job } from "../job";
import { iosIpv6Ping, iosIpv6Traceroute, iosPing, iosTraceroute } from "../tools";
import { MAX_NORMAL_VLAN, isDefaultVlan, parseVlanList, splitSubinterface } from "../vlans";

/** IOS's [confirm]: Return or y means yes. */
export const CONFIRM = (text: string) => ["", "y", "yes"].includes(text.trim().toLowerCase());

export interface Ctx {
  device: IosDevice;
  console: IosConsole;
  out: string[];
  /** Set by commands that keep running in simulated time. */
  job: Job | null;
}

type Cmd = Command<Ctx>;

interface Entry {
  modes: Mode[];
  devices?: DeviceKind[];
  cmd: Cmd;
}

// ---- argument types ------------------------------------------------------

const ipArg = (help: string, name = "A.B.C.D"): Arg<Ctx> => ({
  type: "arg",
  name,
  help,
  match: (w, i) => {
    const ip = parseIpv4(w[i].text);
    return ip === null ? null : { consumed: 1, value: ip };
  },
  partial: (t) => /^\d{1,3}(\.\d{0,3}){0,3}$/.test(t),
});

const ipv6Arg = (help: string): Arg<Ctx> => ({
  type: "arg",
  name: "X:X::X:X",
  help,
  match: (w, i) => {
    const ip = parseIpv6(w[i].text);
    return ip === null ? null : { consumed: 1, value: ip };
  },
  partial: (t) => /^[0-9a-f:]+$/i.test(t),
});

const ipv6PrefixArg = (help: string): Arg<Ctx> => ({
  type: "arg",
  name: "X:X::X:X/nn or any",
  help,
  match: (w, i) => {
    if (w[i].text.toLowerCase() === "any") return { consumed: 1, value: { address: null, prefix: 0 } };
    const parsed = parseIpv6Prefix(w[i].text);
    return parsed ? { consumed: 1, value: parsed } : null;
  },
  partial: (t) => /^(any|[0-9a-f:]+\/?\d{0,3})$/i.test(t),
});

const wordArg = (help: string, name = "WORD"): Arg<Ctx> => ({
  type: "arg",
  name,
  help,
  match: (w, i) => ({ consumed: 1, value: w[i].text }),
});

const lineArg = (help: string): Arg<Ctx> => ({ type: "arg", name: "LINE", help, rest: true, match: () => null });

const numArg = (min: number, max: number, help: string): Arg<Ctx> => ({
  type: "arg",
  name: `<${min}-${max}>`,
  help,
  match: (w, i) => {
    if (!/^\d+$/.test(w[i].text)) return null;
    const n = Number(w[i].text);
    return n >= min && n <= max ? { consumed: 1, value: n } : null;
  },
});

/**
 * Interface names: `g0/0`, `gig 0/0`, `GigabitEthernet0/0`, `vlan 1`, `g0/0.10`.
 * With `create`, also names that `interface` would create: a new SVI or subinterface.
 */
const ifaceArgFor = (create: boolean): Arg<Ctx> => ({
  type: "arg",
  name: "interface",
  help: "Interface",
  helpItems: (ctx) => ctx.device.interfaceTypes(),
  completions: (ctx) => ctx.device.interfaceTypes().map((t) => t.name),
  match: (words: Word[], i: number, ctx: Ctx) => {
    const m = /^([a-z-]+)([\d/.]*)$/i.exec(words[i].text);
    if (!m) return null;
    const types = ctx.device.interfaceTypes().filter((t) => t.name.toLowerCase().startsWith(m[1].toLowerCase()));
    if (types.length !== 1) return null;
    let number = m[2];
    let consumed = 1;
    if (!number) {
      const next = words[i + 1];
      if (!next) return { consumed: 1, value: null, incomplete: true };
      if (!/^[\d/.]+$/.test(next.text)) return null;
      number = next.text;
      consumed = 2;
    }
    const name = types[0].name + number;
    const iface = ctx.device.interfaces().find((x) => x.name.toLowerCase() === name.toLowerCase() && x.status() !== "deleted");
    if (iface) return { consumed, value: iface.name };
    const created = create ? ctx.device.canCreateInterface(name) : null;
    return created ? { consumed, value: created } : null;
  },
  // A known interface type with a bad number: IOS points at the number.
  caretAt: (words: Word[], i: number, ctx: Ctx) => {
    const m = /^([a-z-]+)/i.exec(words[i].text);
    if (!m || !ctx.device.interfaceTypes().some((t) => t.name.toLowerCase().startsWith(m[1].toLowerCase()))) return null;
    if (m[1].length < words[i].text.length) return words[i].start + m[1].length;
    return words[i + 1]?.start ?? null;
  },
});
const ifaceArg = ifaceArgFor(false);

const ifaceRangeArg: Arg<Ctx> = {
  type: "arg",
  name: "interface-range",
  help: "Interface range",
  match: (words, i, ctx) => {
    const text = words.slice(i).map((w) => w.text).join(" ");
    const names: string[] = [];
    for (const part of text.split(",").map((x) => x.trim()).filter(Boolean)) {
      const m = /^([a-z-]+)(\d+)\/(\d+)(?:\s*-\s*(?:(?:([a-z-]+)(\d+)\/)?(\d+)))?$/i.exec(part);
      if (!m) return null;
      const typeText = m[1];
      const type = ctx.device.interfaceTypes().find((x) => x.name.toLowerCase().startsWith(typeText.toLowerCase()));
      if (!type) return null;
      const first = Number(m[3]);
      const last = m[6] === undefined ? first : Number(m[6]);
      if (last < first) return null;
      for (let n = first; n <= last; n++) {
        const name = `${type.name}${m[2]}/${n}`;
        if (!ctx.device.interfaces().some((x) => x.name === name && x.status() !== "deleted")) return null;
        names.push(name);
      }
    }
    return names.length ? { consumed: words.length - i, value: names } : null;
  },
};

/** `10`, `10,20`, `30-35`. */
const vlanListArg = (help: string, name = "<1-4094>"): Arg<Ctx> => ({
  type: "arg",
  name,
  help,
  match: (w, i) => {
    const list = parseVlanList(w[i].text);
    return list ? { consumed: 1, value: list } : null;
  },
});

// ---- helpers ---------------------------------------------------------------

const cmd = (modes: Mode[], tokens: Token<Ctx>[], run: Cmd["run"], extra: Partial<Entry> & { when?: Cmd["when"] } = {}): Entry => ({
  modes,
  devices: extra.devices,
  cmd: { tokens, run, when: extra.when },
});

const EXEC: Mode[] = ["user", "enable"];
const ENABLE: Mode[] = ["enable"];
const CONFIG: Mode[] = ["config"];
const IF: Mode[] = ["config-if"];
const SUBIF: Mode[] = ["config-subif"];
const ANY_IF: Mode[] = ["config-if", "config-subif"];
const VLAN_MODE: Mode[] = ["config-vlan"];
const LINE: Mode[] = ["config-line"];
const DHCP: Mode[] = ["dhcp-config"];
const ROUTER_CFG: Mode[] = ["config-router"];
const ACL_MODE: Mode[] = ["config-acl"];
const SUB: Mode[] = ["config", "config-if", "config-subif", "config-line", "dhcp-config", "config-vlan", "config-router", "config-acl"];

const NO = kw("no", "Negate a command or set its defaults");
const SHOW = kw("show", "Show running system information");
const IP = kw("ip", "Global IP configuration subcommands");
const AAA = kw("aaa", "Authentication, authorization and accounting");

function selectedLines(ctx: Ctx): LineConfig {
  return ctx.console.lineKind === "vty" ? ctx.device.config.vty : ctx.device.config.con;
}

function forEachIface(ctx: Ctx, fn: (name: string) => void): void {
  for (const name of ctx.console.ifaces) fn(name);
}

function setPassword(ctx: Ctx, text: string) {
  return { text, encrypted: ctx.device.config.servicePasswordEncryption };
}

function aclAddress(text: string): AclAddress | null {
  if (text.toLowerCase() === "any") return { network: null, wildcard: null };
  const network = parseIpv4(text);
  return network === null ? null : { network, wildcard: 0 };
}

function addExtendedAcl(c: Ctx, number: number | string, action: "permit" | "deny", protocol: "ip" | "icmp", sourceText: string, destinationText: string): void {
  const source = aclAddress(sourceText);
  const destination = aclAddress(destinationText);
  if (!source || !destination) {
    c.out.push("% Invalid address in access-list.");
    return;
  }
  (c.device.config.extendedAcls[String(number)] ??= []).push({ action, protocol, source, destination });
}

function namedAcl(c: Ctx): string | null {
  if (c.console.mode !== "config-acl" || c.console.aclName === null) {
    c.out.push("% Access list mode is not active.");
    return null;
  }
  return c.console.aclName;
}

function ping(ctx: Ctx, target: Ipv4): void {
  ctx.out.push("Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${formatIpv4(target)}, timeout is 2 seconds:`);
  ctx.job = iosPing({ stack: ctx.device.stack, clock: ctx.device.clock }, target);
}

function pingIpv6(ctx: Ctx, target: Ipv6): void {
  ctx.job = iosIpv6Ping({ stack: ctx.device.stack, clock: ctx.device.clock }, target);
}

function traceroute(ctx: Ctx, target: Ipv4): void {
  ctx.out.push("Type escape sequence to abort.", `Tracing the route to ${formatIpv4(target)}`, "VRF info: (vrf in name/id, vrf out name/id)");
  ctx.job = iosTraceroute({ stack: ctx.device.stack, clock: ctx.device.clock }, target);
}

function tracerouteIpv6(ctx: Ctx, target: Ipv6): void {
  ctx.out.push("Type escape sequence to abort.", `Tracing the route to ${target}`);
  ctx.job = iosIpv6Traceroute({ stack: ctx.device.stack, clock: ctx.device.clock }, target);
}

function validHostname(name: string): boolean {
  return /^[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name);
}

function configured(ctx: Ctx): void {
  ctx.device.emit("%SYS-5-CONFIG_I: Configured from console by console");
}

const HELP_TEXT = [
  "Help may be requested at any point in a command by entering",
  "a question mark '?'.  If nothing matches, the help list will",
  "be empty and you must backup until entering a '?' shows the",
  "available options.",
  "Two styles of help are provided:",
  "1. Full help is available when you are ready to enter a",
  "   command argument (e.g. 'show ?') and describes each possible",
  "   argument.",
  "2. Partial help is provided when an abbreviated argument is entered",
  "   and you want to know what arguments match the input",
  "   (e.g. 'show pr?'.)",
  "",
];

// ---- the command table ------------------------------------------------------

const showCommands: Entry[] = [
  cmd(EXEC, [SHOW, kw("version", "System hardware and software status")], (c) => c.out.push(...show.showVersion(c.device))),
  cmd(EXEC, [SHOW, kw("clock", "Display the system clock")], (c) => c.out.push(...show.showClock(c.device))),
  cmd(EXEC, [SHOW, kw("ntp", "NTP status"), kw("status", "NTP status")], (c) => c.out.push(...show.showNtpStatus(c.device))),
  cmd(EXEC, [SHOW, kw("ntp", "NTP status"), kw("associations", "NTP associations")], (c) => c.out.push(...show.showNtpAssociations(c.device))),
  cmd(EXEC, [SHOW, kw("logging", "Logging status")], (c) => c.out.push(...show.showLogging(c.device))),
  cmd(EXEC, [SHOW, kw("snmp", "SNMP status")], (c) => c.out.push(...show.showSnmp(c.device))),
  cmd(EXEC, [SHOW, kw("hosts", "DNS host table")], (c) => c.out.push(...show.showHosts(c.device))),
  cmd(EXEC, [SHOW, kw("ssh", "Status of SSH server connections")], (c) => c.out.push(...show.showSsh(c.device))),
  cmd(EXEC, [SHOW, kw("access-lists", "List access lists")], (c) => c.out.push(...show.showAccessLists(c.device))),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("access-list", "IPv6 access lists")], (c) => c.out.push(...show.showIpv6AccessLists(c.device))),
  cmd(
    EXEC,
    [SHOW, kw("ip", "IP information"), kw("interface", "IP interface status and configuration"), kw("brief", "Brief summary of IP status and configuration")],
    (c) => c.out.push(...show.showIpInterfaceBrief(c.device)),
  ),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("interface", "IPv6 interface status"), kw("brief", "Brief summary of IPv6 status")], (c) => c.out.push(...show.showIpv6InterfaceBrief(c.device))),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("route", "IPv6 routing table")], (c) => c.out.push(...show.showIpv6Route(c.device))),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("neighbors", "IPv6 neighbor cache")], (c) => c.out.push(...show.showIpv6Neighbors(c.device))),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("ospf", "IPv6 OSPF information"), kw("neighbor", "IPv6 OSPF neighbors")], (c) => c.out.push(...show.showIpv6OspfNeighbor(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ipv6", "IPv6 information"), kw("ospf", "IPv6 OSPF information"), kw("interface", "IPv6 OSPF interface information")], (c) => c.out.push(...show.showIpv6OspfInterface(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration")], (c) => c.out.push(...show.showInterfaces(c.device))),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), ifaceArg], (c, [name]) =>
    c.out.push(...show.showInterfaces(c.device, name as string)),
  ),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), kw("counters", "Interface counters"), kw("errors", "Interface error counters")], (c) => c.out.push(...show.showInterfaceErrorCounters(c.device))),
  cmd(EXEC, [SHOW, kw("arp", "Arp table")], (c) => c.out.push(...show.showArp(c.device))),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("arp", "IP ARP table")], (c) => c.out.push(...show.showArp(c.device))),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("nat", "Network Address Translation"), kw("translations", "NAT translation table")], (c) => c.out.push(...show.showIpNatTranslations(c.device)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("nat", "Network Address Translation"), kw("statistics", "NAT statistics")], (c) => c.out.push(...show.showIpNatStatistics(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("standby", "Hot Standby Router Protocol")], (c) => c.out.push(...show.showStandby(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("vrrp", "Virtual Router Redundancy Protocol")], (c) => c.out.push(...show.showVrrp(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("glbp", "Gateway Load Balancing Protocol")], (c) => c.out.push(...show.showGlbp(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("route", "IP routing table")], (c) => c.out.push(...show.showIpRoute(c.device)), {
    when: (c) => c.device.kind === "router" || (c.device.kind === "switch" && c.device.config.ipRouting),
  }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("ospf", "OSPF information"), kw("neighbor", "OSPF neighbor list")], (c) => c.out.push(...show.showIpOspfNeighbor(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("ospf", "OSPF information"), kw("interface", "OSPF interface information")], (c) => c.out.push(...show.showIpOspfInterface(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("ospf", "OSPF information"), kw("interface", "OSPF interface information"), ifaceArg], (c, [name]) => c.out.push(...show.showIpOspfInterface(c.device as Router, name as string)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("eigrp", "EIGRP information"), kw("neighbors", "EIGRP neighbor list")], (c) => c.out.push(...show.showIpEigrpNeighbor(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("eigrp", "EIGRP information"), kw("interfaces", "EIGRP interface information")], (c) => c.out.push(...show.showIpEigrpInterfaces(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("eigrp", "EIGRP information"), kw("topology", "EIGRP topology table")], (c) => c.out.push(...show.showIpEigrpTopology(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("protocols", "Active routing protocols")], (c) => c.out.push(...show.showIpProtocols(c.device)), { devices: ["router"] }),
  cmd(
    EXEC,
    [SHOW, kw("mac", "MAC configuration"), kw("address-table", "MAC forwarding table")],
    (c) => c.out.push(...show.showMacAddressTable(c.device as Switch)),
    { devices: ["switch"] },
  ),
  cmd(EXEC, [SHOW, kw("vlan", "VTP VLAN status"), kw("brief", "VTP all VLAN status in brief")], (c) => c.out.push(...show.showVlanBrief(c.device as Switch)), {
    devices: ["switch"],
  }),
  cmd(EXEC, [SHOW, kw("spanning-tree", "Spanning Tree Protocol")], (c) => c.out.push(...show.showSpanningTree(c.device as Switch)), {
    devices: ["switch"],
  }),
  cmd(EXEC, [SHOW, kw("cdp", "CDP information")], (c) => c.out.push(...show.showCdp(c.device))),
  cmd(EXEC, [SHOW, kw("cdp", "CDP information"), kw("neighbors", "CDP neighbor entries")], (c) => c.out.push(...show.showCdpNeighbors(c.device))),
  cmd(EXEC, [SHOW, kw("cdp", "CDP information"), kw("neighbors", "CDP neighbor entries"), kw("detail", "Show detailed information")], (c) =>
    c.out.push(...show.showCdpNeighborsDetail(c.device)),
  ),
  cmd(EXEC, [SHOW, kw("lldp", "LLDP information")], (c) => c.out.push(...show.showLldp(c.device))),
  cmd(EXEC, [SHOW, kw("lldp", "LLDP information"), kw("neighbors", "LLDP neighbor entries")], (c) => c.out.push(...show.showLldpNeighbors(c.device))),
  cmd(EXEC, [SHOW, kw("lldp", "LLDP information"), kw("neighbors", "LLDP neighbor entries"), kw("detail", "Show detailed information")], (c) => c.out.push(...show.showLldpNeighborsDetail(c.device))),
  cmd(ENABLE, [SHOW, kw("running-config", "Current operating configuration")], (c) => c.out.push(...show.showRunningConfig(c.device))),
  cmd(ENABLE, [SHOW, kw("startup-config", "Contents of startup configuration")], (c) => c.out.push(...show.showStartupConfig(c.device))),
];

const execCommands: Entry[] = [
  cmd(EXEC, [kw("enable", "Turn on privileged commands")], (c) => c.console.beginEnable()),
  cmd(EXEC, [kw("exit", "Exit from the EXEC")], (c) => c.console.logout()),
  cmd(EXEC, [kw("logout", "Exit from the EXEC")], (c) => c.console.logout()),
  cmd(EXEC, [kw("help", "Description of the interactive help system")], (c) => c.out.push(...HELP_TEXT)),
  cmd(EXEC, [kw("ping", "Send echo messages"), ipArg("Ping destination address or hostname")], (c, [ip]) => ping(c, ip as Ipv4)),
  cmd(EXEC, [kw("ping", "Send echo messages"), kw("ipv6", "IPv6 destination"), ipv6Arg("IPv6 destination address")], (c, [ip]) => pingIpv6(c, ip as Ipv6)),
  cmd(EXEC, [kw("traceroute", "Trace route to destination"), ipArg("Trace route to destination address or hostname")], (c, [ip]) =>
    traceroute(c, ip as Ipv4),
  ),
  cmd(EXEC, [kw("traceroute", "Trace route to destination"), kw("ipv6", "IPv6 destination"), ipv6Arg("IPv6 destination address")], (c, [ip]) =>
    tracerouteIpv6(c, ip as Ipv6),
  ),
  cmd(ENABLE, [kw("disable", "Turn off privileged commands")], (c) => c.console.setMode("user")),
  cmd(ENABLE, [kw("configure", "Enter configuration mode"), kw("terminal", "Configure from the terminal")], (c) => {
    c.out.push("Enter configuration commands, one per line.  End with CNTL/Z.");
    c.console.setMode("config");
  }),
  cmd(
    ENABLE,
    [kw("copy", "Copy from one file to another"), kw("running-config", "Copy from current system configuration"), kw("startup-config", "Copy to startup configuration")],
    (c) => c.console.askCopyRunStart(),
  ),
  cmd(ENABLE, [kw("write", "Write running configuration to memory, network, or terminal")], (c) => save(c)),
  cmd(ENABLE, [kw("write", "Write running configuration to memory, network, or terminal"), kw("memory", "Write to NV memory")], (c) => save(c)),
  cmd(ENABLE, [kw("erase", "Erase a filesystem"), kw("startup-config", "Erase contents of configuration memory")], (c) => c.console.askErase()),
  cmd(ENABLE, [kw("reload", "Halt and perform a cold restart")], (c) => c.console.askReload()),
  cmd(ENABLE, [kw("clear", "Reset functions"), kw("arp-cache", "Clear the entire ARP cache")], (c) => c.device.stack.arp.clear()),
  cmd(ENABLE, [kw("clear", "Reset functions"), kw("logging", "Clear the logging buffer")], (c) => c.device.logBuffer.splice(0)),
  cmd(
    ENABLE,
    [kw("clear", "Reset functions"), kw("mac", "MAC forwarding table"), kw("address-table", "MAC forwarding table"), kw("dynamic", "dynamic entry type")],
    (c) => (c.device as Switch).macTable.clear(),
    { devices: ["switch"] },
  ),
];

function save(c: Ctx): void {
  c.out.push("Building configuration...", "[OK]");
  c.device.saveConfig();
}

const exitEnd: Entry[] = [
  cmd(SUB, [kw("end", "Exit from configure mode")], (c) => {
    c.console.setMode("enable");
    configured(c);
  }),
  cmd(CONFIG, [kw("exit", "Exit from configure mode")], (c) => {
    c.console.setMode("enable");
    configured(c);
  }),
  cmd(ANY_IF, [kw("exit", "Exit from interface configuration mode")], (c) => c.console.setMode("config")),
  cmd(VLAN_MODE, [kw("exit", "Apply changes, bump revision number, and exit mode")], (c) => c.console.setMode("config")),
  cmd(LINE, [kw("exit", "Exit from line configuration mode")], (c) => c.console.setMode("config")),
  cmd(DHCP, [kw("exit", "Exit from DHCP pool configuration mode")], (c) => c.console.setMode("config")),
  cmd(ROUTER_CFG, [kw("exit", "Exit from routing protocol configuration mode")], (c) => c.console.setMode("config")),
  cmd(ACL_MODE, [kw("exit", "Exit from access-list configuration mode")], (c) => c.console.setMode("config")),
];

const ENABLE_KW = kw("enable", "Modify enable password parameters");
const SERVICE = kw("service", "Modify use of network based services");
const PWENC = kw("password-encryption", "Encrypt system passwords");
const BANNER = kw("banner", "Define a login banner");
const MOTD = kw("motd", "Set Message of the Day banner");
const DOMAIN = kw("domain-lookup", "Enable IP Domain Name System hostname translation");
const DOMAIN_NAME = kw("domain-name", "Define the default domain name");
const ROUTE = kw("route", "Establish static routes");
const STP = kw("spanning-tree", "Spanning Tree Protocol");
const ACCESS_LIST = kw("access-list", "Add an access list entry");
const PERMIT = kw("permit", "Permit access");
const DENY = kw("deny", "Deny access");
const ANY = kw("any", "Any source address");

function addRoute(c: Ctx, network: Ipv4, mask: Ipv4, via: { nextHop: Ipv4 | null; exitIface: string | null; distance?: number }): void {
  if (maskToPrefix(mask) === null) {
    c.out.push("%Inconsistent address and mask");
    return;
  }
  if (networkOf(network, mask) !== network) {
    c.out.push("%Inconsistent address and mask");
    return;
  }
  const routes = c.device.config.staticRoutes;
  const distance = via.distance ?? 1;
  const same = (r: (typeof routes)[number]) => r.network === network && r.mask === mask && r.nextHop === via.nextHop && r.exitIface === via.exitIface && (r.distance ?? 1) === distance;
  if (!routes.some(same)) routes.push({ network, mask, ...via, distance });
}

function removeRoute(c: Ctx, network: Ipv4, mask: Ipv4, nextHop?: Ipv4 | null, exitIface?: string | null): void {
  const routes = c.device.config.staticRoutes;
  const keep = routes.filter(
    (r) =>
      !(r.network === network && r.mask === mask && (nextHop === undefined || r.nextHop === nextHop) && (exitIface === undefined || r.exitIface === exitIface)),
  );
  if (keep.length === routes.length) c.out.push("%No matching route to delete");
  c.device.config.staticRoutes = keep;
}

const configCommands: Entry[] = [
  // IOS.sh's switch. It does nothing here, but it's why "sh run" in config mode puts the caret under "run".
  cmd(CONFIG, [kw("shell", "Configure shell command"), kw("processing", "Configure shell processing"), kw("full", "Enable shell processing full")], () => {}),
  cmd(CONFIG, [AAA, kw("new-model", "Enable AAA access control" )], (c) => { c.device.config.aaaNewModel = true; }),
  cmd(CONFIG, [NO, AAA, kw("new-model", "Enable AAA access control" )], (c) => { c.device.config.aaaNewModel = false; c.device.config.aaaLoginLocal = false; }),
  cmd(CONFIG, [AAA, kw("authentication", "Authentication methods"), kw("login", "Login authentication"), kw("default", "Default authentication list"), kw("local", "Use local username database")], (c) => {
    c.device.config.aaaNewModel = true;
    c.device.config.aaaLoginLocal = true;
  }),
  cmd(CONFIG, [NO, AAA, kw("authentication", "Authentication methods"), kw("login", "Login authentication"), kw("default", "Default authentication list")], (c) => { c.device.config.aaaLoginLocal = false; }),
  cmd(CONFIG, [kw("hostname", "Set system's network name"), wordArg("This system's network name")], (c, [name]) => {
    if (!validHostname(name as string)) {
      c.out.push("% Hostname contains one or more illegal characters.");
      return;
    }
    c.device.config.hostname = name as string;
  }),
  cmd(CONFIG, [kw("ntp", "Configure NTP"), kw("server", "NTP server"), ipArg("NTP server address")], (c, [server]) => {
    if (!c.device.config.ntpServers.includes(server as Ipv4)) c.device.config.ntpServers.push(server as Ipv4);
  }),
  cmd(CONFIG, [NO, kw("ntp", "Configure NTP"), kw("server", "NTP server"), ipArg("NTP server address")], (c, [server]) => {
    c.device.config.ntpServers = c.device.config.ntpServers.filter((address) => address !== server);
  }),
  cmd(CONFIG, [kw("logging", "Configure system logging"), kw("host", "Log host"), ipArg("Syslog server address")], (c, [host]) => {
    if (!c.device.config.loggingHosts.includes(host as Ipv4)) c.device.config.loggingHosts.push(host as Ipv4);
  }),
  cmd(CONFIG, [NO, kw("logging", "Configure system logging"), kw("host", "Log host"), ipArg("Syslog server address")], (c, [host]) => {
    c.device.config.loggingHosts = c.device.config.loggingHosts.filter((address) => address !== host);
  }),
  cmd(CONFIG, [kw("logging", "Configure system logging"), kw("trap", "Set trap logging level"), numArg(0, 7, "Severity level")], (c, [level]) => { c.device.config.loggingTrap = level as number; }),
  cmd(CONFIG, [kw("snmp-server", "Configure SNMP"), kw("community", "SNMP community string"), wordArg("Community string"), kw("ro", "Read-only access")], (c, [community]) => {
    c.device.config.snmpCommunities = c.device.config.snmpCommunities.filter((entry) => entry.community !== community);
    c.device.config.snmpCommunities.push({ community: community as string, access: "ro" });
  }),
  cmd(CONFIG, [kw("snmp-server", "Configure SNMP"), kw("community", "SNMP community string"), wordArg("Community string"), kw("rw", "Read-write access")], (c, [community]) => {
    c.device.config.snmpCommunities = c.device.config.snmpCommunities.filter((entry) => entry.community !== community);
    c.device.config.snmpCommunities.push({ community: community as string, access: "rw" });
  }),
  cmd(CONFIG, [NO, kw("snmp-server", "Configure SNMP"), kw("community", "SNMP community string"), wordArg("Community string")], (c, [community]) => {
    c.device.config.snmpCommunities = c.device.config.snmpCommunities.filter((entry) => entry.community !== community);
  }),
  cmd(CONFIG, [NO, kw("hostname", "Set system's network name")], (c) => {
    c.device.config.hostname = c.device.kind === "router" ? "Router" : "Switch";
  }),
  cmd(CONFIG, [STP, kw("vlan", "VLAN spanning tree parameters"), numArg(1, 4094, "VLAN ID"), kw("priority", "Set bridge priority"), numArg(0, 61440, "Bridge priority")], (c, [vlan, priority]) => {
    if (c.device.kind !== "switch") return;
    if ((priority as number) % 4096 !== 0) {
      c.out.push("% Bridge priority must be in increments of 4096.");
      return;
    }
    c.device.config.spanningTreePriority[vlan as number] = priority as number;
    (c.device as Switch).vlanConfigChanged();
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, STP, kw("vlan", "VLAN spanning tree parameters"), numArg(1, 4094, "VLAN ID"), kw("priority", "Set bridge priority")], (c, [vlan]) => {
    if (c.device.kind !== "switch") return;
    delete c.device.config.spanningTreePriority[vlan as number];
    (c.device as Switch).vlanConfigChanged();
  }, { devices: ["switch"] }),
  cmd(CONFIG, [ENABLE_KW, kw("secret", "Assign the privileged level secret"), wordArg("The UNENCRYPTED (cleartext) 'enable' secret")], (c, [s]) => {
    c.device.config.enableSecret = type5Hash(s as string);
  }),
  cmd(CONFIG, [ENABLE_KW, kw("password", "Assign the privileged level password"), wordArg("The UNENCRYPTED (cleartext) 'enable' password")], (c, [p]) => {
    const cfg = c.device.config;
    if (cfg.enableSecret && cfg.enableSecret === type5Hash(p as string, cfg.enableSecret.split("$")[2])) {
      c.out.push(
        "The enable password you have chosen is the same as your enable secret.",
        "This is not recommended.  Re-enter the enable password.",
      );
      return;
    }
    cfg.enablePassword = setPassword(c, p as string);
  }),
  cmd(CONFIG, [NO, ENABLE_KW, kw("secret", "Assign the privileged level secret")], (c) => {
    c.device.config.enableSecret = null;
  }),
  cmd(CONFIG, [NO, ENABLE_KW, kw("password", "Assign the privileged level password")], (c) => {
    c.device.config.enablePassword = null;
  }),
  cmd(CONFIG, [kw("username", "Establish User Name Authentication"), wordArg("User name"), kw("secret", "Specify the password for the user"), wordArg("The UNENCRYPTED (cleartext) password")], (c, [name, secret]) => {
    c.device.config.users[name as string] = type5Hash(secret as string);
  }),
  cmd(CONFIG, [NO, kw("username", "Establish User Name Authentication"), wordArg("User name")], (c, [name]) => {
    delete c.device.config.users[name as string];
  }),
  cmd(CONFIG, [IP, ACCESS_LIST, kw("standard", "Standard named access list"), wordArg("Access list name")], (c, [name]) => {
    c.console.aclKind = "standard";
    c.console.aclName = name as string;
    c.console.setMode("config-acl");
    c.device.config.standardAcls[c.console.aclName] ??= [];
  }),
  cmd(CONFIG, [IP, ACCESS_LIST, kw("extended", "Extended named access list"), wordArg("Access list name")], (c, [name]) => {
    c.console.aclKind = "extended";
    c.console.aclName = name as string;
    c.console.setMode("config-acl");
    c.device.config.extendedAcls[c.console.aclName] ??= [];
  }),
  cmd(CONFIG, [kw("ipv6", "IPv6 global configuration"), kw("access-list", "IPv6 access list"), wordArg("Access list name"), PERMIT, kw("ipv6", "Any IPv6 protocol"), ipv6PrefixArg("Source prefix"), ipv6PrefixArg("Destination prefix")], (c, [name, source, destination]) => {
    (c.device.config.ipv6Acls[name as string] ??= []).push({ action: "permit", protocol: "ipv6", source: source as { address: Ipv6; prefix: number }, destination: destination as { address: Ipv6; prefix: number } });
  }),
  cmd(CONFIG, [kw("ipv6", "IPv6 global configuration"), kw("access-list", "IPv6 access list"), wordArg("Access list name"), DENY, kw("ipv6", "Any IPv6 protocol"), ipv6PrefixArg("Source prefix"), ipv6PrefixArg("Destination prefix")], (c, [name, source, destination]) => {
    (c.device.config.ipv6Acls[name as string] ??= []).push({ action: "deny", protocol: "ipv6", source: source as { address: Ipv6; prefix: number }, destination: destination as { address: Ipv6; prefix: number } });
  }),
  cmd(CONFIG, [kw("ipv6", "IPv6 global configuration"), kw("access-list", "IPv6 access list"), wordArg("Access list name"), PERMIT, kw("icmp", "IPv6 ICMP protocol"), ipv6PrefixArg("Source prefix"), ipv6PrefixArg("Destination prefix")], (c, [name, source, destination]) => {
    (c.device.config.ipv6Acls[name as string] ??= []).push({ action: "permit", protocol: "icmpv6", source: source as { address: Ipv6; prefix: number }, destination: destination as { address: Ipv6; prefix: number } });
  }),
  cmd(CONFIG, [kw("ipv6", "IPv6 global configuration"), kw("access-list", "IPv6 access list"), wordArg("Access list name"), DENY, kw("icmp", "IPv6 ICMP protocol"), ipv6PrefixArg("Source prefix"), ipv6PrefixArg("Destination prefix")], (c, [name, source, destination]) => {
    (c.device.config.ipv6Acls[name as string] ??= []).push({ action: "deny", protocol: "icmpv6", source: source as { address: Ipv6; prefix: number }, destination: destination as { address: Ipv6; prefix: number } });
  }),
  cmd(CONFIG, [NO, kw("ipv6", "IPv6 global configuration"), kw("access-list", "IPv6 access list"), wordArg("Access list name")], (c, [name]) => { delete c.device.config.ipv6Acls[name as string]; }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), PERMIT, ANY], (c, [number]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "permit", network: null, wildcard: null });
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), DENY, ANY], (c, [number]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "deny", network: null, wildcard: null });
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), PERMIT, ipArg("Source address")], (c, [number, network]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "permit", network: network as Ipv4, wildcard: 0 });
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), PERMIT, ipArg("Source network"), ipArg("Wildcard bits")], (c, [number, network, wildcard]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "permit", network: network as Ipv4, wildcard: wildcard as Ipv4 });
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), DENY, ipArg("Source address")], (c, [number, network]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "deny", network: network as Ipv4, wildcard: 0 });
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(1, 99, "Standard ACL number"), DENY, ipArg("Source network"), ipArg("Wildcard bits")], (c, [number, network, wildcard]) => {
    (c.device.config.standardAcls[number as number] ??= []).push({ action: "deny", network: network as Ipv4, wildcard: wildcard as Ipv4 });
  }),
  cmd(CONFIG, [NO, ACCESS_LIST, numArg(1, 99, "Standard ACL number")], (c, [number]) => {
    delete c.device.config.standardAcls[number as number];
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(100, 199, "Extended ACL number"), PERMIT, kw("icmp", "Internet Control Message Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [number, source, destination]) => {
    addExtendedAcl(c, number as number, "permit", "icmp", source as string, destination as string);
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(100, 199, "Extended ACL number"), DENY, kw("icmp", "Internet Control Message Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [number, source, destination]) => {
    addExtendedAcl(c, number as number, "deny", "icmp", source as string, destination as string);
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(100, 199, "Extended ACL number"), PERMIT, kw("ip", "Any Internet Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [number, source, destination]) => {
    addExtendedAcl(c, number as number, "permit", "ip", source as string, destination as string);
  }),
  cmd(CONFIG, [ACCESS_LIST, numArg(100, 199, "Extended ACL number"), DENY, kw("ip", "Any Internet Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [number, source, destination]) => {
    addExtendedAcl(c, number as number, "deny", "ip", source as string, destination as string);
  }),
  cmd(CONFIG, [NO, ACCESS_LIST, numArg(100, 199, "Extended ACL number")], (c, [number]) => {
    delete c.device.config.extendedAcls[number as number];
  }),
  cmd(ACL_MODE, [PERMIT, ANY], (c) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "permit", network: null, wildcard: null });
  }),
  cmd(ACL_MODE, [DENY, ANY], (c) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "deny", network: null, wildcard: null });
  }),
  cmd(ACL_MODE, [PERMIT, ipArg("Source address")], (c, [network]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "permit", network: network as Ipv4, wildcard: 0 });
  }),
  cmd(ACL_MODE, [PERMIT, ipArg("Source network"), ipArg("Wildcard bits")], (c, [network, wildcard]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "permit", network: network as Ipv4, wildcard: wildcard as Ipv4 });
  }),
  cmd(ACL_MODE, [DENY, ipArg("Source address")], (c, [network]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "deny", network: network as Ipv4, wildcard: 0 });
  }),
  cmd(ACL_MODE, [DENY, ipArg("Source network"), ipArg("Wildcard bits")], (c, [network, wildcard]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "standard") return;
    (c.device.config.standardAcls[name] ??= []).push({ action: "deny", network: network as Ipv4, wildcard: wildcard as Ipv4 });
  }),
  cmd(ACL_MODE, [PERMIT, kw("icmp", "Internet Control Message Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [source, destination]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "extended") return;
    addExtendedAcl(c, name, "permit", "icmp", source as string, destination as string);
  }),
  cmd(ACL_MODE, [DENY, kw("icmp", "Internet Control Message Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [source, destination]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "extended") return;
    addExtendedAcl(c, name, "deny", "icmp", source as string, destination as string);
  }),
  cmd(ACL_MODE, [PERMIT, kw("ip", "Any Internet Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [source, destination]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "extended") return;
    addExtendedAcl(c, name, "permit", "ip", source as string, destination as string);
  }),
  cmd(ACL_MODE, [DENY, kw("ip", "Any Internet Protocol"), wordArg("Source address or any"), wordArg("Destination address or any")], (c, [source, destination]) => {
    const name = namedAcl(c); if (!name || c.console.aclKind !== "extended") return;
    addExtendedAcl(c, name, "deny", "ip", source as string, destination as string);
  }),
  cmd(CONFIG, [SERVICE, PWENC], (c) => {
    const cfg = c.device.config;
    cfg.servicePasswordEncryption = true;
    for (const p of [cfg.enablePassword, cfg.con.password, cfg.vty.password]) if (p) p.encrypted = true;
  }),
  cmd(CONFIG, [NO, SERVICE, PWENC], (c) => {
    c.device.config.servicePasswordEncryption = false;
  }),
  cmd(CONFIG, [BANNER, MOTD, lineArg("c banner-text c, where 'c' is a delimiting character")], (c, [text]) => c.console.beginBanner(text as string)),
  cmd(CONFIG, [NO, BANNER, MOTD], (c) => {
    c.device.config.bannerMotd = null;
  }),
  cmd(CONFIG, [kw("cdp", "Global CDP configuration subcommands"), kw("run", "")], (c) => {
    c.device.config.cdpRun = true;
  }),
  cmd(CONFIG, [NO, kw("cdp", "Global CDP configuration subcommands"), kw("run", "")], (c) => {
    c.device.config.cdpRun = false;
    c.device.cdpNeighbors.clear();
  }),
  cmd(CONFIG, [kw("lldp", "Global LLDP configuration subcommands"), kw("run", "Enable LLDP")], (c) => { c.device.config.lldp = true; }),
  cmd(CONFIG, [NO, kw("lldp", "Global LLDP configuration subcommands"), kw("run", "Enable LLDP")], (c) => { c.device.config.lldp = false; c.device.lldpNeighbors.clear(); }),
  cmd(CONFIG, [IP, DOMAIN], (c) => {
    c.device.config.ipDomainLookup = true;
  }),
  cmd(CONFIG, [NO, IP, DOMAIN], (c) => {
    c.device.config.ipDomainLookup = false;
  }),
  cmd(CONFIG, [IP, DOMAIN_NAME, wordArg("Default domain name")], (c, [name]) => {
    c.device.config.domainName = name as string;
  }),
  cmd(CONFIG, [NO, IP, DOMAIN_NAME], (c) => {
    c.device.config.domainName = null;
  }),
  cmd(CONFIG, [IP, kw("dns", "DNS service"), kw("server", "Enable DNS server")], (c) => {
    c.device.config.dnsServer = true;
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, kw("dns", "DNS service"), kw("server", "Enable DNS server")], (c) => {
    c.device.config.dnsServer = false;
  }, { devices: ["router"] }),
  cmd(CONFIG, [IP, kw("host", "Add a static host name-to-address mapping"), wordArg("Host name"), ipArg("Host address")], (c, [name, address]) => {
    c.device.config.hostRecords[String(name).toLowerCase().replace(/\.$/, "")] = [address as Ipv4];
  }),
  cmd(CONFIG, [NO, IP, kw("host", "Remove a static host name-to-address mapping"), wordArg("Host name")], (c, [name]) => {
    delete c.device.config.hostRecords[String(name).toLowerCase().replace(/\.$/, "")];
  }),
  cmd(CONFIG, [kw("crypto", "Encryption module commands"), kw("key", "Long term key operations"), kw("generate", "Generate new keys"), kw("rsa", "Generate RSA keys")], (c) => {
    if (!c.device.config.domainName) {
      c.out.push("% Please define a domain name first.");
      return;
    }
    c.device.config.rsaKeysGenerated = true;
    c.out.push("The name for the keys will be:", c.device.hostname + "." + c.device.config.domainName, "Generating 512 bit RSA keys, keys will be non-exportable...", "[OK]");
  }),
  cmd(CONFIG, [IP, kw("routing", "Enable IP routing")], (c) => {
    if (c.device.kind === "switch") c.device.config.ipRouting = true;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [kw("ipv6", "Global IPv6 configuration"), kw("unicast-routing", "Enable IPv6 unicast routing")], (c) => {
    c.device.config.ipv6UnicastRouting = true;
  }),
  cmd(CONFIG, [kw("ipv6", "Global IPv6 configuration"), kw("router", "Enable IPv6 OSPF"), kw("ospf", "Open Shortest Path First"), numArg(1, 65535, "Process ID")], (c, [processId]) => {
    c.device.config.ospfv3 = { processId: processId as number };
    c.console.setMode("config-router");
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, kw("ipv6", "Global IPv6 configuration"), kw("router", "Enable IPv6 OSPF"), kw("ospf", "Open Shortest Path First")], (c) => { c.device.config.ospfv3 = null; }, { devices: ["router"] }),
  cmd(CONFIG, [NO, kw("ipv6", "Global IPv6 configuration"), kw("unicast-routing", "Enable IPv6 unicast routing")], (c) => {
    c.device.config.ipv6UnicastRouting = false;
  }),
  cmd(CONFIG, [NO, IP, kw("routing", "Enable IP routing")], (c) => {
    if (c.device.kind === "switch") c.device.config.ipRouting = false;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [IP, kw("domain", "IP DNS Resolver"), kw("lookup", "Enable IP Domain Name System hostname translation")], (c) => {
    c.device.config.ipDomainLookup = true;
  }),
  cmd(CONFIG, [NO, IP, kw("domain", "IP DNS Resolver"), kw("lookup", "Enable IP Domain Name System hostname translation")], (c) => {
    c.device.config.ipDomainLookup = false;
  }),
  cmd(CONFIG, [kw("interface", "Select an interface to configure"), ifaceArgFor(true)], (c, [name]) => {
    const n = name as string;
    if (!c.device.config.interfaces[n]) c.device.createInterface(n);
    c.console.ifaces = [n];
    c.console.setMode(splitSubinterface(n) && c.device.kind === "router" ? "config-subif" : "config-if");
  }),
  cmd(CONFIG, [kw("router", "Enable a routing protocol"), kw("ospf", "Open Shortest Path First"), numArg(1, 65535, "Process ID")], (c, [processId]) => {
    c.device.config.ospf ??= { processId: processId as number, networks: [], passiveInterfaces: [], routerId: null, defaultInformation: false, summaries: [] };
    c.device.config.ospf.processId = processId as number;
    c.console.setMode("config-router");
  }, { devices: ["router"] }),
  cmd(CONFIG, [kw("router", "Enable a routing protocol"), kw("eigrp", "Enhanced Interior Gateway Routing Protocol"), numArg(1, 65535, "Autonomous system")], (c, [as]) => {
    c.device.config.eigrp ??= { as: as as number, networks: [], passiveInterfaces: [] };
    c.device.config.eigrp.as = as as number;
    c.console.setMode("config-router");
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, kw("router", "Enable a routing protocol"), kw("eigrp", "Enhanced Interior Gateway Routing Protocol")], (c) => { c.device.config.eigrp = null; }, { devices: ["router"] }),
  cmd(CONFIG, [NO, kw("router", "Enable a routing protocol"), kw("ospf", "Open Shortest Path First")], (c) => {
    c.device.config.ospf = null;
  }, { devices: ["router"] }),
  cmd(CONFIG, [kw("interface", "Select an interface to configure"), kw("range", "Select a range of interfaces"), ifaceRangeArg], (c, [names]) => {
    c.console.ifaces = names as string[];
    c.console.setMode("config-if");
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, kw("interface", "Select an interface to configure"), ifaceArg], (c, [name]) => {
    const error = c.device.deleteInterface(name as string);
    if (error) c.out.push(error);
  }),
  cmd(CONFIG, [kw("line", "Configure a terminal line"), kw("console", "Primary terminal line"), numArg(0, 0, "First Line number")], (c) => {
    c.console.lineKind = "con";
    c.console.setMode("config-line");
  }),
  cmd(
    CONFIG,
    [kw("line", "Configure a terminal line"), kw("vty", "Virtual terminal"), numArg(0, 15, "First Line number"), numArg(0, 15, "Last Line number")],
    (c, [first, last]) => {
      if ((last as number) < (first as number)) {
        c.out.push("%Invalid line range");
        return;
      }
      c.console.lineKind = "vty";
      c.console.setMode("config-line");
    },
  ),
  cmd(CONFIG, [kw("line", "Configure a terminal line"), kw("vty", "Virtual terminal"), numArg(0, 15, "First Line number")], (c) => {
    c.console.lineKind = "vty";
    c.console.setMode("config-line");
  }),
  cmd(CONFIG, [IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ipArg("Forwarding router's address")], (c, [n, m, h]) =>
    addRoute(c, n as Ipv4, m as Ipv4, { nextHop: h as Ipv4, exitIface: null }),
  { devices: ["router"] }),
  cmd(CONFIG, [IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ipArg("Forwarding router's address"), numArg(1, 255, "Administrative distance")], (c, [n, m, h, distance]) =>
    addRoute(c, n as Ipv4, m as Ipv4, { nextHop: h as Ipv4, exitIface: null, distance: distance as number }),
  { devices: ["router"] }),
  cmd(CONFIG, [IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ifaceArg], (c, [n, m, i]) =>
    addRoute(c, n as Ipv4, m as Ipv4, { nextHop: null, exitIface: i as string }),
  { devices: ["router"] }),
  cmd(CONFIG, [IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ifaceArg, numArg(1, 255, "Administrative distance")], (c, [n, m, i, distance]) =>
    addRoute(c, n as Ipv4, m as Ipv4, { nextHop: null, exitIface: i as string, distance: distance as number }),
  { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask")], (c, [n, m]) => removeRoute(c, n as Ipv4, m as Ipv4), {
    devices: ["router"],
  }),
  cmd(CONFIG, [NO, IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ipArg("Forwarding router's address")], (c, [n, m, h]) =>
    removeRoute(c, n as Ipv4, m as Ipv4, h as Ipv4),
  { devices: ["router"] }),
  cmd(CONFIG, [IP, kw("default-gateway", "Specify default gateway (if not routing IP)"), ipArg("IP address of default gateway")], (c, [gw]) => {
    c.device.config.defaultGateway = gw as Ipv4;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, IP, kw("default-gateway", "Specify default gateway (if not routing IP)")], (c) => {
    c.device.config.defaultGateway = null;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [kw("ipv6", "Global IPv6 configuration"), kw("route", "Configure a static IPv6 route"), wordArg("IPv6 prefix/prefix-length"), wordArg("Next-hop IPv6 address")], (c, [prefix, nextHop]) => {
    const parsed = parseIpv6Prefix(prefix as string);
    const via = parseIpv6Prefix(`${nextHop as string}/128`);
    if (!parsed || !via) { c.out.push("% Invalid IPv6 route."); return; }
    c.device.config.ipv6StaticRoutes.push({ network: parsed.address, prefix: parsed.prefix, nextHop: via.address, exitIface: null });
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, kw("ipv6", "Global IPv6 configuration"), kw("route", "Configure a static IPv6 route"), wordArg("IPv6 prefix/prefix-length"), wordArg("Next-hop IPv6 address")], (c, [prefix, nextHop]) => {
    const parsed = parseIpv6Prefix(prefix as string);
    const via = parseIpv6Prefix(`${nextHop as string}/128`);
    if (!parsed || !via) return;
    c.device.config.ipv6StaticRoutes = c.device.config.ipv6StaticRoutes.filter((r) => !(r.network === parsed.address && r.prefix === parsed.prefix && r.nextHop === via.address));
  }, { devices: ["router"] }),
  cmd(CONFIG, [IP, kw("nat", "Configure Network Address Translation"), kw("inside", "Inside address"), kw("source", "Source address"), kw("static", "Static translation"), ipArg("Inside local address"), ipArg("Inside global address")], (c, [local, global]) => {
    const nat = { insideLocal: local as Ipv4, insideGlobal: global as Ipv4 };
    if (!c.device.config.staticNat.some((n) => n.insideLocal === nat.insideLocal && n.insideGlobal === nat.insideGlobal)) c.device.config.staticNat.push(nat);
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, kw("nat", "Configure Network Address Translation"), kw("inside", "Inside address"), kw("source", "Source address"), kw("static", "Static translation"), ipArg("Inside local address"), ipArg("Inside global address")], (c, [local, global]) => {
    c.device.config.staticNat = c.device.config.staticNat.filter((n) => n.insideLocal !== local || n.insideGlobal !== global);
  }, { devices: ["router"] }),
  cmd(CONFIG, [IP, kw("nat", "Configure Network Address Translation"), kw("inside", "Inside address"), kw("source", "Source address"), kw("list", "Access list"), numArg(1, 99, "Standard ACL number"), kw("interface", "Outside interface"), ifaceArg, kw("overload", "Overload translations")], (c, [acl, iface]) => {
    const rule = { acl: acl as number, outsideInterface: iface as string };
    if (!c.device.config.natOverloads.some((r) => r.acl === rule.acl && r.outsideInterface === rule.outsideInterface)) c.device.config.natOverloads.push(rule);
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, kw("nat", "Configure Network Address Translation"), kw("inside", "Inside address"), kw("source", "Source address"), kw("list", "Access list"), numArg(1, 99, "Standard ACL number"), kw("interface", "Outside interface"), ifaceArg, kw("overload", "Overload translations")], (c, [acl, iface]) => {
    c.device.config.natOverloads = c.device.config.natOverloads.filter((r) => r.acl !== acl || r.outsideInterface !== iface);
  }, { devices: ["router"] }),
];

const routedIface = (c: Ctx) => c.console.ifaces.every((n) => c.device.findInterface(n)?.routed);
const IF_IP = kw("ip", "Interface Internet Protocol config commands");
const ADDRESS = kw("address", "Set the IP address of an interface");

const interfaceCommands: Entry[] = [
  cmd(ANY_IF, [kw("ipv6", "IPv6 interface configuration"), kw("ospf", "Enable IPv6 OSPF"), numArg(1, 65535, "OSPFv3 process ID"), kw("area", "OSPF area"), numArg(0, 4294967295, "OSPF area ID")], (c, [processId, area]) => {
    if (c.device.kind !== "router" || !c.device.config.ospfv3 || c.device.config.ospfv3.processId !== processId) { c.out.push("% OSPFv3 process is not configured."); return; }
    forEachIface(c, (name) => { c.device.ifaceConfig(name).ipv6OspfArea = area as number; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [NO, kw("ipv6", "IPv6 interface configuration"), kw("ospf", "Enable IPv6 OSPF")], (c) => forEachIface(c, (name) => { c.device.ifaceConfig(name).ipv6OspfArea = null; }), { devices: ["router"] }),
  cmd(ANY_IF, [kw("ip", "IP configuration"), kw("ospf", "OSPF interface commands"), kw("priority", "OSPF interface priority"), numArg(0, 255, "OSPF priority")], (c, [priority]) => forEachIface(c, (name) => { c.device.ifaceConfig(name).ospfPriority = priority as number; }), { devices: ["router"] }),
  cmd(ANY_IF, [kw("ip", "IP configuration"), kw("nat", "Network Address Translation"), kw("inside", "Mark as NAT inside")], (c) => forEachIface(c, (name) => { c.device.ifaceConfig(name).natRole = "inside"; }), { devices: ["router"] }),
  cmd(ANY_IF, [kw("ip", "IP configuration"), kw("nat", "Network Address Translation"), kw("outside", "Mark as NAT outside")], (c) => forEachIface(c, (name) => { c.device.ifaceConfig(name).natRole = "outside"; }), { devices: ["router"] }),
  cmd(ANY_IF, [NO, kw("ip", "IP configuration"), kw("nat", "Network Address Translation")], (c) => forEachIface(c, (name) => { c.device.ifaceConfig(name).natRole = null; }), { devices: ["router"] }),
  cmd(ANY_IF, [kw("standby", "Hot Standby Router Protocol"), numArg(0, 255, "HSRP group"), kw("ip", "Virtual IP address"), ipArg("Virtual IP address")], (c, [group, ip]) => {
    forEachIface(c, (name) => { const current = c.device.ifaceConfig(name).hsrp; c.device.ifaceConfig(name).hsrp = { group: group as number, ip: ip as Ipv4, priority: current?.priority ?? 100, preempt: current?.preempt ?? false }; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("standby", "Hot Standby Router Protocol"), numArg(0, 255, "HSRP group"), kw("priority", "HSRP priority"), numArg(0, 255, "Priority")], (c, [group, priority]) => {
    forEachIface(c, (name) => { const h = c.device.ifaceConfig(name).hsrp; if (h && h.group === group) h.priority = priority as number; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("standby", "Hot Standby Router Protocol"), numArg(0, 255, "HSRP group"), kw("preempt", "Preempt active router")], (c, [group]) => {
    forEachIface(c, (name) => { const h = c.device.ifaceConfig(name).hsrp; if (h && h.group === group) h.preempt = true; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("vrrp", "Virtual Router Redundancy Protocol"), numArg(1, 255, "VRRP group"), kw("ip", "Virtual IP address"), ipArg("Virtual IP address")], (c, [group, ip]) => {
    forEachIface(c, (name) => { const current = c.device.ifaceConfig(name).vrrp; c.device.ifaceConfig(name).vrrp = { group: group as number, ip: ip as Ipv4, priority: current?.priority ?? 100, preempt: current?.preempt ?? false }; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("vrrp", "Virtual Router Redundancy Protocol"), numArg(1, 255, "VRRP group"), kw("priority", "VRRP priority"), numArg(1, 254, "Priority")], (c, [group, priority]) => {
    forEachIface(c, (name) => { const v = c.device.ifaceConfig(name).vrrp; if (v && v.group === group) v.priority = priority as number; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("vrrp", "Virtual Router Redundancy Protocol"), numArg(1, 255, "VRRP group"), kw("preempt", "Preempt active router")], (c, [group]) => {
    forEachIface(c, (name) => { const v = c.device.ifaceConfig(name).vrrp; if (v && v.group === group) v.preempt = true; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("ipv6", "IPv6 interface configuration"), kw("address", "Set the IPv6 address"), wordArg("IPv6 address/prefix")], (c, [text]) => {
    const parsed = parseIpv6Prefix(text as string);
    if (!parsed) {
      c.out.push("% Invalid IPv6 address or prefix.");
      return;
    }
    forEachIface(c, (name) => {
      const addresses = c.device.ifaceConfig(name).ipv6Addresses;
      if (!addresses.some((a) => a.address === parsed.address && a.prefix === parsed.prefix)) addresses.push(parsed);
    });
  }),
  cmd(ANY_IF, [kw("glbp", "Gateway Load Balancing Protocol"), numArg(1, 1023, "GLBP group"), kw("ip", "Virtual IP address"), ipArg("Virtual IP address")], (c, [group, ip]) => {
    forEachIface(c, (name) => { const current = c.device.ifaceConfig(name).glbp; c.device.ifaceConfig(name).glbp = { group: group as number, ip: ip as Ipv4, priority: current?.priority ?? 100, preempt: current?.preempt ?? false }; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("glbp", "Gateway Load Balancing Protocol"), numArg(1, 1023, "GLBP group"), kw("priority", "GLBP priority"), numArg(1, 255, "Priority")], (c, [group, priority]) => {
    forEachIface(c, (name) => { const g = c.device.ifaceConfig(name).glbp; if (g && g.group === group) g.priority = priority as number; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [kw("glbp", "Gateway Load Balancing Protocol"), numArg(1, 1023, "GLBP group"), kw("preempt", "Preempt active router")], (c, [group]) => {
    forEachIface(c, (name) => { const g = c.device.ifaceConfig(name).glbp; if (g && g.group === group) g.preempt = true; });
  }, { devices: ["router"] }),
  cmd(ANY_IF, [NO, kw("ipv6", "IPv6 interface configuration"), kw("address", "Set the IPv6 address")], (c) => {
    forEachIface(c, (name) => { c.device.ifaceConfig(name).ipv6Addresses = []; });
  }),
  cmd(ANY_IF, [IF_IP, kw("access-group", "Apply an access list to an interface"), wordArg("ACL name or number"), kw("in", "Inbound packets")], (c, [number]) => {
    forEachIface(c, (name) => { c.device.ifaceConfig(name).accessGroupIn = String(number); });
  }, { when: routedIface }),
  cmd(ANY_IF, [IF_IP, kw("access-group", "Apply an access list to an interface"), wordArg("ACL name or number"), kw("out", "Outbound packets")], (c, [number]) => {
    forEachIface(c, (name) => { c.device.ifaceConfig(name).accessGroupOut = String(number); });
  }, { when: routedIface }),
  cmd(ANY_IF, [NO, IF_IP, kw("access-group", "Apply an access list to an interface"), wordArg("ACL name or number"), kw("in", "Inbound packets")], (c, [number]) => {
    forEachIface(c, (name) => { if (c.device.ifaceConfig(name).accessGroupIn === String(number)) c.device.ifaceConfig(name).accessGroupIn = null; });
  }, { when: routedIface }),
  cmd(ANY_IF, [NO, IF_IP, kw("access-group", "Apply an access list to an interface"), wordArg("ACL name or number"), kw("out", "Outbound packets")], (c, [number]) => {
    forEachIface(c, (name) => { if (c.device.ifaceConfig(name).accessGroupOut === String(number)) c.device.ifaceConfig(name).accessGroupOut = null; });
  }, { when: routedIface }),
  cmd(ANY_IF, [IF_IP, kw("helper-address", "Specify a destination address for DHCP relay"), ipArg("DHCP server address")], (c, [server]) => {
    forEachIface(c, (name) => {
      const helpers = c.device.ifaceConfig(name).helperAddresses;
      if (!helpers.includes(server as Ipv4)) helpers.push(server as Ipv4);
    });
  }, { when: routedIface }),
  cmd(ANY_IF, [NO, IF_IP, kw("helper-address", "Specify a destination address for DHCP relay"), ipArg("DHCP server address")], (c, [server]) => {
    forEachIface(c, (name) => {
      c.device.ifaceConfig(name).helperAddresses = c.device.ifaceConfig(name).helperAddresses.filter((ip) => ip !== server);
    });
  }, { when: routedIface }),
  cmd(ANY_IF, [IF_IP, ADDRESS, ipArg("IP address"), ipArg("IP subnet mask")], (c, [ip, mask]) => {
    const a = ip as Ipv4;
    const m = mask as Ipv4;
    const prefix = maskToPrefix(m);
    if (prefix === null || prefix === 0) {
      c.out.push(`Bad mask 0x${(m >>> 0).toString(16).toUpperCase()} for address ${formatIpv4(a)}`);
      return;
    }
    if (prefix < 31 && (a === networkOf(a, m) || a === broadcastOf(a, m))) {
      c.out.push(`Bad mask /${prefix} for address ${formatIpv4(a)}`);
      return;
    }
    forEachIface(c, (name) => {
      if (splitSubinterface(name) && !c.device.ifaceConfig(name).encapsulation) {
        c.out.push(
          "% Configuring IP routing on a LAN subinterface is only allowed if that",
          "subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,",
          "or ISL vLAN.",
          "",
        );
        return;
      }
      const clash = c.device.overlapping(name, a, m);
      if (clash) {
        c.out.push(`% ${formatIpv4(networkOf(a, m))} overlaps with ${clash}`);
        return;
      }
      const cfg = c.device.ifaceConfig(name);
      cfg.ip = a;
      cfg.mask = m;
    });
  }, { when: routedIface }),
  cmd(ANY_IF, [NO, IF_IP, ADDRESS], (c) => {
    forEachIface(c, (name) => {
      const cfg = c.device.ifaceConfig(name);
      cfg.ip = null;
      cfg.mask = null;
    });
  }, { when: routedIface }),
  cmd(IF, [kw("cdp", "CDP interface subcommands"), kw("enable", "Enable CDP on interface")], (c) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).cdp = true;
    }),
  { when: (c) => c.console.ifaces.every((n) => c.device.findInterface(n)?.port) }),
  cmd(IF, [NO, kw("cdp", "CDP interface subcommands"), kw("enable", "Enable CDP on interface")], (c) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).cdp = false;
      const port = c.device.findInterface(n)?.port;
      if (port) c.device.cdpNeighbors.delete(port);
    }),
  { when: (c) => c.console.ifaces.every((n) => c.device.findInterface(n)?.port) }),
  cmd(ANY_IF, [kw("shutdown", "Shutdown the selected interface")], (c) => forEachIface(c, (n) => c.device.setShutdown(n, true))),
  cmd(ANY_IF, [NO, kw("shutdown", "Shutdown the selected interface")], (c) => forEachIface(c, (n) => c.device.setShutdown(n, false))),
  cmd(ANY_IF, [kw("description", "Interface specific description"), lineArg("Up to 240 characters describing this interface")], (c, [text]) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).description = (text as string).slice(0, 240);
    }),
  ),
  cmd(ANY_IF, [NO, kw("description", "Interface specific description")], (c) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).description = null;
    }),
  ),
];

const lineCommands: Entry[] = [
  cmd(LINE, [kw("password", "Set a password"), wordArg("The UNENCRYPTED (cleartext) line password", "LINE")], (c, [p]) => {
    selectedLines(c).password = setPassword(c, p as string);
  }),
  cmd(ANY_IF, [kw("ipv6", "IPv6 interface commands"), kw("traffic-filter", "Apply an IPv6 access list"), wordArg("IPv6 ACL name"), kw("in", "Inbound packets")], (c, [name]) => forEachIface(c, (iface) => { c.device.ifaceConfig(iface).ipv6AccessGroupIn = name as string; })),
  cmd(ANY_IF, [kw("ipv6", "IPv6 interface commands"), kw("traffic-filter", "Apply an IPv6 access list"), wordArg("IPv6 ACL name"), kw("out", "Outbound packets")], (c, [name]) => forEachIface(c, (iface) => { c.device.ifaceConfig(iface).ipv6AccessGroupOut = name as string; })),
  cmd(ANY_IF, [NO, kw("ipv6", "IPv6 interface commands"), kw("traffic-filter", "Apply an IPv6 access list"), wordArg("IPv6 ACL name"), kw("in", "Inbound packets")], (c) => forEachIface(c, (iface) => { c.device.ifaceConfig(iface).ipv6AccessGroupIn = null; })),
  cmd(ANY_IF, [NO, kw("ipv6", "IPv6 interface commands"), kw("traffic-filter", "Apply an IPv6 access list"), wordArg("IPv6 ACL name"), kw("out", "Outbound packets")], (c) => forEachIface(c, (iface) => { c.device.ifaceConfig(iface).ipv6AccessGroupOut = null; })),
  cmd(LINE, [NO, kw("password", "Set a password")], (c) => {
    selectedLines(c).password = null;
  }),
  cmd(LINE, [kw("login", "Enable password checking")], (c) => {
    selectedLines(c).login = true;
    selectedLines(c).loginLocal = false;
  }),
  cmd(LINE, [NO, kw("login", "Enable password checking")], (c) => {
    selectedLines(c).login = false;
    selectedLines(c).loginLocal = false;
  }),
  cmd(LINE, [kw("login", "Enable password checking"), kw("local", "Local user database")], (c) => {
    selectedLines(c).login = true;
    selectedLines(c).loginLocal = true;
  }),
  cmd(LINE, [NO, kw("login", "Enable password checking"), kw("local", "Local user database")], (c) => {
    selectedLines(c).loginLocal = false;
  }),
  cmd(LINE, [kw("transport", "Define transport protocols for line"), kw("input", "Define which protocols to use to connect to the line"), kw("all", "All protocols")], (c) => { selectedLines(c).transportInput = "all"; }),
  cmd(LINE, [kw("transport", "Define which protocols to use to connect to the line"), kw("input", "Define which protocols to use to connect to the line"), kw("none", "No protocols")], (c) => { selectedLines(c).transportInput = "none"; }),
  cmd(LINE, [kw("transport", "Define which protocols to use to connect to the line"), kw("input", "Define which protocols to use to connect to the line"), kw("ssh", "TCP/IP SSH protocol")], (c) => { selectedLines(c).transportInput = "ssh"; }),
  cmd(LINE, [kw("transport", "Define which protocols to use to connect to the line"), kw("input", "Define which protocols to use to connect to the line"), kw("telnet", "TCP/IP Telnet protocol")], (c) => { selectedLines(c).transportInput = "telnet"; }),
  cmd(LINE, [kw("logging", "Modify message logging facilities"), kw("synchronous", "Synchronized message output")], (c) => {
    selectedLines(c).loggingSynchronous = true;
  }),
  cmd(LINE, [NO, kw("logging", "Modify message logging facilities"), kw("synchronous", "Synchronized message output")], (c) => {
    selectedLines(c).loggingSynchronous = false;
  }),
  cmd(LINE, [kw("exec-timeout", "Set the EXEC timeout"), numArg(0, 35791, "Timeout in minutes")], (c, [m]) => {
    selectedLines(c).execTimeout = [m as number, 0];
  }),
  cmd(LINE, [kw("exec-timeout", "Set the EXEC timeout"), numArg(0, 35791, "Timeout in minutes"), numArg(0, 2147483, "Timeout in seconds")], (c, [m, s]) => {
    selectedLines(c).execTimeout = [m as number, s as number];
  }),
];

// ---- DHCP server --------------------------------------------------------------

const DHCP_KW = kw("dhcp", "Configure DHCP server and relay parameters");
const POOL = kw("pool", "Configure DHCP address pools");
/** Under `show ip` the same words carry different help. */
const SHOW_DHCP = kw("dhcp", "Show items in the DHCP database");
const EXCLUDED = kw("excluded-address", "Prevent DHCP from assigning certain addresses");

function currentPool(c: Ctx): DhcpPool {
  return c.device.config.dhcpPools.find((p) => p.name === c.console.dhcpPool)!;
}

/** `network` takes a dotted mask or a `/24` style prefix length. */
const poolMaskArg: Arg<Ctx> = {
  type: "arg",
  name: "/nn or A.B.C.D",
  help: "Network mask or prefix length",
  match: (w, i) => {
    const ip = parseIpv4(w[i].text);
    if (ip !== null) return { consumed: 1, value: ip };
    const m = /^\/(\d{1,2})$/.exec(w[i].text);
    if (!m || Number(m[1]) > 32) return null;
    const n = Number(m[1]);
    return { consumed: 1, value: n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0 };
  },
  partial: (t) => /^(\/\d{0,2}|\d{1,3}(\.\d{0,3}){0,3})$/.test(t),
};

/** With no mask, `network` uses the address's classful mask. */
function classfulMask(ip: Ipv4): Ipv4 {
  const first = ip >>> 24;
  return first < 128 ? 0xff000000 : first < 192 ? 0xffff0000 : 0xffffff00;
}

function setPoolNetwork(c: Ctx, ip: Ipv4, mask: Ipv4): void {
  if (maskToPrefix(mask) === null) {
    c.out.push("% Invalid mask");
    return;
  }
  const pool = currentPool(c);
  const network = networkOf(ip, mask);
  const other = c.device.config.dhcpPools.find((p) => p !== pool && p.network === network && p.mask === mask);
  if (other) {
    c.out.push(`% ${formatIpv4(network)}/${maskToPrefix(mask)} is already in use by pool ${other.name}`);
    return;
  }
  pool.network = network;
  pool.mask = mask;
}

/** IOS takes up to eight addresses after `default-router` and `dns-server`. */
function addressLists(word: string, help: string, argHelp: string, apply: (c: Ctx, ips: Ipv4[]) => void): Entry[] {
  const out: Entry[] = [];
  for (let n = 1; n <= 8; n++) {
    const args = Array.from({ length: n }, () => ipArg(argHelp, "Hostname or A.B.C.D"));
    out.push(cmd(DHCP, [kw(word, help), ...args], (c, ips) => apply(c, ips as Ipv4[])));
  }
  return out;
}

const dhcpCommands: Entry[] = [
  cmd(CONFIG, [IP, DHCP_KW, POOL, wordArg("Pool name")], (c, [name]) => {
    const pools = c.device.config.dhcpPools;
    if (!pools.some((p) => p.name === name)) pools.push(newDhcpPool(name as string));
    c.console.dhcpPool = name as string;
    c.console.setMode("dhcp-config");
  }, { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, DHCP_KW, POOL, wordArg("Pool name")], (c, [name]) => {
    const pools = c.device.config.dhcpPools;
    const i = pools.findIndex((p) => p.name === name);
    if (i < 0) {
      c.out.push(`%DHCP pool ${name} does not exist.`);
      return;
    }
    pools.splice(i, 1);
  }, { devices: ["router"] }),
  cmd(CONFIG, [IP, DHCP_KW, EXCLUDED, ipArg("Low IP address")], (c, [low]) => addExcluded(c, low as Ipv4, low as Ipv4), { devices: ["router"] }),
  cmd(CONFIG, [IP, DHCP_KW, EXCLUDED, ipArg("Low IP address"), ipArg("High IP address")], (c, [low, high]) => addExcluded(c, low as Ipv4, high as Ipv4), { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, DHCP_KW, EXCLUDED, ipArg("Low IP address")], (c, [low]) => removeExcluded(c, low as Ipv4, low as Ipv4), { devices: ["router"] }),
  cmd(CONFIG, [NO, IP, DHCP_KW, EXCLUDED, ipArg("Low IP address"), ipArg("High IP address")], (c, [low, high]) =>
    removeExcluded(c, low as Ipv4, high as Ipv4),
  { devices: ["router"] }),
  cmd(DHCP, [kw("network", "Network number and mask"), ipArg("Network number in dotted-decimal notation")], (c, [ip]) =>
    setPoolNetwork(c, ip as Ipv4, classfulMask(ip as Ipv4)),
  ),
  cmd(DHCP, [kw("network", "Network number and mask"), ipArg("Network number in dotted-decimal notation"), poolMaskArg], (c, [ip, mask]) =>
    setPoolNetwork(c, ip as Ipv4, mask as Ipv4),
  ),
  cmd(DHCP, [NO, kw("network", "Network number and mask")], (c) => {
    const pool = currentPool(c);
    pool.network = null;
    pool.mask = null;
  }),
  ...addressLists("default-router", "Default routers", "Router's name or IP address", (c, ips) => {
    currentPool(c).defaultRouters = ips;
  }),
  cmd(DHCP, [NO, kw("default-router", "Default routers")], (c) => {
    currentPool(c).defaultRouters = [];
  }),
  ...addressLists("dns-server", "DNS servers", "Server's name or IP address", (c, ips) => {
    currentPool(c).dnsServers = ips;
  }),
  cmd(DHCP, [NO, kw("dns-server", "DNS servers")], (c) => {
    currentPool(c).dnsServers = [];
  }),
  cmd(DHCP, [kw("domain-name", "Domain name"), wordArg("Domain name")], (c, [name]) => {
    currentPool(c).domainName = name as string;
  }),
  cmd(DHCP, [NO, kw("domain-name", "Domain name")], (c) => {
    currentPool(c).domainName = null;
  }),
  cmd(DHCP, [kw("lease", "Address lease time"), numArg(0, 365, "Days")], (c, [d]) => {
    currentPool(c).lease = [d as number, 0, 0];
  }),
  cmd(DHCP, [kw("lease", "Address lease time"), numArg(0, 365, "Days"), numArg(0, 23, "Hours")], (c, [d, h]) => {
    currentPool(c).lease = [d as number, h as number, 0];
  }),
  cmd(DHCP, [kw("lease", "Address lease time"), numArg(0, 365, "Days"), numArg(0, 23, "Hours"), numArg(0, 59, "Minutes")], (c, [d, h, m]) => {
    currentPool(c).lease = [d as number, h as number, m as number];
  }),
  cmd(DHCP, [kw("lease", "Address lease time"), kw("infinite", "Infinite lease")], (c) => {
    currentPool(c).lease = null;
  }),
  cmd(DHCP, [NO, kw("lease", "Address lease time")], (c) => {
    currentPool(c).lease = [1, 0, 0];
  }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), SHOW_DHCP, kw("binding", "DHCP address bindings")], (c) => c.out.push(...show.showDhcpBinding(c.device as Router)), {
    devices: ["router"],
  }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), SHOW_DHCP, kw("pool", "DHCP pools information")], (c) => c.out.push(...show.showDhcpPool(c.device as Router)), { devices: ["router"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), SHOW_DHCP, kw("conflict", "DHCP address conflicts")], (c) => c.out.push(...show.showDhcpConflict(c.device as Router)), {
    devices: ["router"],
  }),
  cmd(ENABLE, [kw("clear", "Reset functions"), kw("ip", "IP"), SHOW_DHCP, kw("binding", "DHCP address bindings"), kw("*", "Clear all automatic bindings")], (c) =>
    (c.device as Router).dhcp.clear(),
  { devices: ["router"] }),
  cmd(ENABLE, [kw("clear", "Reset functions"), kw("ip", "IP"), SHOW_DHCP, kw("binding", "DHCP address bindings"), ipArg("Clear a specific binding")], (c, [ip]) =>
    (c.device as Router).dhcp.clear(ip as Ipv4),
  { devices: ["router"] }),
  cmd(ENABLE, [kw("clear", "Reset functions"), kw("ip", "IP"), SHOW_DHCP, kw("conflict", "DHCP address conflicts"), kw("*", "Clear all address conflicts")], (c) =>
    (c.device as Router).dhcp.clearConflicts(),
  { devices: ["router"] }),
];

function addExcluded(c: Ctx, low: Ipv4, high: Ipv4): void {
  if (high < low) {
    c.out.push("% Invalid range");
    return;
  }
  const list = c.device.config.dhcpExcluded;
  if (!list.some((r) => r.low === low && r.high === high)) list.push({ low, high });
}

function removeExcluded(c: Ctx, low: Ipv4, high: Ipv4): void {
  const list = c.device.config.dhcpExcluded;
  const i = list.findIndex((r) => r.low === low && r.high === high);
  if (i < 0) c.out.push(`% Range [${formatIpv4(low)}, ${formatIpv4(high)}] is not in the database.`);
  else list.splice(i, 1);
}

// ---- VLANs, trunks and router-on-a-stick -------------------------------------------

function sw(c: Ctx): Switch {
  return c.device as Switch;
}

/** Applies a switchport change to every selected port, then lets DTP and spanning tree catch up. */
function eachSwitchport(c: Ctx, fn: (sp: NonNullable<ReturnType<Ctx["device"]["ifaceConfig"]>["switchport"]>) => string | void): void {
  for (const name of c.console.ifaces) {
    const error = fn(c.device.ifaceConfig(name).switchport!);
    if (error) {
      const short = c.device.findInterface(name)?.port?.shortName ?? name;
      c.out.push(error === NEGOTIATE_CONFLICT ? `${error} on this interface: ${short}` : error);
      break;
    }
  }
  sw(c).vlanConfigChanged();
}

const physicalPort = (c: Ctx) => c.console.ifaces.every((n) => c.device.findInterface(n)?.port);
const subinterface = (c: Ctx) => c.console.ifaces.every((n) => splitSubinterface(n));
const NEGOTIATE_CONFLICT = "Command rejected: Conflict between 'nonegotiate' and 'dynamic' status";

const SWITCHPORT = kw("switchport", "Set switching mode characteristics");
const SP_MODE = kw("mode", "Set trunking mode of the interface");
const SP_ACCESS = kw("access", "Set access mode characteristics of the interface");
const SP_VOICE = kw("voice", "Voice appliance attributes");
const SP_TRUNK = kw("trunk", "Set trunking characteristics of the interface");
const SP_NATIVE = kw("native", "Set trunking native characteristics when interface is in trunking mode");
const SP_ALLOWED = kw("allowed", "Set allowed VLAN characteristics when interface is in trunking mode");
const SP_ALLOWED_VLAN = kw("vlan", "Set allowed VLANs when interface is in trunking mode");
const NONEGOTIATE = kw("nonegotiate", "Device will not engage in negotiation protocol on this interface");
const CHANNEL_GROUP = kw("channel-group", "EtherChannel configuration");
const VLAN_KW = kw("vlan", "Vlan commands");

function setMode(c: Ctx, mode: "access" | "trunk" | "dynamic auto" | "dynamic desirable"): void {
  const s = sw(c);
  const ports = c.console.ifaces.map((n) => c.device.findInterface(n)?.port).filter((p) => !!p);
  const before = ports.map((p) => ({ p, op: s.operationalMode(p), admin: s.switchport(p).mode }));
  eachSwitchport(c, (sp) => {
    if (mode.startsWith("dynamic") && sp.nonegotiate) return NEGOTIATE_CONFLICT;
    sp.mode = mode;
  });
  // A trunk that stays a trunk still bounces when its mode is changed (captured: dynamic auto to trunk).
  // A change of operational mode bounces too, but syncVlans already handles that.
  for (const { p, op, admin } of before) {
    if (op === "trunk" && s.operationalMode(p) === "trunk" && admin !== mode) c.device.network?.bounceProtocol(p);
  }
}

function setAllowed(c: Ctx, change: (current: number[] | null) => number[] | null): void {
  eachSwitchport(c, (sp) => {
    const next = change(sp.allowed);
    sp.allowed = next && next.length === 4094 ? null : next;
  });
}

function setChannel(c: Ctx, group: number, mode: "on" | "active" | "passive" | "desirable" | "auto"): void {
  const selected = c.console.ifaces.map((name) => c.device.findInterface(name)?.port).filter((p): p is NonNullable<typeof p> => !!p);
  for (const port of selected) sw(c).setChannelGroup(port, group, mode);
}

const ALL_VLANS = Array.from({ length: 4094 }, (_, i) => i + 1);

const switchCommands: Entry[] = [
  cmd(IF, [NO, SWITCHPORT], (c) => {
    for (const name of c.console.ifaces) c.device.ifaceConfig(name).switchport = undefined;
    sw(c).vlanConfigChanged();
  }, { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_MODE, kw("access", "Set trunking mode to ACCESS unconditionally")], (c) => setMode(c, "access"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_MODE, kw("trunk", "Set trunking mode to TRUNK unconditionally")], (c) => setMode(c, "trunk"), { devices: ["switch"], when: physicalPort }),
  cmd(
    IF,
    [SWITCHPORT, SP_MODE, kw("dynamic", "Set trunking mode to dynamically negotiate access or trunk mode"), kw("auto", "Set trunking mode dynamic negotiation parameter to AUTO")],
    (c) => setMode(c, "dynamic auto"),
    { devices: ["switch"], when: physicalPort },
  ),
  cmd(
    IF,
    [SWITCHPORT, SP_MODE, kw("dynamic", "Set trunking mode to dynamically negotiate access or trunk mode"), kw("desirable", "Set trunking mode dynamic negotiation parameter to DESIRABLE")],
    (c) => setMode(c, "dynamic desirable"),
    { devices: ["switch"], when: physicalPort },
  ),
  cmd(IF, [NO, SWITCHPORT, SP_MODE], (c) => setMode(c, "dynamic auto"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_ACCESS, kw("vlan", "Set VLAN when interface is in access mode"), numArg(1, 4094, "VLAN ID of the VLAN when this port is in access mode")], (c, [v]) => {
    const vlan = v as number;
    const s = sw(c);
    // A missing VLAN gets created for you, the one place IOS is that helpful.
    if (!s.vlans.has(vlan) && vlan <= MAX_NORMAL_VLAN) {
      c.out.push(`% Access VLAN does not exist. Creating vlan ${vlan}`);
      s.createVlan(vlan);
    }
    eachSwitchport(c, (sp) => {
      sp.accessVlan = vlan;
    });
  }, { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, SP_ACCESS, kw("vlan", "Set VLAN when interface is in access mode")], (c) =>
    eachSwitchport(c, (sp) => {
      sp.accessVlan = 1;
    }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_VOICE, kw("vlan", "Set VLAN when interface is in voice mode"), numArg(1, 4094, "VLAN ID of the voice VLAN")], (c, [v]) => {
    const vlan = v as number;
    const s = sw(c);
    if (!s.vlans.has(vlan) && vlan <= MAX_NORMAL_VLAN) {
      c.out.push(`% Voice VLAN does not exist. Creating vlan ${vlan}`);
      s.createVlan(vlan);
    }
    eachSwitchport(c, (sp) => { sp.voiceVlan = vlan; });
  }, { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, SP_VOICE, kw("vlan", "Set VLAN when interface is in voice mode")], (c) =>
    eachSwitchport(c, (sp) => { sp.voiceVlan = null; }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_NATIVE, kw("vlan", "Set native VLAN when interface is in trunking mode"), numArg(1, 4094, "VLAN ID of the native VLAN when this port is in trunking mode")], (c, [v]) =>
    eachSwitchport(c, (sp) => {
      sp.nativeVlan = v as number;
    }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, SP_TRUNK, SP_NATIVE, kw("vlan", "Set native VLAN when interface is in trunking mode")], (c) =>
    eachSwitchport(c, (sp) => {
      sp.nativeVlan = 1;
    }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, vlanListArg("VLAN IDs of the allowed VLANs when this port is in trunking mode", "WORD")], (c, [list]) =>
    setAllowed(c, () => list as number[]),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, kw("add", "add VLANs to the current list"), vlanListArg("VLAN IDs of the allowed VLANs when this port is in trunking mode", "WORD")], (c, [list]) =>
    setAllowed(c, (cur) => (cur === null ? null : [...new Set([...cur, ...(list as number[])])].sort((a, b) => a - b))),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, kw("remove", "remove VLANs from the current list"), vlanListArg("VLAN IDs of disallowed VLANS when this port is in trunking mode", "WORD")], (c, [list]) =>
    setAllowed(c, (cur) => (cur ?? ALL_VLANS).filter((v) => !(list as number[]).includes(v))),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, kw("except", "all VLANs except the following"), vlanListArg("VLAN IDs of disallowed VLANS when this port is in trunking mode", "WORD")], (c, [list]) =>
    setAllowed(c, () => ALL_VLANS.filter((v) => !(list as number[]).includes(v))),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, kw("all", "all VLANs")], (c) => setAllowed(c, () => null), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN, kw("none", "no VLANs")], (c) => setAllowed(c, () => []), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, SP_TRUNK, SP_ALLOWED, SP_ALLOWED_VLAN], (c) => setAllowed(c, () => null), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, NONEGOTIATE], (c) =>
    eachSwitchport(c, (sp) => {
      if (sp.mode.startsWith("dynamic")) return NEGOTIATE_CONFLICT;
      sp.nonegotiate = true;
    }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, NONEGOTIATE], (c) =>
    eachSwitchport(c, (sp) => {
      sp.nonegotiate = false;
    }),
  { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features")], (c) => eachSwitchport(c, (sp) => { sp.portSecurity = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, SWITCHPORT, kw("port-security", "Control port security features")], (c) => eachSwitchport(c, (sp) => { sp.portSecurity = false; sp.secureMacs = []; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features"), kw("maximum", "Max secure addresses"), numArg(1, 1024, "Maximum secure addresses")], (c, [max]) => eachSwitchport(c, (sp) => { sp.portSecurityMaximum = max as number; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features"), kw("violation", "Security violation mode"), kw("shutdown", "Shutdown the port" )], (c) => eachSwitchport(c, (sp) => { sp.portSecurityViolation = "shutdown"; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features"), kw("violation", "Security violation mode"), kw("restrict", "Drop and count violating traffic" )], (c) => eachSwitchport(c, (sp) => { sp.portSecurityViolation = "restrict"; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features"), kw("violation", "Security violation mode"), kw("protect", "Drop violating traffic" )], (c) => eachSwitchport(c, (sp) => { sp.portSecurityViolation = "protect"; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [SWITCHPORT, kw("port-security", "Control port security features"), kw("mac-address", "Secure MAC address"), kw("sticky", "Learn secure addresses dynamically")], (c) => eachSwitchport(c, (sp) => { sp.portSecuritySticky = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("trust", "Trust DHCP messages from this interface")], (c) => eachSwitchport(c, (sp) => { sp.dhcpTrust = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("trust", "Trust DHCP messages from this interface")], (c) => eachSwitchport(c, (sp) => { sp.dhcpTrust = false; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("limit", "DHCP snooping rate limit"), kw("rate", "DHCP packet rate"), numArg(1, 2048, "Packets per second")], (c, [rate]) => eachSwitchport(c, (sp) => { sp.dhcpRateLimit = rate as number; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("limit", "DHCP snooping rate limit")], (c) => eachSwitchport(c, (sp) => { sp.dhcpRateLimit = null; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [IP, kw("arp", "Configure ARP parameters"), kw("inspection", "Dynamic ARP inspection"), kw("trust", "Trust ARP packets from this interface")], (c) => eachSwitchport(c, (sp) => { sp.arpInspectionTrust = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, IP, kw("arp", "Configure ARP parameters"), kw("inspection", "Dynamic ARP inspection"), kw("trust", "Trust ARP packets from this interface")], (c) => eachSwitchport(c, (sp) => { sp.arpInspectionTrust = false; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [STP, kw("portfast", "Enable edge port behavior")], (c) => eachSwitchport(c, (sp) => { sp.portfast = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, STP, kw("portfast", "Enable edge port behavior")], (c) => eachSwitchport(c, (sp) => { sp.portfast = false; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [STP, kw("bpduguard", "Enable BPDU Guard"), kw("enable", "Enable BPDU Guard")], (c) => eachSwitchport(c, (sp) => { sp.bpduGuard = true; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, STP, kw("bpduguard", "Enable BPDU Guard"), kw("enable", "Enable BPDU Guard")], (c) => eachSwitchport(c, (sp) => { sp.bpduGuard = false; }), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [CHANNEL_GROUP, numArg(1, 64, "Channel group number"), kw("mode", "EtherChannel mode"), kw("on", "Force EtherChannel" )], (c, [group]) => setChannel(c, group as number, "on"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [CHANNEL_GROUP, numArg(1, 64, "Channel group number"), kw("mode", "EtherChannel mode"), kw("active", "LACP active" )], (c, [group]) => setChannel(c, group as number, "active"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [CHANNEL_GROUP, numArg(1, 64, "Channel group number"), kw("mode", "EtherChannel mode"), kw("passive", "LACP passive" )], (c, [group]) => setChannel(c, group as number, "passive"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [CHANNEL_GROUP, numArg(1, 64, "Channel group number"), kw("mode", "EtherChannel mode"), kw("desirable", "PAgP desirable" )], (c, [group]) => setChannel(c, group as number, "desirable"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [CHANNEL_GROUP, numArg(1, 64, "Channel group number"), kw("mode", "EtherChannel mode"), kw("auto", "PAgP auto" )], (c, [group]) => setChannel(c, group as number, "auto"), { devices: ["switch"], when: physicalPort }),
  cmd(IF, [NO, CHANNEL_GROUP], (c) => eachSwitchport(c, (sp) => { sp.channelGroup = null; sp.channelMode = null; }), { devices: ["switch"], when: physicalPort }),

  cmd(CONFIG, [VLAN_KW, vlanListArg("ISL VLAN IDs 1-4094")], (c, [list]) => {
    if (sw(c).config.vtpMode === "client") {
      c.out.push("% VLAN configuration not allowed when device is in VTP client mode.");
      return;
    }
    c.console.vlanIds = list as number[];
    c.console.vlanName = null;
    c.console.setMode("config-vlan");
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, VLAN_KW, vlanListArg("ISL VLAN IDs 1-4094")], (c, [list]) => {
    if (sw(c).config.vtpMode === "client") {
      c.out.push("% VLAN configuration not allowed when device is in VTP client mode.");
      return;
    }
    for (const id of list as number[]) {
      if (isDefaultVlan(id)) c.out.push(`%Default VLAN ${id} may not be deleted.`);
      else sw(c).deleteVlan(id);
    }
  }, { devices: ["switch"] }),
  cmd(VLAN_MODE, [kw("name", "Ascii name of the VLAN"), wordArg("The ascii name for the VLAN")], (c, [name]) => {
    // IOS refuses on the spot for default VLANs; the others get the name when you leave the mode.
    for (const id of c.console.vlanIds.filter(isDefaultVlan)) c.out.push(`%Default VLAN ${id} may not have its name changed.`);
    c.console.vlanName = (name as string).slice(0, 32);
  }),

  cmd(CONFIG, [kw("vtp", "Configure VTP domain parameters"), kw("mode", "Configure the device VTP mode"), kw("server", "Set VTP server mode")], (c) => {
    sw(c).config.vtpMode = "server";
  }, { devices: ["switch"] }),
  cmd(CONFIG, [kw("vtp", "Configure VTP domain parameters"), kw("mode", "Configure the device VTP mode"), kw("client", "Set VTP client mode")], (c) => {
    sw(c).config.vtpMode = "client";
  }, { devices: ["switch"] }),
  cmd(CONFIG, [kw("vtp", "Configure VTP domain parameters"), kw("mode", "Configure the device VTP mode"), kw("transparent", "Set VTP transparent mode")], (c) => {
    sw(c).config.vtpMode = "transparent";
  }, { devices: ["switch"] }),
  cmd(CONFIG, [kw("vtp", "Configure VTP domain parameters"), kw("domain", "Set the VTP administrative domain"), wordArg("VTP domain name")], (c, [domain]) => {
    sw(c).config.vtpDomain = domain as string;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, kw("vtp", "Configure VTP domain parameters"), kw("domain", "Set the VTP administrative domain")], (c) => {
    sw(c).config.vtpDomain = "";
  }, { devices: ["switch"] }),
  cmd(CONFIG, [IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("vlan", "Enable DHCP snooping on VLANs"), vlanListArg("VLAN IDs")], (c, [vlans]) => {
    sw(c).config.dhcpSnoopingVlans = vlans as number[];
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping"), kw("vlan", "Enable DHCP snooping on VLANs"), vlanListArg("VLAN IDs")], (c) => {
    sw(c).config.dhcpSnoopingVlans = [];
  }, { devices: ["switch"] }),
  cmd(CONFIG, [IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping")], (c) => {
    sw(c).config.dhcpSnooping = true;
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, IP, kw("dhcp", "Configure DHCP parameters"), kw("snooping", "DHCP snooping")], (c) => {
    sw(c).config.dhcpSnooping = false;
    sw(c).config.dhcpSnoopingBindings = [];
  }, { devices: ["switch"] }),
  cmd(CONFIG, [IP, kw("arp", "Configure ARP parameters"), kw("inspection", "Dynamic ARP inspection"), kw("vlan", "Enable inspection on VLANs"), vlanListArg("VLAN IDs")], (c, [vlans]) => {
    sw(c).config.arpInspectionVlans = vlans as number[];
  }, { devices: ["switch"] }),
  cmd(CONFIG, [NO, IP, kw("arp", "Configure ARP parameters"), kw("inspection", "Dynamic ARP inspection"), kw("vlan", "Enable inspection on VLANs"), vlanListArg("VLAN IDs")], (c) => {
    sw(c).config.arpInspectionVlans = [];
  }, { devices: ["switch"] }),
  cmd(VLAN_MODE, [NO, kw("name", "Ascii name of the VLAN")], (c) => {
    c.console.vlanName = null;
  }),

  cmd(
    SUBIF,
    [kw("encapsulation", "Set encapsulation type for an interface"), kw("dot1Q", "IEEE 802.1Q Virtual LAN"), numArg(1, 4094, "IEEE 802.1Q VLAN ID")],
    (c, [v]) => setEncapsulation(c, v as number, false),
    { devices: ["router"], when: subinterface },
  ),
  cmd(
    SUBIF,
    [kw("encapsulation", "Set encapsulation type for an interface"), kw("dot1Q", "IEEE 802.1Q Virtual LAN"), numArg(1, 4094, "IEEE 802.1Q VLAN ID"), kw("native", "Make this as native vlan")],
    (c, [v]) => setEncapsulation(c, v as number, true),
    { devices: ["router"], when: subinterface },
  ),

  cmd(EXEC, [SHOW, kw("vlan", "VTP VLAN status")], (c) => c.out.push(...show.showVlan(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("vtp", "VTP information"), kw("status", "VTP domain status")], (c) => c.out.push(...show.showVtpStatus(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("dhcp", "DHCP information"), kw("snooping", "DHCP snooping status"), kw("binding", "DHCP snooping bindings")], (c) => c.out.push(...show.showIpDhcpSnoopingBinding(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("dhcp", "DHCP information"), kw("snooping", "DHCP snooping status"), kw("statistics", "DHCP snooping statistics")], (c) => c.out.push(...show.showIpDhcpSnoopingStatistics(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("dhcp", "DHCP information"), kw("snooping", "DHCP snooping status")], (c) => c.out.push(...show.showIpDhcpSnooping(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("arp", "ARP information"), kw("inspection", "Dynamic ARP inspection")], (c) => c.out.push(...show.showIpArpInspection(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("arp", "ARP information"), kw("inspection", "Dynamic ARP inspection"), kw("statistics", "DAI statistics")], (c) => c.out.push(...show.showIpArpInspectionStatistics(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), kw("trunk", "Show interface trunk information")], (c) => c.out.push(...show.showInterfacesTrunk(sw(c))), {
    devices: ["switch"],
  }),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), kw("status", "Interface status and configuration")], (c) => c.out.push(...show.showInterfacesStatus(sw(c))), {
    devices: ["switch"],
  }),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), kw("switchport", "Show interface switchport information")], (c) =>
    c.out.push(...show.showInterfacesSwitchport(sw(c))),
  { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("port-security", "Port security status")], (c) => c.out.push(...show.showPortSecurity(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("port-security", "Port security status"), kw("interface", "Port security interface status"), ifaceArg], (c, [name]) => c.out.push(...show.showPortSecurity(sw(c), name as string)), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("etherchannel", "EtherChannel information"), kw("summary", "EtherChannel summary")], (c) => c.out.push(...show.showEtherchannelSummary(sw(c))), { devices: ["switch"] }),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), ifaceArg, kw("switchport", "Show interface switchport information")], (c, [name]) =>
    c.out.push(...show.showInterfacesSwitchport(sw(c), name as string)),
  { devices: ["switch"] }),
  cmd(ENABLE, [kw("delete", "Delete a file"), wordArg("File to delete", "WORD")], (c, [file]) => deleteFile(c, file as string), { devices: ["switch"] }),
];

function setEncapsulation(c: Ctx, vlan: number, native: boolean): void {
  const name = c.console.ifaces[0];
  const parent = splitSubinterface(name)![0];
  const router = c.device as Router;
  for (const other of router.subinterfacesOf(parent)) {
    if (other !== name && router.config.interfaces[other].encapsulation?.vlan === vlan) {
      c.out.push(
        `Configuration of multiple subinterfaces of the same main interface with the same VID (${vlan}) is not permitted.`,
        `This VID is already configured on ${other}.`,
      );
      return;
    }
  }
  c.device.ifaceConfig(name).encapsulation = { vlan, native };
}

/** `delete flash:vlan.dat`, with both of IOS's questions. */
function deleteFile(c: Ctx, file: string): void {
  const s = sw(c);
  const suggested = file.replace(/^flash:/i, "").replace(/^\//, "");
  c.console.ask(`Delete filename [${suggested}]? `, (text) => {
    const name = text.trim() || suggested;
    c.console.ask(`Delete flash:/${name}? [confirm]`, (answer) => {
      if (!CONFIRM(answer)) return;
      if (name !== "vlan.dat" || !s.vlanDat) {
        c.console.print(`%Error deleting flash:/${name} (No such file or directory)`);
        return;
      }
      // The VLANs stay in memory until the next reload.
      s.vlanDat = false;
    });
  });
}

const ospfCommands: Entry[] = [
  cmd(ROUTER_CFG, [kw("router-id", "Override the OSPF router identifier"), ipArg("OSPF router ID")], (c, [routerId]) => {
    if (c.device.config.ospf) c.device.config.ospf.routerId = routerId as Ipv4;
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [NO, kw("router-id", "Override the OSPF router identifier")], (c) => {
    if (c.device.config.ospf) c.device.config.ospf.routerId = null;
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [kw("default-information", "Control distribution of a default route"), kw("originate", "Originate a default route")], (c) => {
    if (c.device.config.ospf) c.device.config.ospf.defaultInformation = true;
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [NO, kw("default-information", "Control distribution of a default route"), kw("originate", "Originate a default route")], (c) => {
    if (c.device.config.ospf) c.device.config.ospf.defaultInformation = false;
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [kw("area", "OSPF area parameters"), numArg(0, 4294967295, "OSPF area ID"), kw("range", "Summarize routes at an area boundary"), ipArg("Summary network"), ipArg("Summary mask")], (c, [area, network, mask]) => {
    const ospf = c.device.config.ospf;
    if (!ospf) { c.out.push("% OSPF routing process is not configured."); return; }
    const normalized = networkOf(network as Ipv4, mask as Ipv4);
    if (!ospf.summaries.some((s) => s.network === normalized && s.mask === mask && s.area === area)) ospf.summaries.push({ network: normalized, mask: mask as Ipv4, area: area as number });
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [NO, kw("area", "OSPF area parameters"), numArg(0, 4294967295, "OSPF area ID"), kw("range", "Summarize routes at an area boundary"), ipArg("Summary network"), ipArg("Summary mask")], (c, [area, network, mask]) => {
    const ospf = c.device.config.ospf;
    if (ospf) ospf.summaries = ospf.summaries.filter((s) => !(s.network === networkOf(network as Ipv4, mask as Ipv4) && s.mask === mask && s.area === area));
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [kw("passive-interface", "Suppress routing updates on an interface"), ifaceArg], (c, [name]) => {
    const cfg = c.device.config.ospf ?? c.device.config.eigrp;
    if (cfg && !cfg.passiveInterfaces.includes(name as string)) cfg.passiveInterfaces.push(name as string);
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [NO, kw("passive-interface", "Suppress routing updates on an interface"), ifaceArg], (c, [name]) => {
    const cfg = c.device.config.ospf ?? c.device.config.eigrp;
    if (cfg) cfg.passiveInterfaces = cfg.passiveInterfaces.filter((iface) => iface !== name);
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [kw("network", "Enable EIGRP on an IP network"), ipArg("Network number"), ipArg("Wildcard bits")], (c, [network, wildcard]) => {
    if (!c.device.config.eigrp) { c.out.push("% EIGRP routing process is not configured."); return; }
    const mask = (~(wildcard as Ipv4)) >>> 0;
    const normalized = networkOf(network as Ipv4, mask);
    if (!c.device.config.eigrp.networks.some((n) => n.network === normalized && n.mask === mask)) c.device.config.eigrp.networks.push({ network: normalized, mask, area: 0 });
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [kw("network", "Enable OSPF on an IP network"), ipArg("Network number"), ipArg("Wildcard bits"), kw("area", "OSPF area ID"), numArg(0, 4294967295, "OSPF area ID")], (c, [network, wildcard, area]) => {
    const mask = (~(wildcard as Ipv4)) >>> 0;
    const normalized = networkOf(network as Ipv4, mask);
    const cfg = c.device.config.ospf ?? c.device.config.eigrp;
    if (!cfg) { c.out.push("% Routing process is not configured."); return; }
    if (!cfg.networks.some((n) => n.network === normalized && n.mask === mask && n.area === area)) cfg.networks.push({ network: normalized, mask, area: area as number });
  }, { devices: ["router"] }),
  cmd(ROUTER_CFG, [NO, kw("network", "Enable OSPF on an IP network"), ipArg("Network number"), ipArg("Wildcard bits"), kw("area", "OSPF area ID"), numArg(0, 4294967295, "OSPF area ID")], (c, [network, wildcard, area]) => {
    const mask = (~(wildcard as Ipv4)) >>> 0;
    const cfg = c.device.config.ospf ?? c.device.config.eigrp;
    if (cfg) cfg.networks = cfg.networks.filter((n) => !(n.network === networkOf(network as Ipv4, mask) && n.mask === mask && n.area === area));
  }, { devices: ["router"] }),
];

const ALL: Entry[] = [...showCommands, ...execCommands, ...exitEnd, ...configCommands, ...interfaceCommands, ...lineCommands, ...dhcpCommands, ...switchCommands, ...ospfCommands];

const cache = new Map<string, Cmd[]>();

export function commandsFor(mode: Mode, kind: DeviceKind): Cmd[] {
  const key = `${mode}:${kind}`;
  let list = cache.get(key);
  if (!list) {
    list = ALL.filter((e) => e.modes.includes(mode) && (!e.devices || e.devices.includes(kind))).map((e) => e.cmd);
    cache.set(key, list);
  }
  return list;
}
