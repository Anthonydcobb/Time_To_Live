import { BROADCAST_MAC, nextMac, type Mac } from "../addr";
import { retag, STP_MAC, type BpduPacket, type Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { defaultConfig, defaultSwitchport, newInterfaceConfig, type ChannelGroupMode, type IosConfig, type SwitchportConfig } from "../ios/config";
import { Port } from "../network";
import { DEFAULT_VLANS, MAX_NORMAL_VLAN, UNSUPPORTED_VLANS, defaultVlanName, formatVlanList, isDefaultVlan, sviVlan } from "../vlans";
import { IosDevice, type InterfaceView } from "./ios-device";
import { permitsStandardAcl } from "../ios/acl";

export interface MacEntry {
  mac: Mac;
  vlan: number;
  port: Port;
  learnedAt: number;
}

export const MAC_AGING_MS = 300_000;
/**
 * Spanning tree listening and learning take 15 seconds each before a port
 * forwards in a VLAN. This is the amber-light wait. Each VLAN on a port runs
 * its own timer, like PVST+. Real BPDUs and loop blocking come with the library job.
 */
export const STP_LISTENING_MS = 15_000;
export const STP_LEARNING_MS = 15_000;

export type StpRole = "disabled" | "root" | "designated" | "alternate";
export type StpState = "disabled" | "blocking" | "listening" | "learning" | "forwarding";
const STP_RANK: Record<StpState, number> = { disabled: 0, blocking: 1, listening: 2, learning: 3, forwarding: 4 };

/** What a port is doing right now, after DTP has had its say. */
export type OperationalMode = "access" | "trunk" | "down";

/** Cryptis CS-2960: 24 FastEthernet ports and 2 gigabit uplinks, 802.1Q trunking only. */
export class Switch extends IosDevice {
  readonly kind = "switch" as const;
  readonly model = "CS-2960-24TT";
  protected readonly defaultHostname = "Switch";
  readonly stack: IpStack;
  readonly baseMac: Mac = nextMac("00e0b0");
  private readonly l3 = new Map<Port, L3Interface>();
  /**
   * The VLAN database. Like the real thing it lives in flash:vlan.dat, not in
   * the running config, so `erase startup-config` and `reload` leave it alone.
   */
  readonly vlans = new Map<number, string>(DEFAULT_VLANS);
  /** Whether flash:vlan.dat exists. It's written the first time a VLAN changes. */
  vlanDat = false;
  /** Keyed by `${vlan}:${mac}`, since the same MAC can live in two VLANs. */
  readonly macTable = new Map<string, MacEntry>();
  /** When each VLAN started spanning tree on each port. */
  private readonly stpSince = new Map<Port, Map<number, number>>();
  /** The role used when the current STP timer was started. */
  private readonly stpRoles = new Map<Port, Map<number, StpRole>>();
  private readonly lastMode = new Map<Port, OperationalMode>();
  private readonly svis = new Map<string, L3Interface>();
  private readonly dhcpRateWindows = new Map<Port, { started: number; count: number }>();
  private readonly errDisabledPorts = new Set<Port>();
  private readonly rootInconsistentUntil = new Map<Port, Map<number, number>>();
  private readonly sviUp = new Set<string>();
  /** Access-layer security counters used by the IOS show commands. */
  readonly dhcpSnoopingStats = { processed: 0, untrustedDrops: 0, rateLimitDrops: 0 };
  readonly arpInspectionStats = { inspected: 0, drops: 0 };

  constructor(id: string, hostname = "Switch") {
    super(id);
    for (let n = 1; n <= 24; n++) this.addPort(`FastEthernet0/${n}`, `Fa0/${n}`);
    for (let n = 1; n <= 2; n++) this.addPort(`GigabitEthernet0/${n}`, `Gi0/${n}`);
    this.config = this.factoryConfig(hostname);
    this.stack = new IpStack({
      clock: () => this.clock,
      interfaces: () => this.l3Interfaces(),
      forwarding: () => this.config.ipRouting,
      queueWhileArping: false,
      initialTtl: 255,
      localRoutes: false,
      defaultGateway: () => this.config.defaultGateway,
      filter: (iface, packet, direction) => permitsStandardAcl(this.config, iface.name, packet, direction),
    });
  }

  protected factoryConfig(hostname: string): IosConfig {
    const c = defaultConfig(hostname, [...this.ports.map((p) => ({ name: p.name, shutdown: false })), { name: "Vlan1", shutdown: true }]);
    for (const p of this.ports) c.interfaces[p.name].switchport = defaultSwitchport();
    return c;
  }

  private addPort(name: string, shortName: string): void {
    const port = new Port(this, name, shortName, nextMac("00e0b0"));
    this.ports.push(port);
    const config = () => this.config.interfaces[name];
    this.l3.set(port, {
      name,
      mac: port.mac,
      get ip() { return config().ip; },
      get mask() { return config().mask; },
      get ipv6Addresses() { return config().ipv6Addresses; },
      up: () => this.config.ipRouting && !config().switchport && port.protocolUp,
      transmit: (frame) => this.send(port, frame),
    });
  }

  interfaceTypes() {
    return [
      { name: "FastEthernet", help: "FastEthernet IEEE 802.3" },
      { name: "GigabitEthernet", help: "GigabitEthernet IEEE 802.3z" },
      { name: "Vlan", help: "Catalyst Vlans" },
    ];
  }

  /** The SVIs in a config, in VLAN order. */
  sviNames(c: IosConfig = this.config): string[] {
    return Object.keys(c.interfaces)
      .filter((n) => sviVlan(n) !== null)
      .sort((a, b) => sviVlan(a)! - sviVlan(b)!);
  }

  configInterfaceOrder(c: IosConfig): string[] {
    return [...this.ports.map((p) => p.name), ...this.sviNames(c)];
  }

  interfaces(): InterfaceView[] {
    const physical: InterfaceView[] = this.ports.map((port) => ({
      name: port.name,
      shortName: port.shortName,
      mac: port.mac,
      port,
      routed: !this.config.interfaces[port.name].switchport,
      status: () => port.status(),
      protocol: () => (port.protocolUp ? "up" : "down"),
    }));
    const svis: InterfaceView[] = this.sviNames().map((name) => ({
      name,
      shortName: `Vl${sviVlan(name)}`,
      mac: this.baseMac,
      port: null,
      routed: true,
      status: () => (this.config.interfaces[name]?.shutdown ? "administratively down" : this.sviUp.has(name) ? "up" : "down"),
      protocol: () => (this.sviUp.has(name) ? "up" : "down"),
    }));
    return [...physical, ...svis];
  }

  l3Interfaces(): L3Interface[] {
    const routed = this.ports.filter((p) => !this.config.interfaces[p.name].switchport).map((p) => this.l3.get(p)!);
    return [...routed, ...this.sviNames().map((n) => this.svi(n))];
  }

  private svi(name: string): L3Interface {
    let svi = this.svis.get(name);
    if (!svi) {
      const vlan = sviVlan(name)!;
      const config = () => this.config.interfaces[name];
      svi = {
        name,
        // Every SVI on a 2960 answers with the switch's base MAC.
        mac: this.baseMac,
        get ip() {
          return config()?.ip ?? null;
        },
        get mask() {
          return config()?.mask ?? null;
        },
        get ipv6Addresses() {
          return config()?.ipv6Addresses ?? [];
        },
        up: () => this.sviUp.has(name),
        transmit: (frame) => this.forward(frame, null, vlan),
      };
      this.svis.set(name, svi);
    }
    return svi;
  }

  canCreateInterface(name: string): string | null {
    const vlan = sviVlan(name);
    return vlan !== null && vlan >= 1 && vlan <= 4094 ? `Vlan${vlan}` : null;
  }

  createInterface(name: string): void {
    // Only Vlan1 ships shut down. A new SVI is enabled and comes up once its VLAN has a forwarding port.
    this.config.interfaces[name] = newInterfaceConfig(false);
    this.updateSvis();
  }

  deleteInterface(name: string): string | null {
    if (sviVlan(name) === null) return "% Physical interfaces cannot be deleted";
    delete this.config.interfaces[name];
    if (this.sviUp.delete(name)) {
      this.emit(`%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`);
      this.logInterfaceChange(name, "protocol", false);
    }
    return null;
  }

  switchport(port: Port): SwitchportConfig {
    const sp = this.config.interfaces[port.name].switchport;
    if (!sp) throw new Error(`${this.id} port ${port.name} is routed`);
    return sp;
  }

  /** Effective PortFast state, including the global access-port default. */
  portfastEnabled(port: Port): boolean {
    const sp = this.switchport(port);
    return sp.portfast || (this.config.spanningTreePortfastDefault && this.operationalMode(port) === "access");
  }

  bpduGuardEnabled(port: Port): boolean {
    const sp = this.switchport(port);
    return sp.bpduGuard || (this.config.spanningTreeBpduGuardDefault && this.portfastEnabled(port));
  }

  rootGuardEnabled(port: Port): boolean {
    return this.switchport(port).rootGuard;
  }

  isRootInconsistent(port: Port, vlan: number): boolean {
    const until = this.rootInconsistentUntil.get(port)?.get(vlan);
    if (until === undefined) return false;
    if (until <= this.clock.now) {
      this.rootInconsistentUntil.get(port)?.delete(vlan);
      return false;
    }
    return true;
  }

  isErrDisabled(port: Port): boolean {
    return this.errDisabledPorts.has(port);
  }

  setShutdown(name: string, shutdown: boolean): void {
    if (!shutdown) {
      const port = this.ports.find((candidate) => candidate.name === name);
      if (port) this.errDisabledPorts.delete(port);
    }
    super.setShutdown(name, shutdown);
  }

  /**
   * The port's mode after DTP. Two dynamic auto ports both wait for the other
   * to ask, so they stay access ports. Routers and PCs don't speak DTP at all.
   */
  operationalMode(port: Port): OperationalMode {
    if (!port.protocolUp) return "down";
    if (!this.config.interfaces[port.name].switchport) return "down";
    const ours = this.switchport(port);
    if (ours.mode === "access" || ours.mode === "trunk") return ours.mode;
    const peer = port.peer;
    const theirs = peer && peer.device instanceof Switch ? peer.device.config.interfaces[peer.name]?.switchport : undefined;
    // A port with nonegotiate never sends DTP, so the dynamic side never hears an offer.
    if (!theirs || theirs.nonegotiate) return "access";
    if (theirs.mode === "trunk" || theirs.mode === "dynamic desirable") return "trunk";
    if (theirs.mode === "dynamic auto" && ours.mode === "dynamic desirable") return "trunk";
    return "access";
  }

  channelGroupActive(port: Port): boolean {
    const sp = this.config.interfaces[port.name].switchport;
    if (!sp) return false;
    if (sp.channelGroup === null || sp.channelMode === null) return false;
    const members = this.ports.filter((p) => this.switchport(p).channelGroup === sp.channelGroup);
    if (!members.length) return false;
    return members.every((member) => {
      const peer = member.peer;
      if (!peer || !(peer.device instanceof Switch)) return false;
      const other = peer.device.switchport(peer);
      if (other.channelGroup !== sp.channelGroup || other.channelMode === null) return false;
      if (sp.channelMode === "on" || other.channelMode === "on") return sp.channelMode === "on" && other.channelMode === "on";
      if (sp.channelMode === "active" || sp.channelMode === "passive" || other.channelMode === "active" || other.channelMode === "passive") {
        return (sp.channelMode === "active" || sp.channelMode === "passive") && (other.channelMode === "active" || other.channelMode === "passive") && (sp.channelMode === "active" || other.channelMode === "active");
      }
      return (sp.channelMode === "desirable" || sp.channelMode === "auto") && (other.channelMode === "desirable" || other.channelMode === "auto") && (sp.channelMode === "desirable" || other.channelMode === "desirable");
    });
  }

  channelMembers(port: Port): Port[] {
    const group = this.switchport(port).channelGroup;
    if (group === null || !this.channelGroupActive(port)) return [port];
    return this.ports.filter((p) => this.switchport(p).channelGroup === group).sort((a, b) => a.shortName.localeCompare(b.shortName));
  }

  channelRepresentative(port: Port): Port {
    return this.channelMembers(port)[0] ?? port;
  }

  setChannelGroup(port: Port, group: number, mode: ChannelGroupMode): void {
    const sp = this.switchport(port);
    sp.channelGroup = group;
    sp.channelMode = mode;
    this.vlanConfigChanged();
  }

  /** A VLAN that exists and can carry traffic. 1002 to 1005 exist but are unsupported. */
  vlanActive(vlan: number): boolean {
    return this.vlans.has(vlan) && !UNSUPPORTED_VLANS.has(vlan);
  }

  /** The VLANs a port carries right now. An access port in a VLAN that doesn't exist carries none. */
  vlansOn(port: Port): number[] {
    const mode = this.operationalMode(port);
    if (!this.config.interfaces[port.name].switchport) return [];
    const sp = this.switchport(port);
    if (mode === "down") return [];
    if (mode === "access") return this.vlanActive(sp.accessVlan) ? [sp.accessVlan] : [];
    return [...this.vlans.keys()].filter((v) => this.vlanActive(v) && (sp.allowed === null || sp.allowed.includes(v))).sort((a, b) => a - b);
  }

  /** Spanning tree state of a VLAN on a port. Without a VLAN, the best state of any, which is what the port light shows. */
  stpState(port: Port, vlan?: number): StpState {
    if (!port.protocolUp) return "disabled";
    const timers = this.stpSince.get(port);
    if (vlan === undefined) {
      let best: StpState = "disabled";
      for (const v of timers?.keys() ?? []) {
        const s = this.stpState(port, v);
        if (STP_RANK[s] > STP_RANK[best]) best = s;
      }
      return best;
    }
    if (this.isRootInconsistent(port, vlan)) return "blocking";
    const since = timers?.get(vlan);
    if (since === undefined) return "disabled";
    if (this.stpRole(port, vlan) === "alternate") return "blocking";
    if (this.portfastEnabled(port)) return "forwarding";
    const elapsed = this.clock.now - since;
    if (elapsed < STP_LISTENING_MS) return "listening";
    if (elapsed < STP_LISTENING_MS + STP_LEARNING_MS) return "learning";
    return "forwarding";
  }

  /** VLANs on a port that have finished listening and learning. */
  forwardingVlans(port: Port): number[] {
    return this.vlansOn(port).filter((v) => this.stpState(port, v) === "forwarding");
  }

  bridgePriority(vlan: number): number {
    return this.config.spanningTreePriority[vlan] ?? 32768;
  }

  bridgeId(vlan: number): string {
    return `${String(this.bridgePriority(vlan) + vlan).padStart(5, "0")}:${this.baseMac}`;
  }

  /** Calculates PVST-style roles across the connected switch graph. */
  stpRole(port: Port, vlan: number): StpRole {
    if (!port.protocolUp || !this.vlansOn(port).includes(vlan)) return "disabled";
    if (this.channelGroupActive(port) && this.channelRepresentative(port) !== port) return this.stpRole(this.channelRepresentative(port), vlan);
    const peer = port.peer?.device;
    if (!(peer instanceof Switch) || !port.peer) return "designated";
    const peerPort = port.peer;
    if (!peerPort.protocolUp || !peer.vlansOn(peerPort).includes(vlan)) return "designated";
    const switches = (this.network?.devices ?? []).filter((d): d is Switch => d instanceof Switch);
    const root = [...switches].sort((a, b) => a.bridgeId(vlan).localeCompare(b.bridgeId(vlan)))[0];
    if (!root) return "designated";
    const distances = new Map<Switch, number>([[root, 0]]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const sw of switches) {
        const base = distances.get(sw);
        if (base === undefined) continue;
        for (const candidate of sw.ports) {
          const other = candidate.peer?.device;
          if (!(other instanceof Switch) || !candidate.peer?.protocolUp || !candidate.protocolUp) continue;
          if (!sw.vlansOn(candidate).includes(vlan) || !(other as Switch).vlansOn(candidate.peer).includes(vlan)) continue;
          if (sw.channelGroupActive(candidate) && sw.channelRepresentative(candidate) !== candidate) continue;
          const next = base + (candidate.shortName.startsWith("Gi") ? 4 : 19);
          if (next < (distances.get(other) ?? Infinity)) { distances.set(other, next); changed = true; }
        }
      }
    }
    if (this === root) return "designated";
    const cost = (p: Port) => p.shortName.startsWith("Gi") ? 4 : 19;
    const rootPort = this.ports
      .filter((p) => p.peer?.device instanceof Switch && p.protocolUp && p.peer.protocolUp && this.vlansOn(p).includes(vlan) && (p.peer.device as Switch).vlansOn(p.peer).includes(vlan))
      .filter((p) => !this.channelGroupActive(p) || this.channelRepresentative(p) === p)
      .sort((a, b) => {
        const ac = (distances.get(a.peer!.device as Switch) ?? Infinity) + cost(a);
        const bc = (distances.get(b.peer!.device as Switch) ?? Infinity) + cost(b);
        if (ac !== bc) return ac - bc;
        const ab = (a.peer!.device as Switch).bridgeId(vlan);
        const bb = (b.peer!.device as Switch).bridgeId(vlan);
        return ab.localeCompare(bb) || a.shortName.localeCompare(b.shortName);
      })[0];
    if (rootPort === port) return "root";
    const mine = `${distances.get(this) ?? Infinity}|${this.bridgeId(vlan)}|${port.shortName}`;
    const theirs = `${distances.get(peer) ?? Infinity}|${peer.bridgeId(vlan)}|${peerPort.shortName}`;
    return mine < theirs ? "designated" : "alternate";
  }

  /** What CDP advertises as this port's native VLAN: the native VLAN on a trunk, the access VLAN otherwise. */
  cdpNativeVlan(port: Port): number | undefined {
    if (!this.config.interfaces[port.name].switchport) return undefined;
    const sp = this.switchport(port);
    return this.operationalMode(port) === "trunk" ? sp.nativeVlan : sp.accessVlan;
  }

  onPortStateChange(port: Port, layer: "link" | "protocol"): void {
    super.onPortStateChange(port, layer);
    this.syncVlans();
  }

  protected applyAdminState(name: string): void {
    if (sviVlan(name) !== null) this.updateSvis();
    else super.applyAdminState(name);
  }

  protected afterReload(): void {
    // VLANs survive a reload unless someone deleted vlan.dat.
    if (!this.vlanDat) {
      this.vlans.clear();
      for (const [id, name] of DEFAULT_VLANS) this.vlans.set(id, name);
    }
    this.macTable.clear();
    this.stpSince.clear();
    this.stpRoles.clear();
    this.lastMode.clear();
    this.errDisabledPorts.clear();
    this.rootInconsistentUntil.clear();
    this.syncVlans();
  }

  // ---- the VLAN database ----------------------------------------------------

  createVlan(id: number, name?: string): void {
    if (!this.vlans.has(id) || name !== undefined) this.vlans.set(id, name ?? defaultVlanName(id));
    this.vlanDat = true;
    this.vlanConfigChanged();
    this.propagateVtpVlan(id, this.vlans.get(id)!);
  }

  private propagateVtpVlan(id: number, name: string): void {
    if (this.config.vtpMode !== "server" || !this.config.vtpDomain) return;
    for (const port of this.ports) {
      const peer = port.peer;
      if (!peer || this.operationalMode(port) !== "trunk" || !(peer.device instanceof Switch)) continue;
      const other = peer.device;
      if (other.operationalMode(peer) !== "trunk" || other.config.vtpMode !== "client" || other.config.vtpDomain !== this.config.vtpDomain) continue;
      other.vlans.set(id, name);
      other.vlanDat = true;
      other.vlanConfigChanged();
    }
  }

  /**
   * Applies what was typed in config-vlan mode, on the way out of it. Extended
   * VLANs fail here because the switch is a VTP server, the factory default.
   */
  commitVlanConfig(ids: number[], name: string | null): string[] {
    const out: string[] = [];
    for (const id of ids) {
      if (id > MAX_NORMAL_VLAN) continue;
      // `name` already refused default VLANs out loud.
      if (name !== null && isDefaultVlan(id)) continue;
      this.createVlan(id, name ?? undefined);
    }
    const extended = ids.filter((id) => id > MAX_NORMAL_VLAN);
    if (extended.length) {
      out.push(`% Failed to create VLANs ${formatVlanList(extended)}`, "Extended VLAN(s) not allowed in current VTP mode.", "%Failed to commit extended VLAN(s) changes.");
    }
    return out;
  }

  deleteVlan(id: number): void {
    this.vlans.delete(id);
    this.vlanDat = true;
    this.vlanConfigChanged();
  }

  /**
   * Call after any VLAN or switchport change. The switch on the other end of
   * a cable may change too, because DTP negotiates with it.
   */
  vlanConfigChanged(): void {
    this.syncVlans();
    for (const p of this.ports) {
      const peer = p.peer?.device;
      if (peer instanceof Switch && peer !== this) peer.syncVlans();
    }
  }

  /** Brings spanning tree, the MAC table and the SVIs in line with the VLANs each port carries. */
  syncVlans(): void {
    if (!this.network) return;
    const now = this.clock.now;
    for (const port of this.ports) {
      const mode = this.operationalMode(port);
      if (mode === "down") {
        this.stpSince.delete(port);
        this.stpRoles.delete(port);
        this.lastMode.delete(port);
        this.flushMacs(port);
        continue;
      }
      let timers = this.stpSince.get(port);
      const was = this.lastMode.get(port);
      if (was && was !== mode) {
        // A live port that turns into a trunk, or stops being one, bounces line protocol on both ends.
        this.clock.schedule(0, () => this.network?.bounceProtocol(port));
      }
      if (was !== mode) {
        // Turning into a trunk or an access port starts spanning tree over on the port.
        timers = undefined;
        this.stpRoles.delete(port);
        this.flushMacs(port);
        this.lastMode.set(port, mode);
      }
      if (!timers) {
        timers = new Map();
        this.stpSince.set(port, timers);
      }
      const carried = new Set(this.vlansOn(port));
      let roles = this.stpRoles.get(port);
      if (!roles) {
        roles = new Map();
        this.stpRoles.set(port, roles);
      }
      for (const v of [...timers.keys()]) {
        if (carried.has(v)) {
          const role = this.stpRole(port, v);
          if (roles.get(v) !== undefined && roles.get(v) !== role) {
            timers.set(v, now);
            this.flushMacs(port, v);
          }
          roles.set(v, role);
          continue;
        }
        timers.delete(v);
        roles.delete(v);
        this.flushMacs(port, v);
      }
      for (const v of carried) {
        const role = this.stpRole(port, v);
        if (timers.has(v)) {
          if (roles.get(v) !== role) {
            timers.set(v, now);
            this.flushMacs(port, v);
          }
          roles.set(v, role);
          continue;
        }
        timers.set(v, now);
        roles.set(v, role);
        // An SVI comes up once some port in its VLAN reaches forwarding.
        this.clock.schedule(STP_LISTENING_MS + STP_LEARNING_MS, () => this.updateSvis());
      }
    }
    this.updateSvis();
  }

  private flushMacs(port: Port, vlan?: number): void {
    for (const [key, e] of this.macTable) if (e.port === port && (vlan === undefined || e.vlan === vlan)) this.macTable.delete(key);
  }

  /** Autostate: an SVI is up when it isn't shut down, its VLAN is active, and a port in that VLAN is forwarding. */
  private updateSvis(): void {
    for (const name of new Set([...this.sviNames(), ...this.sviUp])) {
      const cfg = this.config.interfaces[name];
      const vlan = sviVlan(name)!;
      const shouldBeUp = !!cfg && !cfg.shutdown && this.vlanActive(vlan) && this.ports.some((p) => this.stpState(p, vlan) === "forwarding");
      const isUp = this.sviUp.has(name);
      if (shouldBeUp === isUp) {
        if (!shouldBeUp && this.adminChanging === name) this.logInterfaceChange(name, "link", false);
        continue;
      }
      if (shouldBeUp) this.sviUp.add(name);
      else this.sviUp.delete(name);
      this.logInterfaceChange(name, "link", shouldBeUp);
      this.logInterfaceChange(name, "protocol", shouldBeUp);
    }
  }

  // ---- forwarding -------------------------------------------------------------

  liveMacEntries(): MacEntry[] {
    const now = this.clock.now;
    return [...this.macTable.values()].filter((e) => now - e.learnedAt < MAC_AGING_MS);
  }

  receive(port: Port, frame: Frame): void {
    if (this.handleCdp(port, frame)) return;
    if (this.handleLldp(port, frame)) return;
    if (this.handleBpdu(port, frame)) return;
    if (!this.config.interfaces[port.name].switchport) {
      const iface = this.l3.get(port);
      if (iface?.up()) this.stack.handleFrame(iface, retag(frame, undefined));
      return;
    }
    const vlan = this.ingressVlan(port, frame);
    if (vlan === null) return;
    const state = this.stpState(port, vlan);
    if (state === "disabled" || state === "listening") return;
    const sp = this.switchport(port);
    const dhcp = frame.payload.kind === "ipv4" ? frame.payload.dhcp : undefined;
    if (dhcp && this.config.dhcpSnooping && this.config.dhcpSnoopingVlans.includes(vlan)) {
      this.dhcpSnoopingStats.processed++;
      if ((dhcp.op === "offer" || dhcp.op === "ack") && !sp.dhcpTrust) {
        this.dhcpSnoopingStats.untrustedDrops++;
        this.emit(`%DHCP_SNOOPING-5-DHCP_SNOOPING_UNTRUSTED_PORT: DHCP ${dhcp.op.toUpperCase()} dropped on untrusted port ${port.shortName}.`);
        return;
      }
      if ((dhcp.op === "discover" || dhcp.op === "request" || dhcp.op === "release") && sp.dhcpRateLimit !== null) {
        const window = this.dhcpRateWindows.get(port);
        const next = !window || this.clock.now - window.started >= 1_000 ? { started: this.clock.now, count: 0 } : window;
        next.count++;
        this.dhcpRateWindows.set(port, next);
        if (next.count > sp.dhcpRateLimit) {
          this.dhcpSnoopingStats.rateLimitDrops++;
          this.emit(`%DHCP_SNOOPING-4-DHCP_RATE_LIMIT_EXCEEDED: DHCP packet rate limit exceeded on port ${port.shortName}.`);
          return;
        }
      }
    }
    const arp = frame.payload.kind === "arp" ? frame.payload : undefined;
    if (arp && this.config.arpInspectionVlans.includes(vlan) && !sp.arpInspectionTrust) {
      this.arpInspectionStats.inspected++;
      const valid = this.config.dhcpSnoopingBindings.some((b) => b.vlan === vlan && b.port === port.shortName && b.mac === arp.senderMac && b.ip === arp.senderIp);
      if (!valid) {
        this.arpInspectionStats.drops++;
        this.emit(`%SW_DAI-4-DHCP_SNOOPING_DENY: ARP packet denied on ${port.shortName}; source MAC ${arp.senderMac} and IP ${arp.senderIp} do not match a DHCP snooping binding.`);
        return;
      }
    }
    if (sp.portSecurity && frame.src !== BROADCAST_MAC) {
      if (!sp.secureMacs.includes(frame.src)) {
        if (sp.secureMacs.length >= sp.portSecurityMaximum) {
          this.emit(`%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${frame.src} on port ${port.shortName}.`);
          if (sp.portSecurityViolation === "shutdown") this.setShutdown(port.name, true);
          if (sp.portSecurityViolation !== "protect") return;
        } else {
          sp.secureMacs.push(frame.src);
        }
      }
    }
    if (frame.src !== BROADCAST_MAC) this.macTable.set(`${vlan}:${frame.src}`, { mac: frame.src, vlan, port, learnedAt: this.clock.now });
    if (state === "learning") return;

    const untagged = retag(frame, undefined);
    const svi = `Vlan${vlan}`;
    if (this.sviUp.has(svi) && (frame.dst === this.baseMac || frame.dst === BROADCAST_MAC)) {
      this.stack.handleFrame(this.svi(svi), untagged);
      if (frame.dst === this.baseMac) return;
    }
    this.forward(untagged, port, vlan);
  }

  private handleBpdu(port: Port, frame: Frame): boolean {
    if (!this.config.interfaces[port.name].switchport) return frame.payload.kind === "bpdu";
    if (frame.payload.kind === "bpdu" && this.rootGuardEnabled(port)) {
      const bpdu = frame.payload;
      const vlan = bpdu.vlan;
      const receivedId = bpdu.rootPriority + vlan;
      const localId = this.bridgePriority(vlan) + vlan;
      const superior = receivedId < localId || (receivedId === localId && bpdu.rootMac < this.baseMac);
      if (superior && !this.isRootInconsistent(port, vlan)) {
        let vlans = this.rootInconsistentUntil.get(port);
        if (!vlans) { vlans = new Map(); this.rootInconsistentUntil.set(port, vlans); }
        vlans.set(vlan, this.clock.now + 20_000);
        this.emit(`%SPANTREE-2-ROOTGUARD_BLOCK: Root guard blocking port ${port.shortName} on VLAN ${vlan}.`);
      }
    }
    if (frame.payload.kind === "bpdu" && this.portfastEnabled(port) && this.bpduGuardEnabled(port) && !port.adminDown) {
      this.emit(`%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${port.shortName} with BPDU Guard enabled. Disabling port.`);
      this.errDisabledPorts.add(port);
      this.emit(`%PM-4-ERR_DISABLE: bpduguard error detected on ${port.shortName}, putting ${port.shortName} in err-disable state`);
      this.setShutdown(port.name, true);
    }
    return frame.payload.kind === "bpdu";
  }

  /** Supplies a real control frame to Network's periodic background sender. */
  backgroundFrame(port: Port): Frame | null {
    const vlan = this.vlansOn(port)[0];
    if (vlan === undefined) return null;
    const payload: BpduPacket = {
      kind: "bpdu",
      vlan,
      rootPriority: this.bridgePriority(vlan),
      rootMac: this.baseMac,
      rootPathCost: 0,
      bridgePriority: this.bridgePriority(vlan),
      bridgeMac: this.baseMac,
      portId: port.shortName,
    };
    return { src: port.mac, dst: STP_MAC, payload };
  }

  /**
   * Which VLAN a frame belongs to as it comes in, or null to drop it. Access
   * ports drop tagged frames. Trunks put untagged frames in the native VLAN.
   */
  private ingressVlan(port: Port, frame: Frame): number | null {
    const mode = this.operationalMode(port);
    const sp = this.switchport(port);
    let vlan: number;
    if (mode === "access") {
      if (frame.vlan !== undefined) return null;
      vlan = sp.accessVlan;
    } else if (mode === "trunk") {
      vlan = frame.vlan ?? sp.nativeVlan;
    } else {
      return null;
    }
    return this.vlansOn(port).includes(vlan) ? vlan : null;
  }

  private forward(frame: Frame, ingress: Port | null, vlan: number): void {
    if (frame.dst !== BROADCAST_MAC) {
      const entry = this.macTable.get(`${vlan}:${frame.dst}`);
      if (entry && this.clock.now - entry.learnedAt < MAC_AGING_MS) {
        if (entry.port !== ingress && this.stpState(entry.port, vlan) === "forwarding") this.egress(entry.port, frame, vlan);
        return;
      }
    }
    for (const p of this.ports) {
      if (p !== ingress && this.stpState(p, vlan) === "forwarding") this.egress(p, frame, vlan);
    }
  }

  /** Trunks tag every VLAN except the native one. Access ports send frames untagged. */
  private egress(port: Port, frame: Frame, vlan: number): void {
    const dhcp = frame.payload.kind === "ipv4" ? frame.payload.dhcp : undefined;
    const sp = this.switchport(port);
    if (dhcp?.op === "ack" && this.config.dhcpSnooping && this.config.dhcpSnoopingVlans.includes(vlan) && !sp.dhcpTrust && dhcp.yiaddr !== 0) {
      this.config.dhcpSnoopingBindings = this.config.dhcpSnoopingBindings.filter((b) => !(b.vlan === vlan && b.port === port.shortName && b.mac === dhcp.chaddr));
      this.config.dhcpSnoopingBindings.push({ mac: dhcp.chaddr, ip: dhcp.yiaddr, vlan, port: port.shortName, learnedAt: this.clock.now });
    }
    const tagged = this.operationalMode(port) === "trunk" && vlan !== this.switchport(port).nativeVlan;
    this.send(port, retag(frame, tagged ? vlan : undefined));
  }
}
