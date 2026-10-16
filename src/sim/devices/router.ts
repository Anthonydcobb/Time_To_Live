import { nextMac } from "../addr";
import { retag, type Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { DhcpServer } from "../dhcp";
import { defaultConfig, newInterfaceConfig, type IosConfig } from "../ios/config";
import { Port } from "../network";
import { splitSubinterface } from "../vlans";
import { IosDevice, type InterfaceView } from "./ios-device";

/** Cryptis CR-2911: three gigabit ports, all shut down out of the box. Subinterfaces carry 802.1Q VLANs. */
export class Router extends IosDevice {
  readonly kind = "router" as const;
  readonly model = "CR-2911";
  protected readonly defaultHostname = "Router";
  readonly stack: IpStack;
  readonly dhcp: DhcpServer;
  private readonly l3 = new Map<Port, L3Interface>();
  private readonly subL3 = new Map<string, L3Interface>();
  /** Subinterfaces removed with `no interface`. IOS keeps listing them as deleted until a reload. */
  readonly deletedSubinterfaces = new Set<string>();

  constructor(id: string, hostname = "Router") {
    super(id);
    for (const n of [0, 1, 2]) this.addPort(`GigabitEthernet0/${n}`, `Gi0/${n}`);
    this.config = this.factoryConfig(hostname);
    this.stack = new IpStack({
      clock: () => this.clock,
      interfaces: () => this.l3Interfaces(),
      forwarding: true,
      queueWhileArping: false,
      initialTtl: 255,
      localRoutes: true,
      staticRoutes: () => this.config.staticRoutes,
      onDhcp: (iface, packet) => this.dhcp.handle(iface, packet),
    });
    this.dhcp = new DhcpServer({
      clock: () => this.clock,
      config: () => this.config,
      stack: this.stack,
      l3Interfaces: () => this.l3Interfaces(),
    });
  }

  protected factoryConfig(hostname: string): IosConfig {
    return defaultConfig(hostname, this.ports.map((p) => ({ name: p.name, shutdown: true })));
  }

  private addPort(name: string, shortName: string): void {
    const port = new Port(this, name, shortName, nextMac("00d0c7"));
    this.ports.push(port);
    const config = () => this.config.interfaces[name];
    this.l3.set(port, {
      name,
      mac: port.mac,
      get ip() {
        return config().ip;
      },
      get mask() {
        return config().mask;
      },
      up: () => port.protocolUp,
      transmit: (frame) => this.send(port, frame),
    });
  }

  interfaceTypes() {
    return [{ name: "GigabitEthernet", help: "GigabitEthernet IEEE 802.3z" }];
  }

  /** A port's subinterfaces in a config, in number order. */
  subinterfacesOf(parent: string, c: IosConfig = this.config, withDeleted = false): string[] {
    const names = Object.keys(c.interfaces);
    if (withDeleted) names.push(...this.deletedSubinterfaces);
    return names.filter((n) => splitSubinterface(n)?.[0] === parent).sort((a, b) => splitSubinterface(a)![1] - splitSubinterface(b)![1]);
  }

  configInterfaceOrder(c: IosConfig): string[] {
    return this.ports.flatMap((p) => [p.name, ...this.subinterfacesOf(p.name, c)]);
  }

  interfaces(): InterfaceView[] {
    return this.ports.flatMap((port) => {
      const physical: InterfaceView = {
        name: port.name,
        shortName: port.shortName,
        mac: port.mac,
        port,
        routed: true,
        status: () => port.status(),
        protocol: () => (port.protocolUp ? "up" : "down"),
      };
      const subs = this.subinterfacesOf(port.name, this.config, true).map((name): InterfaceView => {
        const status = () => {
          if (!this.config.interfaces[name]) return "deleted" as const;
          // A subinterface follows its physical interface, unless it's shut down itself.
          return this.config.interfaces[name].shutdown ? ("administratively down" as const) : port.status();
        };
        return {
          name,
          shortName: `${port.shortName}.${splitSubinterface(name)![1]}`,
          mac: port.mac,
          port: null,
          routed: true,
          status,
          protocol: () => (status() === "up" && port.protocolUp ? "up" : "down"),
        };
      });
      return [physical, ...subs];
    });
  }

  l3Interfaces(): L3Interface[] {
    const subs = Object.keys(this.config.interfaces)
      .filter((n) => splitSubinterface(n))
      .map((n) => this.subinterface(n));
    return [...this.l3.values(), ...subs];
  }

  private subinterface(name: string): L3Interface {
    let sub = this.subL3.get(name);
    if (!sub) {
      const port = this.port(splitSubinterface(name)![0]);
      const config = () => this.config.interfaces[name];
      sub = {
        name,
        mac: port.mac,
        get ip() {
          return config()?.ip ?? null;
        },
        get mask() {
          return config()?.mask ?? null;
        },
        up: () => !!config() && !config().shutdown && port.protocolUp,
        transmit: (frame) => {
          const enc = config()?.encapsulation;
          if (!enc) return;
          this.send(port, retag(frame, enc.native ? undefined : enc.vlan));
        },
      };
      this.subL3.set(name, sub);
    }
    return sub;
  }

  canCreateInterface(name: string): string | null {
    const parts = splitSubinterface(name);
    if (!parts || !this.ports.some((p) => p.name === parts[0])) return null;
    return parts[1] >= 1 && parts[1] <= 4294967295 ? `${parts[0]}.${parts[1]}` : null;
  }

  createInterface(name: string): void {
    this.deletedSubinterfaces.delete(name);
    this.config.interfaces[name] = { ...newInterfaceConfig(false), encapsulation: null };
  }

  deleteInterface(name: string): string | null {
    if (!splitSubinterface(name)) return "% Physical interfaces cannot be deleted";
    delete this.config.interfaces[name];
    this.deletedSubinterfaces.add(name);
    return null;
  }

  protected afterReload(): void {
    this.deletedSubinterfaces.clear();
    // Bindings live in RAM unless a DHCP database agent is configured.
    this.dhcp.clear();
    this.dhcp.clearConflicts();
  }

  receive(port: Port, frame: Frame): void {
    if (this.handleCdp(port, frame)) return;
    const iface = this.ingressInterface(port, frame.vlan);
    if (iface?.up()) this.stack.handleFrame(iface, retag(frame, undefined));
  }

  /**
   * A tagged frame goes to the subinterface with that VLAN, or is dropped.
   * An untagged one goes to the native subinterface if there is one, otherwise the port itself.
   */
  private ingressInterface(port: Port, tag: number | undefined): L3Interface | null {
    for (const name of this.subinterfacesOf(port.name)) {
      const enc = this.config.interfaces[name].encapsulation;
      if (enc && (tag === undefined ? enc.native : enc.vlan === tag)) return this.subinterface(name);
    }
    return tag === undefined ? this.l3.get(port)! : null;
  }
}
