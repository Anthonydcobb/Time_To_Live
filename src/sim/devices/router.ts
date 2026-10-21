import { ipv6InPrefix, networkOf, nextMac, type Ipv4, type Ipv6 } from "../addr";
import { retag, type Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { DhcpServer } from "../dhcp";
import { defaultConfig, newInterfaceConfig, type IosConfig, type OspfNetwork } from "../ios/config";
import { Port } from "../network";
import { splitSubinterface } from "../vlans";
import { IosDevice, type InterfaceView } from "./ios-device";
import { Switch } from "./switch";
import { permitsIpv6Acl, permitsStandardAcl } from "../ios/acl";

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
  private eigrpRoutes: { network: Ipv4; mask: Ipv4; nextHop: Ipv4 | null; exitIface: string | null }[] = [];
  private ospfv3Routes: { network: Ipv6; prefix: number; nextHop: Ipv6 | null; exitIface: string | null }[] = [];
  private patSessions = new Map<number, { localIp: Ipv4; localId: number; globalIp: Ipv4 }>();
  private nextPatId = 40000;
  readonly ospfNeighbors: { router: Router; localInterface: string; remoteInterface: string; remoteAddress: Ipv4; localRole: "DR" | "BDR" | "DROTHER" | "P2P"; remoteRole: "DR" | "BDR" | "DROTHER" | "P2P" }[] = [];
  readonly eigrpNeighbors: { router: Router; localInterface: string; remoteInterface: string; remoteAddress: Ipv4 }[] = [];

  eigrpTopology(): { network: Ipv4; mask: Ipv4; nextHop: Ipv4 | null; exitIface: string | null }[] {
    return this.eigrpRoutes.map((route) => ({ ...route }));
  }
  readonly ospfv3Neighbors: { router: Router; localInterface: string; remoteInterface: string; remoteAddress: Ipv6 }[] = [];

  ipv6OspfRoutes() {
    return [...this.ospfv3Routes];
  }

  natPatTranslations() {
    return [...this.patSessions.values()];
  }

  ospfRouterId(): Ipv4 | null {
    if (this.config.ospf?.routerId !== null && this.config.ospf?.routerId !== undefined) return this.config.ospf.routerId;
    return this.l3Interfaces().map((iface) => iface.ip).filter((ip): ip is Ipv4 => ip !== null).sort((a, b) => b - a)[0] ?? null;
  }

  hsrpActive(interfaceName: string): Router {
    const localIface = this.l3Interfaces().find((iface) => iface.name === interfaceName);
    const local = this.config.interfaces[interfaceName]?.hsrp;
    if (!localIface || !local || localIface.ip === null || localIface.mask === null) return this;
    const candidates = (this.network?.devices ?? []).filter((device): device is Router => device instanceof Router).flatMap((router) =>
      router.l3Interfaces().flatMap((iface) => {
        const h = router.config.interfaces[iface.name]?.hsrp;
        return h && h.group === local.group && h.ip === local.ip && iface.ip !== null && iface.mask !== null && iface.up() && networkOf(iface.ip, iface.mask) === networkOf(localIface.ip!, localIface.mask!) ? [{ router, priority: h.priority, ip: iface.ip }] : [];
      }),
    );
    return (candidates.sort((a, b) => b.priority - a.priority || b.ip - a.ip)[0]?.router) ?? this;
  }

  vrrpActive(interfaceName: string): Router {
    const localIface = this.l3Interfaces().find((iface) => iface.name === interfaceName);
    const local = this.config.interfaces[interfaceName]?.vrrp;
    if (!localIface || !local || localIface.ip === null || localIface.mask === null) return this;
    const candidates = (this.network?.devices ?? []).filter((device): device is Router => device instanceof Router).flatMap((router) =>
      router.l3Interfaces().flatMap((iface) => {
        const v = router.config.interfaces[iface.name]?.vrrp;
        return v && v.group === local.group && v.ip === local.ip && iface.ip !== null && iface.mask !== null && iface.up() && networkOf(iface.ip, iface.mask) === networkOf(localIface.ip!, localIface.mask!) ? [{ router, priority: v.priority, ip: iface.ip }] : [];
      }),
    );
    return (candidates.sort((a, b) => b.priority - a.priority || b.ip - a.ip)[0]?.router) ?? this;
  }

  glbpActive(interfaceName: string): Router {
    const localIface = this.l3Interfaces().find((iface) => iface.name === interfaceName);
    const local = this.config.interfaces[interfaceName]?.glbp;
    if (!localIface || !local || localIface.ip === null || localIface.mask === null) return this;
    const candidates = (this.network?.devices ?? []).filter((device): device is Router => device instanceof Router).flatMap((router) =>
      router.l3Interfaces().flatMap((iface) => {
        const g = router.config.interfaces[iface.name]?.glbp;
        return g && g.group === local.group && g.ip === local.ip && iface.ip !== null && iface.mask !== null && iface.up() && networkOf(iface.ip, iface.mask) === networkOf(localIface.ip!, localIface.mask!) ? [{ router, priority: g.priority, ip: iface.ip }] : [];
      }),
    );
    return (candidates.sort((a, b) => b.priority - a.priority || b.ip - a.ip)[0]?.router) ?? this;
  }

  private hsrpMac(group: number): string {
    return `00000c07ac${group.toString(16).padStart(2, "0")}`;
  }

  private vrrpMac(group: number): string {
    return `00005e0001${group.toString(16).padStart(2, "0")}`;
  }

  private glbpMac(group: number): string {
    return `0007b400${group.toString(16).padStart(4, "0")}`;
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
      eigrpRoutes: () => this.eigrpRoutes,
      onDhcp: (iface, packet) => this.handleDhcp(iface, packet),
      onDns: (iface, packet) => this.handleDns(iface, packet),
      filter: (iface, packet, direction) => permitsStandardAcl(this.config, iface.name, packet, direction),
      ipv6Filter: (iface, packet, direction) => permitsIpv6Acl(this.config, iface.name, packet, direction),
    });
    this.dhcp = new DhcpServer({
      clock: () => this.clock,
      config: () => this.config,
      stack: this.stack,
      l3Interfaces: () => this.l3Interfaces(),
    });
  }

  private handleDns(iface: L3Interface, packet: import("../frames").Ipv4Packet): void {
    const query = packet.dns;
    if (!query || query.response || !this.config.dnsServer || iface.ip === null) return;
    const key = query.name.toLowerCase().replace(/\.$/, "");
    const addresses = this.config.hostRecords[key] ?? [];
    this.stack.send({
      kind: "ipv4",
      src: iface.ip,
      dst: packet.src,
      ttl: 255,
      dns: { kind: "dns", id: query.id, response: true, name: query.name, addresses },
    });
  }

  onAttach(): void {
    super.onAttach();
    const tick = () => { this.syncOspf(); this.syncOspfV3(); this.syncEigrp(); this.clock.schedule(1000, tick); };
    this.clock.schedule(1000, tick);
  }

  private ospfNetwork(iface: L3Interface): OspfNetwork | null {
    if (!this.config.ospf || iface.ip === null || iface.mask === null) return null;
    return this.config.ospf.networks.find((n) => networkOf(iface.ip!, n.mask) === n.network) ?? null;
  }

  private ospfPeerInterfaces(local: L3Interface): { router: Router; iface: L3Interface; segment: string; multiaccess: boolean }[] {
    const port = this.ports.find((candidate) => candidate.name === local.name);
    const peerPort = port?.peer;
    if (!port || !peerPort || !port.protocolUp || !peerPort.protocolUp) return [];
    if (peerPort.device instanceof Router) {
      const peer = peerPort.device;
      const names = [this.id, peer.id].sort();
      const ports = [port.name, peerPort.name].sort();
      const iface = peer.l3Interfaces().find((candidate) => candidate.name === peerPort.name);
      return iface ? [{ router: peer, iface, segment: `p2p:${names.join("|")}:${ports.join("|")}`, multiaccess: false }] : [];
    }
    if (!(peerPort.device instanceof Switch)) return [];
    const sw = peerPort.device;
    const vlans = sw.forwardingVlans(peerPort);
    return sw.ports.flatMap((candidate) => {
      const remotePort = candidate.peer;
      if (!remotePort || !candidate.protocolUp || !remotePort.protocolUp || !sw.forwardingVlans(candidate).some((v) => vlans.includes(v))) return [];
      if (!(remotePort.device instanceof Router) || remotePort.device === this) return [];
      const iface = remotePort.device.l3Interfaces().find((entry) => entry.name === remotePort.name);
      return iface ? [{ router: remotePort.device, iface, segment: `${sw.id}:${vlans.find((v) => sw.forwardingVlans(candidate).includes(v))}`, multiaccess: true }] : [];
    });
  }

  private ospfRole(participants: { router: Router; iface: L3Interface }[], local: Router, iface: L3Interface, multiaccess: boolean): "DR" | "BDR" | "DROTHER" | "P2P" {
    if (!multiaccess) return "P2P";
    const ordered = participants.filter((p) => p.iface.up() && this.ospfNetworkFor(p.iface)).sort((a, b) => {
      const priority = (router: Router, entry: L3Interface) => router.config.interfaces[entry.name]?.ospfPriority ?? 1;
      return priority(b.router, b.iface) - priority(a.router, a.iface) || (b.router.ospfRouterId() ?? 0) - (a.router.ospfRouterId() ?? 0);
    });
    const index = ordered.findIndex((p) => p.router === local && p.iface.name === iface.name);
    return index === 0 ? "DR" : index === 1 ? "BDR" : "DROTHER";
  }

  private ospfNetworkFor(iface: L3Interface): OspfNetwork | null {
    return this.ospfNetwork(iface);
  }

  private ospfAdvertisements(excludeNextHop?: Ipv4) {
    const connected = this.l3Interfaces().flatMap((iface) => {
      const n = this.ospfNetwork(iface);
      return n && iface.up() ? [{ network: n.network, mask: n.mask, nextHop: null, exitIface: null }] : [];
    });
    const learned = this.ospfRoutes
      .filter((route) => route.nextHop !== excludeNextHop)
      .map(({ network, mask }) => ({ network, mask, nextHop: null, exitIface: null }));
    const ospf = this.config.ospf;
    let advertised = [...connected, ...learned.filter((route) => !connected.some((local) => local.network === route.network && local.mask === route.mask))];
    if (ospf?.defaultInformation && this.config.staticRoutes.some((route) => route.network === 0 && route.mask === 0)) advertised.push({ network: 0, mask: 0, nextHop: null, exitIface: null });
    for (const summary of ospf?.summaries ?? []) {
      const covered = connected.filter((route) => {
        const iface = this.l3Interfaces().find((candidate) => {
          const network = this.ospfNetwork(candidate);
          return network?.network === route.network && network.mask === route.mask;
        });
        const network = iface ? this.ospfNetwork(iface) : null;
        return network?.area === summary.area && networkOf(route.network, summary.mask) === summary.network && route.mask >>> 0 >= summary.mask >>> 0;
      });
      if (covered.length) {
        advertised = advertised.filter((route) => !covered.some((item) => item.network === route.network && item.mask === route.mask));
        advertised.push({ network: summary.network, mask: summary.mask, nextHop: null, exitIface: null });
      }
    }
    return advertised.filter((route, index) => index === advertised.findIndex((candidate) => candidate.network === route.network && candidate.mask === route.mask));
  }

  private syncOspf(): void {
    this.ospfNeighbors.length = 0;
    this.ospfRoutes = [];
    if (!this.config.ospf) return;
    const local = this.ospfAdvertisements();
    for (const ours of this.l3Interfaces()) {
      const oursNet = this.ospfNetwork(ours);
      if (!ours.up() || !oursNet) continue;
      for (const adjacency of this.ospfPeerInterfaces(ours)) {
        const theirs = adjacency.iface;
        const theirsNet = adjacency.router.ospfNetwork(theirs);
        if (!theirs.up() || !theirsNet || oursNet.area !== theirsNet.area) continue;
        if (this.config.ospf.passiveInterfaces.includes(ours.name) || adjacency.router.config.ospf?.passiveInterfaces.includes(theirs.name)) continue;
        const participants = [{ router: this, iface: ours }, ...this.ospfPeerInterfaces(ours).filter((entry) => entry.segment === adjacency.segment).map((entry) => ({ router: entry.router, iface: entry.iface }))];
        const localRole = this.ospfRole(participants, this, ours, adjacency.multiaccess);
        const remoteRole = this.ospfRole(participants, adjacency.router, theirs, adjacency.multiaccess);
        this.ospfNeighbors.push({ router: adjacency.router, localInterface: ours.name, remoteInterface: theirs.name, remoteAddress: theirs.ip!, localRole, remoteRole });
        for (const route of adjacency.router.ospfAdvertisements(ours.ip!)) {
          if (!local.some((r) => r.network === route.network && r.mask === route.mask) && !this.ospfRoutes.some((r) => r.network === route.network && r.mask === route.mask && r.nextHop === theirs.ip)) {
            this.ospfRoutes.push({ ...route, nextHop: theirs.ip!, exitIface: ours.name });
          }
        }
      }
    }
  }

  private eigrpNetwork(iface: L3Interface): OspfNetwork | null {
    if (!this.config.eigrp || iface.ip === null || iface.mask === null) return null;
    return this.config.eigrp.networks.find((n) => networkOf(iface.ip!, n.mask) === n.network) ?? null;
  }

  private eigrpAdvertisements(excludeNextHop?: Ipv4) {
    const connected = this.l3Interfaces().flatMap((iface) => {
      const n = this.eigrpNetwork(iface);
      return n && iface.up() ? [{ network: n.network, mask: n.mask, nextHop: null, exitIface: null }] : [];
    });
    const learned = this.eigrpRoutes.filter((route) => route.nextHop !== excludeNextHop).map(({ network, mask }) => ({ network, mask, nextHop: null, exitIface: null }));
    return [...connected, ...learned.filter((route) => !connected.some((local) => local.network === route.network && local.mask === route.mask))];
  }

  private syncEigrp(): void {
    this.eigrpNeighbors.length = 0;
    this.eigrpRoutes = [];
    if (!this.config.eigrp) return;
    const local = this.eigrpAdvertisements();
    for (const port of this.ports) {
      const peer = port.peer;
      if (!peer || !(peer.device instanceof Router)) continue;
      const ours = this.l3.get(port);
      const theirs = peer.device.l3.get(peer);
      const oursNet = ours && this.eigrpNetwork(ours);
      const theirsNet = theirs && peer.device.eigrpNetwork(theirs);
      if (!ours || !theirs || !ours.up() || !theirs.up() || !oursNet || !theirsNet || this.config.eigrp.as !== peer.device.config.eigrp?.as) continue;
      if (this.config.eigrp.passiveInterfaces.includes(ours.name) || peer.device.config.eigrp?.passiveInterfaces.includes(theirs.name)) continue;
      this.eigrpNeighbors.push({ router: peer.device, localInterface: ours.name, remoteInterface: theirs.name, remoteAddress: theirs.ip! });
      for (const route of peer.device.eigrpAdvertisements(ours.ip!)) {
        if (!local.some((r) => r.network === route.network && r.mask === route.mask) && !this.eigrpRoutes.some((r) => r.network === route.network && r.mask === route.mask && r.nextHop === theirs.ip)) {
          this.eigrpRoutes.push({ ...route, nextHop: theirs.ip!, exitIface: ours.name });
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

  private natRole(port: Port): "inside" | "outside" | null {
    return this.config.interfaces[port.name]?.natRole ?? null;
  }

  private natAclPermits(acl: number, packet: import("../frames").Ipv4Packet): boolean {
    for (const rule of this.config.standardAcls[acl] ?? []) {
      const matches = rule.network === null || (((packet.src ^ rule.network) & (~rule.wildcard! >>> 0)) >>> 0) === 0;
      if (matches) return rule.action === "permit";
    }
    return false;
  }

  private outsideAddress(interfaceName: string): Ipv4 | null {
    return this.config.interfaces[interfaceName]?.ip ?? null;
  }

  private translateOutbound(frame: Frame, port: Port): Frame {
    const payload = frame.payload;
    if (this.natRole(port) !== "outside" || payload.kind !== "ipv4") return frame;
    const nat = this.config.staticNat.find((entry) => entry.insideLocal === payload.src);
    if (nat) return { ...frame, payload: { ...payload, src: nat.insideGlobal } };
    const overload = this.config.natOverloads.find((rule) => rule.outsideInterface === port.name && this.natAclPermits(rule.acl, payload));
    if (!overload || !payload.icmp) return frame;
    let session = [...this.patSessions.values()].find((entry) => entry.localIp === payload.src && entry.localId === payload.icmp!.id && entry.globalIp === this.outsideAddress(overload.outsideInterface));
    if (!session) {
      const globalIp = this.outsideAddress(overload.outsideInterface);
      if (globalIp === null) return frame;
      const globalId = this.nextPatId++;
      session = { localIp: payload.src, localId: payload.icmp.id, globalIp };
      this.patSessions.set(globalId, session);
      return { ...frame, payload: { ...payload, src: globalIp, icmp: { ...payload.icmp, id: globalId } } };
    }
    const globalId = [...this.patSessions.entries()].find(([, entry]) => entry === session)?.[0];
    return globalId === undefined ? frame : { ...frame, payload: { ...payload, src: session.globalIp, icmp: { ...payload.icmp, id: globalId } } };
  }

  private translateInbound(frame: Frame, port: Port): Frame {
    const payload = frame.payload;
    if (this.natRole(port) !== "outside" || payload.kind !== "ipv4") return frame;
    const nat = this.config.staticNat.find((entry) => entry.insideGlobal === payload.dst);
    if (nat) return { ...frame, payload: { ...payload, dst: nat.insideLocal } };
    if (!payload.icmp) return frame;
    const session = this.patSessions.get(payload.icmp.id);
    return session && session.globalIp === payload.dst ? { ...frame, payload: { ...payload, dst: session.localIp, icmp: { ...payload.icmp, id: session.localId } } } : frame;
  }

  send(port: Port, frame: Frame): void {
    super.send(port, this.translateOutbound(frame, port));
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
    if (this.handleLldp(port, frame)) return;
    const payload = frame.payload;
    if (this.natRole(port) === "outside" && payload.kind === "arp" && payload.op === "request") {
      const nat = this.config.staticNat.find((entry) => entry.insideGlobal === payload.targetIp);
      if (nat) {
        this.send(port, { src: port.mac, dst: frame.src, payload: { kind: "arp", op: "reply", senderMac: port.mac, senderIp: nat.insideGlobal, targetMac: payload.senderMac, targetIp: payload.senderIp } });
        return;
      }
    }
    const iface = this.ingressInterface(port, frame.vlan);
    const h = iface ? this.config.interfaces[iface.name]?.hsrp : null;
    if (iface && h) {
      const active = this.hsrpActive(iface.name);
      const vmac = this.hsrpMac(h.group);
      if (payload.kind === "arp" && payload.op === "request" && payload.targetIp === h.ip && active === this) {
        this.send(port, { src: vmac, dst: frame.src, payload: { kind: "arp", op: "reply", senderMac: vmac, senderIp: h.ip, targetMac: payload.senderMac, targetIp: payload.senderIp } });
        return;
      }
      if (active !== this && frame.dst === vmac) return;
      if (active === this && frame.dst === vmac) {
        frame = { ...frame, dst: port.mac };
        if (payload.kind === "ipv4" && payload.dst === h.ip && payload.icmp?.type === "echo-request") {
          this.stack.send({ kind: "ipv4", src: h.ip, dst: payload.src, ttl: 255, icmp: { type: "echo-reply", id: payload.icmp.id, seq: payload.icmp.seq } });
          return;
        }
      }
    }
    const v = iface ? this.config.interfaces[iface.name]?.vrrp : null;
    if (iface && v) {
      const active = this.vrrpActive(iface.name);
      const vmac = this.vrrpMac(v.group);
      if (payload.kind === "arp" && payload.op === "request" && payload.targetIp === v.ip && active === this) {
        this.send(port, { src: vmac, dst: frame.src, payload: { kind: "arp", op: "reply", senderMac: vmac, senderIp: v.ip, targetMac: payload.senderMac, targetIp: payload.senderIp } });
        return;
      }
      if (active !== this && frame.dst === vmac) return;
      if (active === this && frame.dst === vmac) {
        frame = { ...frame, dst: port.mac };
        if (payload.kind === "ipv4" && payload.dst === v.ip && payload.icmp?.type === "echo-request") {
          this.stack.send({ kind: "ipv4", src: v.ip, dst: payload.src, ttl: 255, icmp: { type: "echo-reply", id: payload.icmp.id, seq: payload.icmp.seq } });
          return;
        }
      }
    }
    const g = iface ? this.config.interfaces[iface.name]?.glbp : null;
    if (iface && g) {
      const active = this.glbpActive(iface.name);
      const vmac = this.glbpMac(g.group);
      if (payload.kind === "arp" && payload.op === "request" && payload.targetIp === g.ip && active === this) {
        this.send(port, { src: vmac, dst: frame.src, payload: { kind: "arp", op: "reply", senderMac: vmac, senderIp: g.ip, targetMac: payload.senderMac, targetIp: payload.senderIp } });
        return;
      }
      if (active !== this && frame.dst === vmac) return;
      if (active === this && frame.dst === vmac) {
        frame = { ...frame, dst: port.mac };
        if (payload.kind === "ipv4" && payload.dst === g.ip && payload.icmp?.type === "echo-request") {
          this.stack.send({ kind: "ipv4", src: g.ip, dst: payload.src, ttl: 255, icmp: { type: "echo-reply", id: payload.icmp.id, seq: payload.icmp.seq } });
          return;
        }
      }
    }
    if (iface?.up()) this.stack.handleFrame(iface, retag(this.translateInbound(frame, port), undefined));
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
