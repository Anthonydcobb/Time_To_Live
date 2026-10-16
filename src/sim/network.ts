import type { Mac } from "./addr";
import { Clock } from "./clock";
import type { Frame } from "./frames";

export type DeviceKind = "router" | "switch" | "pc";

/** A physical port. Whether it is shut down lives in the owning device's config. */
export class Port {
  peer: Port | null = null;
  /** Layer 1: cable present and both ends not shut down. */
  linkUp = false;
  /** Layer 2: comes up shortly after the link does. Frames only flow when this is true. */
  protocolUp = false;

  constructor(
    readonly device: Device,
    readonly name: string,
    readonly shortName: string,
    readonly mac: Mac,
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
    return device;
  }

  device(id: string): Device {
    const d = this.devices.find((x) => x.id === id);
    if (!d) throw new Error(`No device ${id}`);
    return d;
  }

  connect(a: Port, b: Port): void {
    if (a === b) throw new Error("Cannot cable a port to itself");
    if (a.peer || b.peer) throw new Error("Port already has a cable");
    a.peer = b;
    b.peer = a;
    this.refresh(a);
  }

  disconnect(port: Port): void {
    const peer = port.peer;
    if (!peer) return;
    port.peer = null;
    peer.peer = null;
    this.refreshOne(port);
    this.refreshOne(peer);
  }

  /** Re-evaluates link state for a port and whatever it is cabled to. */
  refresh(port: Port): void {
    this.refreshOne(port);
    if (port.peer) this.refreshOne(port.peer);
  }

  private refreshOne(port: Port): void {
    const up = !!port.peer && !port.adminDown && !port.peer.adminDown;
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
