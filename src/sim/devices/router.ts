import { ipv6InPrefix, networkOf, nextMac, type Ipv4, type Ipv6 } from "../addr";
import { retag, type Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { DhcpServer } from "../dhcp";
import { defaultConfig, newInterfaceConfig, type IosConfig, type OspfNetwork } from "../ios/config";
import { Port } from "../network";
import { splitSubinterface } from "../vlans";
import { IosDevice, type InterfaceView } from "./ios-device";
import { permitsStandardAcl } from "../ios/acl";

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
  private ospfRoutes: { network: Ipv4; mask: Ipv4; nextHop: Ipv4 | null; exitIface: string | null }[] = [];
  private ospfv3Routes: { network: Ipv6; prefix: number; nextHop: Ipv6 | null; exitIface: string | null }[] = [];
  readonly ospfNeighbors: { router: Router; localInterface: string; remoteInterface: string; remoteAddress: Ipv4 }[] = [];
  readonly ospfv3Neighbors: { router: Router; localInterface: string; remoteInterface: string; remoteAddress: Ipv6 }[] = [];

  ipv6OspfRoutes() {
    return [...this.ospfv3Routes];
  }

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
      ipv6StaticRoutes: () => this.config.ipv6StaticRoutes,
      ipv6OspfRoutes: () => this.ospfv3Routes,
      ospfRoutes: () => this.ospfRoutes,
      onDhcp: (iface, packet) => this.handleDhcp(iface, packet),
      filter: (iface, packet, direction) => permitsStandardAcl(this.config, iface.name, packet, direction),
    });
    this.dhcp = new DhcpServer({
      clock: () => this.clock,
      config: () => this.config,
      stack: this.stack,
      l3Interfaces: () => this.l3Interfaces(),
    });
  }

  onAttach(): void {
    super.onAttach();
    const tick = () => { this.syncOspf(); this.syncOspfV3(); this.clock.schedule(1000, tick); };
    this.clock.schedule(1000, tick);
  }

  private ospfNetwork(iface: L3Interface): OspfNetwork | null {
    if (!this.config.ospf || iface.ip === null || iface.mask === null) return null;
    return this.config.ospf.networks.find((n) => networkOf(iface.ip!, n.mask) === n.network) ?? null;
  }

  private ospfAdvertisements(excludeNextHop?: Ipv4) {
    const connected = this.l3Interfaces().flatMap((iface) => {
      const n = this.ospfNetwork(iface);
      return n && iface.up() ? [{ network: n.network, mask: n.mask, nextHop: null, exitIface: null }] : [];
    });
    const learned = this.ospfRoutes
      .filter((route) => route.nextHop !== excludeNextHop)
      .map(({ network, mask }) => ({ network, mask, nextHop: null, exitIface: null }));
    return [...connected, ...learned.filter((route) => !connected.some((local) => local.network === route.network && local.mask === route.mask))];
  }

  private syncOspf(): void {
    this.ospfNeighbors.length = 0;
    this.ospfRoutes = [];
    if (!this.config.ospf) return;
    const local = this.ospfAdvertisements();
    for (const port of this.ports) {
      const peer = port.peer;
      if (!peer || !(peer.device instanceof Router)) continue;
      const ours = this.l3.get(port);
      const theirs = peer.device.l3.get(peer);
      const oursNet = ours && this.ospfNetwork(ours);
      const theirsNet = theirs && peer.device.ospfNetwork(theirs);
      if (!ours || !theirs || !ours.up() || !theirs.up() || !oursNet || !theirsNet || oursNet.area !== theirsNet.area) continue;
      this.ospfNeighbors.push({ router: peer.device, localInterface: ours.name, remoteInterface: theirs.name, remoteAddress: theirs.ip! });
      for (const route of peer.device.ospfAdvertisements(ours.ip!)) {
        if (!local.some((r) => r.network === route.network && r.mask === route.mask) && !this.ospfRoutes.some((r) => r.network === route.network && r.mask === route.mask && r.nextHop === theirs.ip)) {
          this.ospfRoutes.push({ ...route, nextHop: theirs.ip!, exitIface: ours.name });
        }
      }
    }
  }

  private ospfv3Area(iface: L3Interface): number | null {
    return this.config.ospfv3 && iface.up() ? this.config.interfaces[iface.name]?.ipv6OspfArea ?? null : null;
  }

  private ospfv3Advertisements() {
    const connected = this.l3Interfaces().flatMap((iface) => {
      if (this.ospfv3Area(iface) === null) return [];
      return iface.ipv6Addresses.map((a) => ({ network: a.address, prefix: a.prefix, nextHop: null, exitIface: null }));
    });
    const learned = this.ospfv3Routes.filter((route) => route.nextHop !== null).map(({ network, prefix }) => ({ network, prefix, nextHop: null, exitIface: null }));
    return [...connected, ...learned.filter((r) => !connected.some((c) => c.network === r.network && c.prefix === r.prefix))];
  }

  private syncOspfV3(): void {
    this.ospfv3Neighbors.length = 0;
    this.ospfv3Routes = [];
    if (!this.config.ospfv3) return;
    const local = this.ospfv3Advertisements();
    for (const port of this.ports) {
      const peer = port.peer;
      if (!peer || !(peer.device instanceof Router)) continue;
      const ours = this.l3.get(port);
      const theirs = peer.device.l3.get(peer);
      const oursArea = ours && this.ospfv3Area(ours);
      const theirsArea = theirs && peer.device.ospfv3Area(theirs);
      const pair = ours && theirs && oursArea !== null && oursArea === theirsArea
        ? ours.ipv6Addresses.flatMap((a) => theirs.ipv6Addresses.map((b) => ({ a, b }))).find(({ a, b }) => ipv6InPrefix(b.address, a.address, a.prefix) && ipv6InPrefix(a.address, b.address, b.prefix))
        : undefined;
      if (!ours || !theirs || !pair) continue;
      this.ospfv3Neighbors.push({ router: peer.device, localInterface: ours.name, remoteInterface: theirs.name, remoteAddress: pair.b.address });
      for (const route of peer.device.ospfv3Advertisements()) {
        if (!local.some((r) => r.network === route.network && r.prefix === route.prefix) && !this.ospfv3Routes.some((r) => r.network === route.network && r.prefix === route.prefix && r.nextHop === pair.b.address)) {
          this.ospfv3Routes.push({ ...route, nextHop: pair.b.address, exitIface: ours.name });
        }
      }
    }
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
      get ipv6Addresses() {
        return config().ipv6Addresses;
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
        get ipv6Addresses() {
          return config()?.ipv6Addresses ?? [];
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

  private handleDhcp(iface: L3Interface, packet: import("../frames").Ipv4Packet): void {
    const msg = packet.dhcp!;
    // A response addressed to this router's client-facing interface is sent
    // back as a broadcast on that LAN. The relay marker is not exposed to PCs.
    const relayInterface = msg.relayIp === undefined ? null : this.l3Interfaces().find((candidate) => candidate.ip === msg.relayIp) ?? null;
    if (relayInterface) {
      const { relayIp: _relayIp, ...clientMessage } = msg;
      relayInterface.transmit({
        src: relayInterface.mac,
        dst: "ffffffffffff",
        payload: { ...packet, src: relayInterface.ip!, dst: 0xffffffff, dhcp: clientMessage },
      });
      return;
    }
    const helpers = this.config.interfaces[iface.name]?.helperAddresses ?? [];
    if (msg.relayIp === undefined && helpers.length && iface.ip !== null) {
      for (const helper of helpers) {
        this.stack.send({
          ...packet,
          src: iface.ip,
          dst: helper,
          dhcp: { ...msg, relayIp: iface.ip },
        });
      }
      return;
    }
    this.dhcp.handle(iface, packet);
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
