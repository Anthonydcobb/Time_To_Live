import { nextMac } from "../addr";
import type { Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { DhcpServer } from "../dhcp";
import { defaultConfig, type IosConfig } from "../ios/config";
import { Port } from "../network";
import { IosDevice, type InterfaceView } from "./ios-device";

/** Cryptis CR-2911: three gigabit ports, all shut down out of the box. */
export class Router extends IosDevice {
  readonly kind = "router" as const;
  readonly model = "CR-2911";
  protected readonly defaultHostname = "Router";
  readonly stack: IpStack;
  readonly dhcp: DhcpServer;
  private readonly l3 = new Map<Port, L3Interface>();

  constructor(id: string, hostname = "Router") {
    super(id);
    for (const n of [0, 1, 2]) this.addPort(`GigabitEthernet0/${n}`, `Gig0/${n}`);
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

  interfaces(): InterfaceView[] {
    return this.ports.map((port) => ({
      name: port.name,
      shortName: port.shortName,
      mac: port.mac,
      port,
      routed: true,
      status: () => port.status(),
      protocol: () => (port.protocolUp ? "up" : "down"),
    }));
  }

  l3Interfaces(): L3Interface[] {
    return [...this.l3.values()];
  }

  protected afterReload(): void {
    // Bindings live in RAM unless a DHCP database agent is configured.
    this.dhcp.clear();
    this.dhcp.clearConflicts();
  }

  receive(port: Port, frame: Frame): void {
    if (this.handleCdp(port, frame)) return;
    this.stack.handleFrame(this.l3.get(port)!, frame);
  }
}
