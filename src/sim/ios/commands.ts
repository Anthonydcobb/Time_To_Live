// The IOS command set, per mode. Each entry is a token sequence plus a handler.
import { broadcastOf, formatIpv4, maskToPrefix, networkOf, parseIpv4, type Ipv4 } from "../addr";
import type { IosDevice } from "../devices/ios-device";
import type { Router } from "../devices/router";
import type { Switch } from "../devices/switch";
import type { DeviceKind } from "../network";
import type { LineConfig } from "./config";
import type { IosConsole, Mode } from "./console";
import { kw, type Arg, type Command, type Token, type Word } from "./parser";
import { type5Hash } from "./passwords";
import * as show from "./show";

export interface Ctx {
  device: IosDevice;
  console: IosConsole;
  out: string[];
  delayMs: number;
}

type Cmd = Command<Ctx>;

interface Entry {
  modes: Mode[];
  devices?: DeviceKind[];
  cmd: Cmd;
}

// ---- argument types ------------------------------------------------------

const ipArg = (help: string): Arg<Ctx> => ({
  type: "arg",
  name: "A.B.C.D",
  help,
  match: (w, i) => {
    const ip = parseIpv4(w[i].text);
    return ip === null ? null : { consumed: 1, value: ip };
  },
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

/** Interface names: `g0/0`, `gig 0/0`, `GigabitEthernet0/0`, `vlan 1`. */
const ifaceArg: Arg<Ctx> = {
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
    const iface = ctx.device.interfaces().find((x) => x.name.toLowerCase() === name.toLowerCase());
    return iface ? { consumed, value: iface.name } : null;
  },
};

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
const LINE: Mode[] = ["config-line"];
const SUB: Mode[] = ["config", "config-if", "config-line"];

const NO = kw("no", "Negate a command or set its defaults");
const SHOW = kw("show", "Show running system information");
const IP = kw("ip", "Global IP configuration subcommands");

function selectedLines(ctx: Ctx): LineConfig {
  return ctx.console.lineKind === "vty" ? ctx.device.config.vty : ctx.device.config.con;
}

function forEachIface(ctx: Ctx, fn: (name: string) => void): void {
  for (const name of ctx.console.ifaces) fn(name);
}

function setPassword(ctx: Ctx, text: string) {
  return { text, encrypted: ctx.device.config.servicePasswordEncryption };
}

function ping(ctx: Ctx, target: Ipv4): void {
  const { device, out } = ctx;
  out.push("Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${formatIpv4(target)}, timeout is 2 seconds:`);
  const id = device.stack.newPingId();
  let marks = "";
  const rtts: number[] = [];
  for (let seq = 0; seq < 5; seq++) {
    const r = device.stack.ping(target, id, seq, 2000);
    if (r.kind === "reply") {
      marks += "!";
      rtts.push(r.rttMs);
    } else if (r.kind === "unreachable") marks += "U";
    else if (r.kind === "ttl-expired") marks += "&";
    else marks += ".";
  }
  out.push(marks);
  const pct = Math.round((rtts.length / 5) * 100);
  if (rtts.length) {
    const avg = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
    out.push(`Success rate is ${pct} percent (${rtts.length}/5), round-trip min/avg/max = ${Math.round(Math.min(...rtts))}/${avg}/${Math.round(Math.max(...rtts))} ms`);
  } else {
    out.push(`Success rate is ${pct} percent (0/5)`);
  }
}

function validHostname(name: string): boolean {
  return /^[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name);
}

function configured(ctx: Ctx): void {
  ctx.device.emit("%SYS-5-CONFIG_I: Configured from console by console");
}

// ---- the command table ------------------------------------------------------

const showCommands: Entry[] = [
  cmd(EXEC, [SHOW, kw("version", "System hardware and software status")], (c) => c.out.push(...show.showVersion(c.device))),
  cmd(EXEC, [SHOW, kw("clock", "Display the system clock")], (c) => c.out.push(...show.showClock(c.device))),
  cmd(
    EXEC,
    [SHOW, kw("ip", "IP information"), kw("interface", "IP interface status and configuration"), kw("brief", "Brief summary of IP status and configuration")],
    (c) => c.out.push(...show.showIpInterfaceBrief(c.device)),
  ),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration")], (c) => c.out.push(...show.showInterfaces(c.device))),
  cmd(EXEC, [SHOW, kw("interfaces", "Interface status and configuration"), ifaceArg], (c, [name]) =>
    c.out.push(...show.showInterfaces(c.device, name as string)),
  ),
  cmd(EXEC, [SHOW, kw("arp", "Arp table")], (c) => c.out.push(...show.showArp(c.device))),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("arp", "IP ARP table")], (c) => c.out.push(...show.showArp(c.device))),
  cmd(EXEC, [SHOW, kw("ip", "IP information"), kw("route", "IP routing table")], (c) => c.out.push(...show.showIpRoute(c.device as Router)), {
    devices: ["router"],
  }),
  cmd(
    EXEC,
    [SHOW, kw("mac", "MAC configuration"), kw("address-table", "MAC forwarding table")],
    (c) => c.out.push(...show.showMacAddressTable(c.device as Switch)),
    { devices: ["switch"] },
  ),
  cmd(EXEC, [SHOW, kw("vlan", "VTP VLAN status"), kw("brief", "VTP all VLAN status in brief")], (c) => c.out.push(...show.showVlanBrief(c.device as Switch)), {
    devices: ["switch"],
  }),
  cmd(ENABLE, [SHOW, kw("running-config", "Current operating configuration")], (c) => c.out.push(...show.showRunningConfig(c.device))),
  cmd(ENABLE, [SHOW, kw("startup-config", "Contents of startup configuration")], (c) => c.out.push(...show.showStartupConfig(c.device))),
];

const execCommands: Entry[] = [
  cmd(EXEC, [kw("enable", "Turn on privileged commands")], (c) => c.console.beginEnable()),
  cmd(EXEC, [kw("exit", "Exit from the EXEC")], (c) => c.console.logout()),
  cmd(EXEC, [kw("logout", "Exit from the EXEC")], (c) => c.console.logout()),
  cmd(EXEC, [kw("ping", "Send echo messages"), ipArg("Ping destination address or hostname")], (c, [ip]) => ping(c, ip as Ipv4)),
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
  cmd(IF, [kw("exit", "Exit from interface configuration mode")], (c) => c.console.setMode("config")),
  cmd(LINE, [kw("exit", "Exit from line configuration mode")], (c) => c.console.setMode("config")),
];

const ENABLE_KW = kw("enable", "Modify enable password parameters");
const SERVICE = kw("service", "Modify use of network based services");
const PWENC = kw("password-encryption", "Encrypt system passwords");
const BANNER = kw("banner", "Define a login banner");
const MOTD = kw("motd", "Set Message of the Day banner");
const DOMAIN = kw("domain-lookup", "Enable IP Domain Name System hostname translation");
const ROUTE = kw("route", "Establish static routes");

function addRoute(c: Ctx, network: Ipv4, mask: Ipv4, via: { nextHop: Ipv4 | null; exitIface: string | null }): void {
  if (maskToPrefix(mask) === null) {
    c.out.push("%Inconsistent address and mask");
    return;
  }
  if (networkOf(network, mask) !== network) {
    c.out.push("%Inconsistent address and mask");
    return;
  }
  const routes = c.device.config.staticRoutes;
  const same = (r: (typeof routes)[number]) => r.network === network && r.mask === mask && r.nextHop === via.nextHop && r.exitIface === via.exitIface;
  if (!routes.some(same)) routes.push({ network, mask, ...via });
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
  cmd(CONFIG, [kw("hostname", "Set system's network name"), wordArg("This system's network name")], (c, [name]) => {
    if (!validHostname(name as string)) {
      c.out.push("% Hostname contains one or more illegal characters.");
      return;
    }
    c.device.config.hostname = name as string;
  }),
  cmd(CONFIG, [NO, kw("hostname", "Set system's network name")], (c) => {
    c.device.config.hostname = c.device.kind === "router" ? "Router" : "Switch";
  }),
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
  cmd(CONFIG, [IP, DOMAIN], (c) => {
    c.device.config.ipDomainLookup = true;
  }),
  cmd(CONFIG, [NO, IP, DOMAIN], (c) => {
    c.device.config.ipDomainLookup = false;
  }),
  cmd(CONFIG, [kw("interface", "Select an interface to configure"), ifaceArg], (c, [name]) => {
    c.console.ifaces = [name as string];
    c.console.setMode("config-if");
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
  cmd(CONFIG, [IP, ROUTE, ipArg("Destination prefix"), ipArg("Destination prefix mask"), ifaceArg], (c, [n, m, i]) =>
    addRoute(c, n as Ipv4, m as Ipv4, { nextHop: null, exitIface: i as string }),
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
];

const routedIface = (c: Ctx) => c.console.ifaces.every((n) => c.device.findInterface(n)?.routed);
const IF_IP = kw("ip", "Interface Internet Protocol config commands");
const ADDRESS = kw("address", "Set the IP address of an interface");

const interfaceCommands: Entry[] = [
  cmd(IF, [IF_IP, ADDRESS, ipArg("IP address"), ipArg("IP subnet mask")], (c, [ip, mask]) => {
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
  cmd(IF, [NO, IF_IP, ADDRESS], (c) => {
    forEachIface(c, (name) => {
      const cfg = c.device.ifaceConfig(name);
      cfg.ip = null;
      cfg.mask = null;
    });
  }, { when: routedIface }),
  cmd(IF, [kw("shutdown", "Shutdown the selected interface")], (c) => forEachIface(c, (n) => c.device.setShutdown(n, true))),
  cmd(IF, [NO, kw("shutdown", "Shutdown the selected interface")], (c) => forEachIface(c, (n) => c.device.setShutdown(n, false))),
  cmd(IF, [kw("description", "Interface specific description"), lineArg("Up to 240 characters describing this interface")], (c, [text]) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).description = (text as string).slice(0, 240);
    }),
  ),
  cmd(IF, [NO, kw("description", "Interface specific description")], (c) =>
    forEachIface(c, (n) => {
      c.device.ifaceConfig(n).description = null;
    }),
  ),
];

const lineCommands: Entry[] = [
  cmd(LINE, [kw("password", "Set a password"), wordArg("The UNENCRYPTED (cleartext) line password", "LINE")], (c, [p]) => {
    selectedLines(c).password = setPassword(c, p as string);
  }),
  cmd(LINE, [NO, kw("password", "Set a password")], (c) => {
    selectedLines(c).password = null;
  }),
  cmd(LINE, [kw("login", "Enable password checking")], (c) => {
    selectedLines(c).login = true;
  }),
  cmd(LINE, [NO, kw("login", "Enable password checking")], (c) => {
    selectedLines(c).login = false;
  }),
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

const ALL: Entry[] = [...showCommands, ...execCommands, ...exitEnd, ...configCommands, ...interfaceCommands, ...lineCommands];

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
