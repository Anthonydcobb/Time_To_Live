import { BROADCAST_MAC, nextMac, type Mac } from "../addr";
import type { Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { defaultConfig, type IosConfig } from "../ios/config";
import { Port } from "../network";
import { IosDevice, type InterfaceView } from "./ios-device";

export interface MacEntry {
  mac: Mac;
  vlan: number;
  port: Port;
  learnedAt: number;
}

export const MAC_AGING_MS = 300_000;
/**
 * Spanning tree listening and learning take 15 seconds each before an access
 * port forwards. This is the amber-light wait. Real BPDUs and loop blocking
 * come with the library job.
 */
export const STP_LISTENING_MS = 15_000;
export const STP_LEARNING_MS = 15_000;

export type StpState = "disabled" | "listening" | "learning" | "forwarding";

/** Cryptis CS-2960: 24 FastEthernet ports, 2 gigabit uplinks, one VLAN for now. */
export class Switch extends IosDevice {
  readonly kind = "switch" as const;
  readonly model = "CS-2960-24TT";
  protected readonly defaultHostname = "Switch";
  readonly stack: IpStack;
  readonly baseMac: Mac = nextMac("00e0b0");
  readonly macTable = new Map<Mac, MacEntry>();
  private readonly stpSince = new Map<Port, number>();
  private sviUp = false;
  private readonly svi: L3Interface;

  constructor(id: string, hostname = "Switch") {
    super(id);
    for (let n = 1; n <= 24; n++) this.addPort(`FastEthernet0/${n}`, `Fa0/${n}`);
    for (let n = 1; n <= 2; n++) this.addPort(`GigabitEthernet0/${n}`, `Gig0/${n}`);
    this.config = this.factoryConfig(hostname);
    const config = () => this.config.interfaces.Vlan1;
    this.svi = {
      name: "Vlan1",
      mac: this.baseMac,
      get ip() {
        return config().ip;
      },
      get mask() {
        return config().mask;
      },
      up: () => this.sviUp,
      transmit: (frame) => this.forward(frame, null),
    };
    this.stack = new IpStack({
      clock: () => this.clock,
      interfaces: () => [this.svi],
      forwarding: false,
      queueWhileArping: false,
      initialTtl: 255,
      localRoutes: false,
      defaultGateway: () => this.config.defaultGateway,
    });
  }

  protected factoryConfig(hostname: string): IosConfig {
    return defaultConfig(hostname, [
      ...this.ports.map((p) => ({ name: p.name, shutdown: false })),
      { name: "Vlan1", shutdown: true },
    ]);
  }

  private addPort(name: string, shortName: string): void {
    this.ports.push(new Port(this, name, shortName, nextMac("00e0b0")));
  }

  interfaceTypes() {
    return [
      { name: "FastEthernet", help: "FastEthernet IEEE 802.3" },
      { name: "GigabitEthernet", help: "GigabitEthernet IEEE 802.3z" },
      { name: "Vlan", help: "Catalyst Vlans" },
    ];
  }

  interfaces(): InterfaceView[] {
    const physical: InterfaceView[] = this.ports.map((port) => ({
      name: port.name,
      shortName: port.shortName,
      mac: port.mac,
      port,
      routed: false,
      status: () => port.status(),
      protocol: () => (port.protocolUp ? "up" : "down"),
    }));
    const svi: InterfaceView = {
      name: "Vlan1",
      shortName: "Vl1",
      mac: this.baseMac,
      port: null,
      routed: true,
      status: () => (this.config.interfaces.Vlan1.shutdown ? "administratively down" : this.sviUp ? "up" : "down"),
      protocol: () => (this.sviUp ? "up" : "down"),
    };
    return [...physical, svi];
  }

  l3Interfaces(): L3Interface[] {
    return [this.svi];
  }

  stpState(port: Port): StpState {
    if (!port.protocolUp) return "disabled";
    const elapsed = this.clock.now - (this.stpSince.get(port) ?? 0);
    if (elapsed < STP_LISTENING_MS) return "listening";
    if (elapsed < STP_LISTENING_MS + STP_LEARNING_MS) return "learning";
    return "forwarding";
  }

  onPortStateChange(port: Port, layer: "link" | "protocol"): void {
    super.onPortStateChange(port, layer);
    if (layer === "protocol") {
      if (port.protocolUp) this.stpSince.set(port, this.clock.now);
      else {
        this.stpSince.delete(port);
        for (const [mac, e] of this.macTable) if (e.port === port) this.macTable.delete(mac);
      }
    }
    this.updateSvi();
  }

  protected applyAdminState(name: string): void {
    if (name === "Vlan1") this.updateSvi();
    else super.applyAdminState(name);
  }

  protected afterReload(): void {
    this.macTable.clear();
    this.updateSvi();
  }

  /** The VLAN 1 interface is up when it isn't shut down and some port in VLAN 1 is up. */
  private updateSvi(): void {
    const shouldBeUp = !this.config.interfaces.Vlan1.shutdown && this.ports.some((p) => p.protocolUp);
    if (shouldBeUp === this.sviUp) {
      if (!shouldBeUp && this.adminChanging === "Vlan1") this.logInterfaceChange("Vlan1", "link", false);
      return;
    }
    this.sviUp = shouldBeUp;
    this.logInterfaceChange("Vlan1", "link", shouldBeUp);
    this.logInterfaceChange("Vlan1", "protocol", shouldBeUp);
  }

  liveMacEntries(): MacEntry[] {
    const now = this.clock.now;
    return [...this.macTable.values()].filter((e) => now - e.learnedAt < MAC_AGING_MS);
  }

  receive(port: Port, frame: Frame): void {
    const state = this.stpState(port);
    if (state === "disabled" || state === "listening") return;
    if (frame.src !== BROADCAST_MAC) this.macTable.set(frame.src, { mac: frame.src, vlan: 1, port, learnedAt: this.clock.now });
    if (state === "learning") return;

    if (this.sviUp && (frame.dst === this.baseMac || frame.dst === BROADCAST_MAC)) {
      this.stack.handleFrame(this.svi, frame);
      if (frame.dst === this.baseMac) return;
    }
    this.forward(frame, port);
  }

  private forward(frame: Frame, ingress: Port | null): void {
    if (frame.dst !== BROADCAST_MAC) {
      const entry = this.macTable.get(frame.dst);
      if (entry && this.clock.now - entry.learnedAt < MAC_AGING_MS) {
        if (entry.port !== ingress && this.stpState(entry.port) === "forwarding") this.send(entry.port, frame);
        return;
      }
    }
    for (const p of this.ports) {
      if (p !== ingress && this.stpState(p) === "forwarding") this.send(p, frame);
    }
  }
}
