import { BROADCAST_MAC, nextMac, type Mac } from "../addr";
import { retag, type Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { defaultConfig, defaultSwitchport, newInterfaceConfig, type IosConfig, type SwitchportConfig } from "../ios/config";
import { Port } from "../network";
import { DEFAULT_VLANS, MAX_NORMAL_VLAN, UNSUPPORTED_VLANS, defaultVlanName, formatVlanList, isDefaultVlan, sviVlan } from "../vlans";
import { IosDevice, type InterfaceView } from "./ios-device";

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

export type StpState = "disabled" | "listening" | "learning" | "forwarding";
const STP_RANK: Record<StpState, number> = { disabled: 0, listening: 1, learning: 2, forwarding: 3 };

/** What a port is doing right now, after DTP has had its say. */
export type OperationalMode = "access" | "trunk" | "down";

/** Cryptis CS-2960: 24 FastEthernet ports and 2 gigabit uplinks, 802.1Q trunking only. */
export class Switch extends IosDevice {
  readonly kind = "switch" as const;
  readonly model = "CS-2960-24TT";
  protected readonly defaultHostname = "Switch";
  readonly stack: IpStack;
  readonly baseMac: Mac = nextMac("00e0b0");
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
  private readonly lastMode = new Map<Port, OperationalMode>();
  private readonly svis = new Map<string, L3Interface>();
  private readonly sviUp = new Set<string>();

  constructor(id: string, hostname = "Switch") {
    super(id);
    for (let n = 1; n <= 24; n++) this.addPort(`FastEthernet0/${n}`, `Fa0/${n}`);
    for (let n = 1; n <= 2; n++) this.addPort(`GigabitEthernet0/${n}`, `Gi0/${n}`);
    this.config = this.factoryConfig(hostname);
    this.stack = new IpStack({
      clock: () => this.clock,
      interfaces: () => this.l3Interfaces(),
      forwarding: false,
      queueWhileArping: false,
      initialTtl: 255,
      localRoutes: false,
      defaultGateway: () => this.config.defaultGateway,
    });
  }

  protected factoryConfig(hostname: string): IosConfig {
    const c = defaultConfig(hostname, [...this.ports.map((p) => ({ name: p.name, shutdown: false })), { name: "Vlan1", shutdown: true }]);
    for (const p of this.ports) c.interfaces[p.name].switchport = defaultSwitchport();
    return c;
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
      routed: false,
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
    return this.sviNames().map((n) => this.svi(n));
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
    return this.config.interfaces[port.name].switchport!;
  }

  /**
   * The port's mode after DTP. Two dynamic auto ports both wait for the other
   * to ask, so they stay access ports. Routers and PCs don't speak DTP at all.
   */
  operationalMode(port: Port): OperationalMode {
    if (!port.protocolUp) return "down";
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

  /** A VLAN that exists and can carry traffic. 1002 to 1005 exist but are unsupported. */
  vlanActive(vlan: number): boolean {
    return this.vlans.has(vlan) && !UNSUPPORTED_VLANS.has(vlan);
  }

  /** The VLANs a port carries right now. An access port in a VLAN that doesn't exist carries none. */
  vlansOn(port: Port): number[] {
    const mode = this.operationalMode(port);
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
    const since = timers?.get(vlan);
    if (since === undefined) return "disabled";
    const elapsed = this.clock.now - since;
    if (elapsed < STP_LISTENING_MS) return "listening";
    if (elapsed < STP_LISTENING_MS + STP_LEARNING_MS) return "learning";
    return "forwarding";
  }

  /** VLANs on a port that have finished listening and learning. */
  forwardingVlans(port: Port): number[] {
    return this.vlansOn(port).filter((v) => this.stpState(port, v) === "forwarding");
  }

  /** What CDP advertises as this port's native VLAN: the native VLAN on a trunk, the access VLAN otherwise. */
  cdpNativeVlan(port: Port): number | undefined {
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
    this.lastMode.clear();
    this.syncVlans();
  }

  // ---- the VLAN database ----------------------------------------------------

  createVlan(id: number, name?: string): void {
    if (!this.vlans.has(id) || name !== undefined) this.vlans.set(id, name ?? defaultVlanName(id));
    this.vlanDat = true;
    this.vlanConfigChanged();
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
        this.flushMacs(port);
        this.lastMode.set(port, mode);
      }
      if (!timers) {
        timers = new Map();
        this.stpSince.set(port, timers);
      }
      const carried = new Set(this.vlansOn(port));
      for (const v of [...timers.keys()]) {
        if (carried.has(v)) continue;
        timers.delete(v);
        this.flushMacs(port, v);
      }
      for (const v of carried) {
        if (timers.has(v)) continue;
        timers.set(v, now);
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
    const vlan = this.ingressVlan(port, frame);
    if (vlan === null) return;
    const state = this.stpState(port, vlan);
    if (state === "disabled" || state === "listening") return;
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
    const tagged = this.operationalMode(port) === "trunk" && vlan !== this.switchport(port).nativeVlan;
    this.send(port, retag(frame, tagged ? vlan : undefined));
  }
}
