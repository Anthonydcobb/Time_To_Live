import type { Ipv4, Mac } from "../addr";
import { Device, type Port } from "../network";
import type { IpStack, L3Interface } from "../ipstack";
import { cloneConfig, defaultConfig, type InterfaceConfig, type IosConfig } from "../ios/config";
import { IosConsole } from "../ios/console";

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

export abstract class IosDevice extends Device {
  abstract readonly model: string;
  abstract readonly stack: IpStack;
  readonly console: IosConsole;
  config: IosConfig;
  startup: IosConfig | null = null;
  /** Running config has changed since the last save. */
  dirty = false;
  /** Interface whose `shutdown` state is being changed right now, for log wording. */
  protected adminChanging: string | null = null;

  /** Subclasses add their ports, then call `this.config = this.factoryConfig(hostname)`. */
  constructor(id: string) {
    super(id);
    this.config = defaultConfig("", []);
    this.console = new IosConsole(this);
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
