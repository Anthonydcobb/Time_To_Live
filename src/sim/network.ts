import type { Mac } from "./addr";
import { Clock } from "./clock";
import type { Frame } from "./frames";

export type DeviceKind = "router" | "switch" | "pc";

export type CableType = "ethernet" | "console";
export type PortKind = "ethernet" | "console";

export class CableError extends Error {}

/** A physical port. Whether it is shut down lives in the owning device's config. */
export class Port {
  peer: Port | null = null;
  cable: CableType | null = null;
  /** Layer 1: cable present and both ends not shut down. */
  linkUp = false;
  /** Layer 2: comes up shortly after the link does. Frames only flow when this is true. */
  protocolUp = false;
  /** Autonegotiation is under way and the link will come up shortly. */
  negotiating = false;
  /** Counters for `show interfaces`. */
  readonly stats = newPortStats();

  constructor(
    readonly device: Device,
    readonly name: string,
    readonly shortName: string,
    readonly mac: Mac,
    readonly kind: PortKind = "ethernet",
  ) {}

  get adminDown(): boolean {
    return this.device.isPortShutdown(this);
  }

  status(): "administratively down" | "down" | "up" {
    if (this.adminDown) return "administratively down";
    return this.linkUp ? "up" : "down";
  }
}

export interface PortStats {
  inPackets: number;
  inBytes: number;
  inBroadcasts: number;
  outPackets: number;
  outBytes: number;
  outBroadcasts: number;
  /** Clock times of the last frame in and out, or null for never. */
  lastIn: number | null;
  lastOut: number | null;
  resets: number;
}

function newPortStats(): PortStats {
  return { inPackets: 0, inBytes: 0, inBroadcasts: 0, outPackets: 0, outBytes: 0, outBroadcasts: 0, lastIn: null, lastOut: null, resets: 0 };
}

/** Rough on-the-wire size of a frame without the FCS, which is what IOS counts. */
export function frameBytes(frame: Frame): number {
  const p = frame.payload;
  // An IOS ping is a 100-byte datagram; DHCP rides in a ~300-byte BOOTP packet; CDP carries a few TLVs.
  const body = p.kind === "arp" ? 46 : p.kind === "cdp" ? 340 : p.kind === "lldp" ? 180 : p.kind === "bpdu" ? 52 : p.kind === "ipv4" && p.dhcp ? 328 : p.kind === "ipv4" && p.dns ? 80 : 100;
  return 14 + body + (frame.vlan !== undefined ? 4 : 0);
}

const isBroadcast = (mac: Mac) => parseInt(mac.slice(0, 2), 16) % 2 === 1;

function count(stats: PortStats, dir: "in" | "out", bytes: number, broadcast: boolean, now: number): void {
  if (dir === "in") {
    stats.inPackets++;
    stats.inBytes += bytes;
    if (broadcast) stats.inBroadcasts++;
    stats.lastIn = now;
  } else {
    stats.outPackets++;
    stats.outBytes += bytes;
    if (broadcast) stats.outBroadcasts++;
    stats.lastOut = now;
  }
}

/** Ethernet keepalives go out every 10 seconds on router and switch ports. */
export const KEEPALIVE_MS = 10_000;
/** Spanning tree hello time: a switch sends a BPDU out each port every 2 seconds. */
export const BPDU_MS = 2_000;

export type OutputListener = (text: string) => void;

export abstract class Device {
  abstract readonly kind: DeviceKind;
  readonly ports: Port[] = [];
  network: Network | null = null;
  private listeners = new Set<OutputListener>();

  constructor(readonly id: string) {}

  abstract get hostname(): string;
  abstract isPortShutdown(port: Port): boolean;
  abstract receive(port: Port, frame: Frame): void;

  /** Called once the device is on a network and has a clock. */
  onAttach(): void {}

  /** Called after a port's link or protocol state changes. */
  onPortStateChange(_port: Port, _layer: "link" | "protocol"): void {}

  /** Optional periodic control frame, such as a switch BPDU. */
  backgroundFrame(_port: Port): Frame | null { return null; }

  get clock(): Clock {
    if (!this.network) throw new Error(`${this.id} is not on a network`);
    return this.network.clock;
  }

  /** Finds a port by full name or short name. "Gig0/1" works too, the way Packet Tracer writes it. */
  port(name: string): Port {
    const want = name.toLowerCase().replace(/^gig(?=\d)/, "gi");
    const p = this.ports.find((x) => x.name.toLowerCase() === want || x.shortName.toLowerCase() === want);
    if (!p) throw new Error(`${this.id} has no port ${name}`);
    return p;
  }

  send(port: Port, frame: Frame): void {
    this.network?.transmit(port, frame);
  }

  /** Unsolicited console output, such as %LINK messages. */
  emit(text: string): void {
    for (const l of this.listeners) l(text);
  }

  onOutput(listener: OutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** One cable hop takes this long. */
export const HOP_DELAY_MS = 0.25;
/**
 * Ethernet autonegotiation: the link comes up this long after both ends are
 * cabled and enabled. Going down is instant.
 */
export const LINK_NEGOTIATION_MS = 2000;
/** Line protocol follows the physical link after this long. Measured on real IOS (Ant's CML capture). */
export const LINEPROTO_DELAY_MS = 1000;

/** How long line protocol stays down when a switch port changes between access and trunk. Measured in CML. */
export const PORT_BOUNCE_MS = 3000;

export class Network {
  readonly clock = new Clock();
  readonly devices: Device[] = [];

  add<T extends Device>(device: T): T {
    device.network = this;
    this.devices.push(device);
    device.onAttach();
    return device;
  }

  device(id: string): Device {
    const d = this.devices.find((x) => x.id === id);
    if (!d) throw new Error(`No device ${id}`);
    return d;
  }

  /**
   * Plugs a cable between two ports. Any Ethernet cable links any two Ethernet
   * ports (auto-MDIX), and console cables only fit console ports.
   */
  connect(a: Port, b: Port, cable: CableType = "ethernet"): void {
    if (a === b) throw new CableError("A cable needs two different ports.");
    if (a.peer || b.peer) throw new CableError("That port already has a cable in it.");
    const wantKind: PortKind = cable === "console" ? "console" : "ethernet";
    if (a.kind !== wantKind || b.kind !== wantKind) {
      throw new CableError(cable === "console" ? "A console cable only fits console ports." : "An Ethernet cable doesn't fit a console port.");
    }
    a.peer = b;
    b.peer = a;
    a.cable = b.cable = cable;
    this.refresh(a);
  }

  disconnect(port: Port): void {
    const peer = port.peer;
    if (!peer) return;
    port.peer = null;
    peer.peer = null;
    port.cable = peer.cable = null;
    this.refreshOne(port);
    this.refreshOne(peer);
  }

  /** Re-evaluates link state for a port and whatever it is cabled to. */
  refresh(port: Port): void {
    this.refreshOne(port);
    if (port.peer) this.refreshOne(port.peer);
  }

  private canLink(port: Port): boolean {
    return !!port.peer && port.kind === "ethernet" && !port.adminDown && !port.peer.adminDown;
  }

  private refreshOne(port: Port): void {
    const up = this.canLink(port);
    if (up === port.linkUp) return;
    if (up) {
      if (port.negotiating) return;
      port.negotiating = true;
      const peer = port.peer;
      this.clock.schedule(LINK_NEGOTIATION_MS, () => {
        port.negotiating = false;
        if (!port.linkUp && port.peer === peer && this.canLink(port)) this.setLink(port, true);
      });
      return;
    }
    this.setLink(port, false);
  }

  private setLink(port: Port, up: boolean): void {
    port.linkUp = up;
    port.stats.resets++;
    port.device.onPortStateChange(port, "link");
    if (!up) {
      if (port.protocolUp) {
        port.protocolUp = false;
        port.device.onPortStateChange(port, "protocol");
      }
      return;
    }
    this.clock.schedule(LINEPROTO_DELAY_MS, () => {
      if (port.linkUp && !port.protocolUp) {
        port.protocolUp = true;
        port.device.onPortStateChange(port, "protocol");
        this.startBackgroundFrames(port);
      }
    });
  }

  /**
   * Drops line protocol on both ends of a link and brings it back after a
   * pause, the way a Catalyst bounces a port that turns into a trunk or back.
   */
  bounceProtocol(port: Port, downMs = PORT_BOUNCE_MS): void {
    const ends = [port, port.peer].filter((p): p is Port => !!p && p.protocolUp);
    for (const p of ends) {
      p.protocolUp = false;
      p.device.onPortStateChange(p, "protocol");
    }
    this.clock.schedule(downMs, () => {
      for (const p of ends) {
        if (!p.linkUp || p.protocolUp) continue;
        p.protocolUp = true;
        p.device.onPortStateChange(p, "protocol");
        this.startBackgroundFrames(p);
      }
    });
  }

  transmit(from: Port, frame: Frame): void {
    const to = from.peer;
    if (!to || !from.protocolUp) return;
    const bytes = frameBytes(frame);
    const broadcast = isBroadcast(frame.dst);
    count(from.stats, "out", bytes, broadcast, this.clock.now);
    this.clock.schedule(HOP_DELAY_MS, () => {
      if (!to.protocolUp || to.peer !== from) return;
      count(to.stats, "in", bytes, broadcast, this.clock.now);
      to.device.receive(to, frame);
    });
  }

  /** Keepalives and BPDUs explain the quiet background traffic on IOS ports. */
  private startBackgroundFrames(port: Port): void {
    const kind = port.device.kind;
    if (kind === "pc") return;
    // Every link change bumps the reset count, which ends this run of ticks.
    const gen = port.stats.resets;
    const every = (ms: number, peerSees: boolean) => {
      const tick = () => {
        if (!port.protocolUp || port.stats.resets !== gen) return;
        const frame = port.device.backgroundFrame(port);
        if (frame) this.transmit(port, frame);
        else {
          count(port.stats, "out", 60, true, this.clock.now);
          const to = port.peer;
          if (peerSees && to?.protocolUp) count(to.stats, "in", 60, true, this.clock.now);
        }
        this.clock.schedule(ms, tick);
      };
      this.clock.schedule(ms, tick);
    };
    every(KEEPALIVE_MS, false);
    if (kind === "switch") every(BPDU_MS, true);
  }
}
