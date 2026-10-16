import type { Mac } from "./addr";
import { Clock } from "./clock";
import type { Frame } from "./frames";

export type DeviceKind = "router" | "switch" | "pc";

export type CableType = "straight-through" | "crossover" | "console";
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

  get clock(): Clock {
    if (!this.network) throw new Error(`${this.id} is not on a network`);
    return this.network.clock;
  }

  port(name: string): Port {
    const p = this.ports.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.shortName.toLowerCase() === name.toLowerCase());
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

/** Switches cross their pairs internally (MDI-X); PCs and routers don't (MDI). */
function crossesPairs(port: Port): boolean {
  return port.device.kind === "switch";
}

/** Whether this cable type brings the link up between these two ports. */
export function cableWorks(a: Port, b: Port): boolean {
  const unlike = crossesPairs(a) !== crossesPairs(b);
  return a.cable === (unlike ? "straight-through" : "crossover");
}

/** The cable a technician should have used between two Ethernet ports. */
export function correctCable(a: Port, b: Port): CableType {
  return crossesPairs(a) !== crossesPairs(b) ? "straight-through" : "crossover";
}

/** One cable hop takes this long. */
export const HOP_DELAY_MS = 0.25;
/** Line protocol follows the physical link after this long. */
export const LINEPROTO_DELAY_MS = 1000;

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
   * Plugs a cable between two ports. Ethernet cables plug into any Ethernet
   * port, but the link only comes up with the right type: straight-through
   * between unlike devices (PC or router to switch), crossover between like
   * ones. Cryptis gear predates auto-MDIX.
   */
  connect(a: Port, b: Port, cable: CableType = "straight-through"): void {
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

  private refreshOne(port: Port): void {
    const up = !!port.peer && port.kind === "ethernet" && cableWorks(port, port.peer) && !port.adminDown && !port.peer.adminDown;
    if (up === port.linkUp) return;
    port.linkUp = up;
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
      }
    });
  }

  transmit(from: Port, frame: Frame): void {
    const to = from.peer;
    if (!to || !from.protocolUp) return;
    this.clock.schedule(HOP_DELAY_MS, () => {
      if (to.protocolUp && to.peer === from) to.device.receive(to, frame);
    });
  }
}
