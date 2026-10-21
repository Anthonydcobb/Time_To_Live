import type { Ipv4, Mac } from "../addr";
import { Device, Port, type LinkSettings } from "../network";
import type { IpStack, L3Interface } from "../ipstack";
import { cloneConfig, defaultConfig, type InterfaceConfig, type IosConfig } from "../ios/config";
import { IosConsole, type ConsoleOutput } from "../ios/console";
import { showVersion } from "../ios/show";
import { CDP_MAC, type Frame, type LldpPacket } from "../frames";
import { type5Hash } from "../ios/passwords";

export type RemoteProtocol = "ssh" | "telnet";
export type RemoteLoginResult =
  | { ok: true; protocol: RemoteProtocol; username: string }
  | { ok: false; reason: "transport-disabled" | "ssh-not-ready" | "local-login-disabled" | "unknown-user" | "bad-password" };

export type SnmpGetResult =
  | { ok: true; oid: string; type: "STRING" | "TIMETICKS"; value: string | number }
  | { ok: false; reason: "unknown-community" | "no-such-object" };

/** An authenticated simulated SSH/Telnet session. It intentionally reuses the device CLI. */
export class RemoteSession {
  private closed = false;

  constructor(
    readonly device: IosDevice,
    readonly protocol: RemoteProtocol,
    readonly username: string,
  ) {}

  prompt(): string {
    return this.closed ? "" : this.device.console.prompt();
  }

  input(line: string): ConsoleOutput {
    if (this.closed) return { lines: ["% Session is closed."] };
    return this.device.console.input(line);
  }

  close(): ConsoleOutput {
    this.closed = true;
    return { lines: ["Connection closed by remote host."] };
  }
}

/** What `show ip interface brief` and friends need to know about any interface. */
export interface InterfaceView {
  name: string;
  shortName: string;
  mac: Mac;
  port: Port | null;
  /** Physical ports can't take an IP on a Layer 2 switch. */
  routed: boolean;
  /** "deleted" is a subinterface removed with `no interface`, which IOS keeps listing until reload. */
  status(): "administratively down" | "down" | "up" | "deleted";
  protocol(): "up" | "down";
}

export interface CdpNeighbor {
  localPort: Port;
  deviceId: string;
  platform: string;
  capability: "Router" | "Switch";
  portId: string;
  address: Ipv4 | null;
  version: string;
  expiresAt: number;
}

export interface LldpNeighbor {
  localPort: Port;
  deviceId: string;
  platform: string;
  capability: "Router" | "Switch";
  portId: string;
  expiresAt: number;
  address: Ipv4 | null;
}

export const CDP_INTERVAL_MS = 60_000;
export const CDP_HOLDTIME_SEC = 180;

export abstract class IosDevice extends Device {
  abstract readonly model: string;
  abstract readonly stack: IpStack;
  readonly console: IosConsole;
  /** The light-blue port on the back. A console cable from a PC's RS-232 port lands here. */
  readonly consolePort: Port;
  config: IosConfig;
  startup: IosConfig | null = null;
  /** Running config has changed since the last save. */
  dirty = false;
  /** Clock times for the "! Last configuration change" and "! NVRAM config last updated" header lines. */
  configChangedAt: number | null = null;
  nvramWrittenAt: number | null = null;
  /** The header times as they were when startup-config was written. */
  startupStamps: { changed: number | null; nvram: number | null } = { changed: null, nvram: null };
  readonly cdpNeighbors = new Map<Port, CdpNeighbor>();
  readonly lldpNeighbors = new Map<Port, LldpNeighbor>();
  /** Recent IOS messages retained by the local log buffer. */
  readonly logBuffer: string[] = [];
  /** Counters for the deliberately local SNMP GET simulation. */
  snmpPacketsInput = 0;
  snmpPacketsOutput = 0;
  /** Interface whose `shutdown` state is being changed right now, for log wording. */
  protected adminChanging: string | null = null;

  /** Subclasses add their ports, then call `this.config = this.factoryConfig(hostname)`. */
  constructor(id: string) {
    super(id);
    this.config = defaultConfig("", []);
    this.console = new IosConsole(this);
    this.consolePort = new Port(this, "Console", "Con", "000000000000", "console");
  }

  abstract interfaces(): InterfaceView[];
  abstract l3Interfaces(): L3Interface[];
  abstract interfaceTypes(): { name: string; help: string }[];

  get hostname(): string {
    return this.config.hostname;
  }

  ifaceConfig(name: string): InterfaceConfig {
    return this.config.interfaces[name];
  }

  linkSettings(port: Port): LinkSettings {
    const cfg = this.config.interfaces[port.name];
    const maxSpeed = port.name.startsWith("FastEthernet") ? 100 : 1000;
    return { maxSpeed, speed: cfg?.speed ?? "auto", duplex: cfg?.duplex ?? "auto" };
  }

  isPortShutdown(port: Port): boolean {
    return this.config.interfaces[port.name]?.shutdown ?? false;
  }

  /** The canonical name if `interface NAME` may create this interface (a subinterface or an SVI), otherwise null. */
  canCreateInterface(_name: string): string | null {
    return null;
  }

  createInterface(_name: string): void {}

  /** `no interface NAME`. Returns an error line, or null if it worked. */
  deleteInterface(_name: string): string | null {
    return "% Physical interfaces cannot be deleted";
  }

  /** The order a config lists its interfaces in. */
  configInterfaceOrder(c: IosConfig): string[] {
    return Object.keys(c.interfaces);
  }

  /** The VLAN CDP advertises for a port. Only switches send one. */
  cdpNativeVlan(_port: Port): number | undefined {
    return undefined;
  }

  findInterface(name: string): InterfaceView | undefined {
    return this.interfaces().find((i) => i.name === name);
  }

  setShutdown(name: string, shutdown: boolean): void {
    const cfg = this.config.interfaces[name];
    if (cfg.shutdown === shutdown) return;
    cfg.shutdown = shutdown;
    this.adminChanging = name;
    try {
      this.applyAdminState(name);
    } finally {
      this.adminChanging = null;
    }
  }

  /** Pushes a changed `shutdown` setting out to the physical or virtual interface. */
  protected applyAdminState(name: string): void {
    const port = this.ports.find((p) => p.name === name);
    if (port) this.network?.refresh(port);
  }

  onPortStateChange(port: Port, layer: "link" | "protocol"): void {
    this.logInterfaceChange(port.name, layer, layer === "link" ? port.linkUp : port.protocolUp);
    if (layer === "protocol" && port.protocolUp) this.clock.schedule(0, () => { this.sendCdp(port); this.sendLldp(port); });
  }

  onAttach(): void {
    const tick = () => {
      for (const p of this.ports) this.sendCdp(p);
      this.clock.schedule(CDP_INTERVAL_MS, tick);
    };
    this.clock.schedule(CDP_INTERVAL_MS, tick);
    const lldpTick = () => {
      for (const p of this.ports) this.sendLldp(p);
      this.clock.schedule(CDP_INTERVAL_MS, lldpTick);
    };
    this.clock.schedule(0, lldpTick);
  }

  /** The address CDP advertises: the first interface that has one. */
  managementAddress(): Ipv4 | null {
    for (const i of this.interfaces()) {
      const ip = this.config.interfaces[i.name]?.ip;
      if (ip != null) return ip;
    }
    return null;
  }

  attemptRemoteLogin(protocol: RemoteProtocol, username: string, password: string): RemoteLoginResult {
    const line = this.config.vty;
    if (line.transportInput === "none" || (line.transportInput !== "all" && line.transportInput !== protocol)) {
      return { ok: false, reason: "transport-disabled" };
    }
    if (protocol === "ssh" && (!this.config.domainName || !this.config.rsaKeysGenerated)) {
      return { ok: false, reason: "ssh-not-ready" };
    }
    if (!line.loginLocal && !(this.config.aaaNewModel && this.config.aaaLoginLocal)) return { ok: false, reason: "local-login-disabled" };
    const stored = this.config.users[username];
    if (!stored) return { ok: false, reason: "unknown-user" };
    if (stored !== type5Hash(password, stored.split("$")[2])) return { ok: false, reason: "bad-password" };
    return { ok: true, protocol, username };
  }

  openRemoteSession(protocol: RemoteProtocol, username: string, password: string): RemoteSession | RemoteLoginResult {
    const login = this.attemptRemoteLogin(protocol, username, password);
    return login.ok ? new RemoteSession(this, protocol, username) : login;
  }

  /**
   * A small, transport-free SNMPv2c surface for labs and automation exercises.
   * It models community authorization and common system OIDs, not UDP polling,
   * SET operations, traps, or a full MIB.
   */
  snmpGet(community: string, oid: string): SnmpGetResult {
    this.snmpPacketsInput++;
    const configured = this.config.snmpCommunities.find((entry) => entry.community === community);
    if (!configured) return { ok: false, reason: "unknown-community" };
    const normalized = oid.replace(/^\./, "").toLowerCase();
    const values: Record<string, { type: "STRING" | "TIMETICKS"; value: string | number }> = {
      "1.3.6.1.2.1.1.1.0": { type: "STRING", value: `${this.model} IOS-style simulator` },
      "1.3.6.1.2.1.1.3.0": { type: "TIMETICKS", value: this.clock.now * 100 },
      "1.3.6.1.2.1.1.5.0": { type: "STRING", value: this.hostname },
      "sysdescr.0": { type: "STRING", value: `${this.model} IOS-style simulator` },
      "sysuptime.0": { type: "TIMETICKS", value: this.clock.now * 100 },
      "sysname.0": { type: "STRING", value: this.hostname },
    };
    const value = values[normalized];
    if (!value) return { ok: false, reason: "no-such-object" };
    this.snmpPacketsOutput++;
    return { ok: true, oid, ...value };
  }

  private sendCdp(port: Port): void {
    const c = this.config;
    if (!c.cdpRun || !port.protocolUp || !c.interfaces[port.name]?.cdp) return;
    this.send(port, {
      src: port.mac,
      dst: CDP_MAC,
      payload: {
        kind: "cdp",
        deviceId: c.hostname,
        platform: `Cryptis ${this.model}`,
        capability: this.kind === "router" ? "Router" : "Switch",
        portId: port.name,
        holdtimeSec: CDP_HOLDTIME_SEC,
        address: this.managementAddress(),
        version: showVersion(this)[0],
        nativeVlan: this.cdpNativeVlan(port),
      },
    });
  }

  private sendLldp(port: Port): void {
    const c = this.config;
    if (!c.lldp || !port.protocolUp) return;
    const payload: LldpPacket = {
      kind: "lldp",
      deviceId: c.hostname,
      platform: `Cryptis ${this.model}`,
      capability: this.kind === "router" ? "Router" : "Switch",
      portId: port.name,
      ttlSec: 120,
      address: this.managementAddress(),
    };
    this.send(port, { src: port.mac, dst: "0180c200000e", payload });
  }

  /** Returns true if the frame was a CDP advertisement (which is never forwarded). */
  protected handleCdp(port: Port, frame: Frame): boolean {
    const p = frame.payload;
    if (p.kind !== "cdp") return false;
    if (!this.config.cdpRun || !this.config.interfaces[port.name]?.cdp) return true;
    this.cdpNeighbors.set(port, {
      localPort: port,
      deviceId: p.deviceId,
      platform: p.platform,
      capability: p.capability,
      portId: p.portId,
      address: p.address,
      version: p.version,
      expiresAt: this.clock.now + p.holdtimeSec * 1000,
    });
    const ours = this.cdpNativeVlan(port);
    if (p.nativeVlan !== undefined && ours !== undefined && p.nativeVlan !== ours) {
      this.emit(`%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${port.name} (${ours}), with ${p.deviceId} ${p.portId} (${p.nativeVlan}).`);
    }
    return true;
  }

  protected handleLldp(port: Port, frame: Frame): boolean {
    if (frame.payload.kind !== "lldp") return false;
    if (!this.config.lldp) return true;
    const p = frame.payload;
    this.lldpNeighbors.set(port, {
      localPort: port,
      deviceId: p.deviceId,
      platform: p.platform,
      capability: p.capability,
      portId: p.portId,
      expiresAt: this.clock.now + p.ttlSec * 1000,
      address: p.address,
    });
    return true;
  }

  liveCdpNeighbors(): CdpNeighbor[] {
    const now = this.clock.now;
    return [...this.cdpNeighbors.values()].filter((n) => n.expiresAt > now);
  }

  liveLldpNeighbors(): LldpNeighbor[] {
    const now = this.clock.now;
    return [...this.lldpNeighbors.values()].filter((n) => n.expiresAt > now);
  }

  protected logInterfaceChange(name: string, layer: "link" | "protocol", up: boolean): void {
    if (layer === "link") {
      const admin = this.config.interfaces[name]?.shutdown;
      if (admin) this.emit(`%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`);
      else this.emit(`%LINK-3-UPDOWN: Interface ${name}, changed state to ${up ? "up" : "down"}`);
    } else {
      this.emit(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to ${up ? "up" : "down"}`);
    }
  }

  /** Console log messages carry IOS's default timestamp: `*Mar  1 00:01:02.345: `. */
  emit(text: string): void {
    const formatted = text.startsWith("%") ? `*${logTimestamp(this.clock.now)}: ${text}` : text;
    if (text.startsWith("%")) {
      this.logBuffer.push(formatted);
      if (this.logBuffer.length > 100) this.logBuffer.shift();
    }
    super.emit(formatted);
  }

  saveConfig(): void {
    this.startup = cloneConfig(this.config);
    this.dirty = false;
    this.nvramWrittenAt = this.clock.now;
    this.startupStamps = { changed: this.configChangedAt, nvram: this.nvramWrittenAt };
  }

  eraseStartup(): void {
    this.startup = null;
    this.nvramWrittenAt = null;
  }

  /** Throws away the running config and boots from startup-config. */
  reload(): void {
    const fresh = this.startup ? cloneConfig(this.startup) : this.factoryConfig(this.defaultHostname);
    this.config = fresh;
    this.stack.arp.clear();
    this.afterReload();
    this.dirty = false;
    this.configChangedAt = null;
    for (const p of this.ports) this.network?.refresh(p);
  }

  protected afterReload(): void {}
  protected abstract readonly defaultHostname: string;
  protected abstract factoryConfig(hostname: string): IosConfig;

  /** Used by `ip address` to stop two interfaces sharing a subnet. */
  overlapping(name: string, ip: Ipv4, mask: Ipv4): string | null {
    for (const [other, c] of Object.entries(this.config.interfaces)) {
      if (other === name || c.ip === null || c.mask === null) continue;
      // Two subnets overlap if they match under the shorter of the two masks.
      const shorter = mask >>> 0 < c.mask >>> 0 ? mask : c.mask;
      if (((ip & shorter) >>> 0) === ((c.ip & shorter) >>> 0)) return other;
    }
    return null;
  }
}

/**
 * `service timestamps log datetime msec`, the IOS default. The clock was never
 * set, so the star says it isn't authoritative and the date counts from March 1st, 1993.
 */
export function logTimestamp(ms: number): string {
  const d = new Date(Date.UTC(1993, 2, 1) + ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${month} ${String(d.getUTCDate()).padStart(2, " ")} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** The clock as config headers print it: `00:05:12 UTC Mon Mar 1 1993`. */
export function configTimestamp(ms: number): string {
  const d = new Date(Date.UTC(1993, 2, 1) + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const month = logTimestamp(ms).slice(0, 3);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC ${day} ${month} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}
