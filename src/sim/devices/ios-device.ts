import type { Ipv4, Mac } from "../addr";
import { Device, Port } from "../network";
import type { IpStack, L3Interface } from "../ipstack";
import { cloneConfig, defaultConfig, type InterfaceConfig, type IosConfig } from "../ios/config";
import { IosConsole } from "../ios/console";
import { showVersion } from "../ios/show";
import { CDP_MAC, type Frame } from "../frames";

/** What `show ip interface brief` and friends need to know about any interface. */
export interface InterfaceView {
  name: string;
  shortName: string;
  mac: Mac;
  port: Port | null;
  /** Physical ports can't take an IP on a Layer 2 switch. */
  routed: boolean;
  status(): "administratively down" | "down" | "up";
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
  readonly cdpNeighbors = new Map<Port, CdpNeighbor>();
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

  isPortShutdown(port: Port): boolean {
    return this.config.interfaces[port.name]?.shutdown ?? false;
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
    if (layer === "protocol" && port.protocolUp) this.clock.schedule(0, () => this.sendCdp(port));
  }

  onAttach(): void {
    const tick = () => {
      for (const p of this.ports) this.sendCdp(p);
      this.clock.schedule(CDP_INTERVAL_MS, tick);
    };
    this.clock.schedule(CDP_INTERVAL_MS, tick);
  }

  /** The address CDP advertises: the first interface that has one. */
  managementAddress(): Ipv4 | null {
    for (const i of this.interfaces()) {
      const ip = this.config.interfaces[i.name]?.ip;
      if (ip != null) return ip;
    }
    return null;
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
      },
    });
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
    return true;
  }

  liveCdpNeighbors(): CdpNeighbor[] {
    const now = this.clock.now;
    return [...this.cdpNeighbors.values()].filter((n) => n.expiresAt > now);
  }

  protected logInterfaceChange(name: string, layer: "link" | "protocol", up: boolean): void {
    if (layer === "link") {
      const admin = this.config.interfaces[name]?.shutdown;
      if (admin) this.emit(`%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`);
      else if (this.adminChanging === name) this.emit(`%LINK-5-CHANGED: Interface ${name}, changed state to ${up ? "up" : "down"}`);
      else this.emit(`%LINK-3-UPDOWN: Interface ${name}, changed state to ${up ? "up" : "down"}`);
    } else {
      this.emit(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to ${up ? "up" : "down"}`);
    }
  }

  saveConfig(): void {
    this.startup = cloneConfig(this.config);
    this.dirty = false;
  }

  eraseStartup(): void {
    this.startup = null;
  }

  /** Throws away the running config and boots from startup-config. */
  reload(): void {
    const fresh = this.startup ? cloneConfig(this.startup) : this.factoryConfig(this.defaultHostname);
    this.config = fresh;
    this.stack.arp.clear();
    this.afterReload();
    this.dirty = false;
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
