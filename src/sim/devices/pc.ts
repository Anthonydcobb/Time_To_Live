import { nextMac, type Ipv4 } from "../addr";
import type { Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { Device, Port } from "../network";
import { PcShell } from "../pc/shell";

/** A desktop PC. In the game its IP settings come from a GUI panel; the shell mirrors them. */
export class Pc extends Device {
  readonly kind = "pc" as const;
  ip: Ipv4 | null = null;
  mask: Ipv4 | null = null;
  gateway: Ipv4 | null = null;
  readonly nic: Port;
  readonly stack: IpStack;
  readonly shell: PcShell;
  private readonly l3: L3Interface;

  constructor(id: string, readonly name = id) {
    super(id);
    this.nic = new Port(this, "FastEthernet0", "Fa0", nextMac("0060a8"));
    this.ports.push(this.nic);
    const self = this;
    this.l3 = {
      name: "FastEthernet0",
      mac: this.nic.mac,
      get ip() {
        return self.ip;
      },
      get mask() {
        return self.mask;
      },
      up: () => this.nic.protocolUp,
      transmit: (frame) => this.send(this.nic, frame),
    };
    this.stack = new IpStack({
      clock: () => this.clock,
      interfaces: () => [this.l3],
      forwarding: false,
      queueWhileArping: true,
      initialTtl: 128,
      localRoutes: false,
      defaultGateway: () => this.gateway,
    });
    this.shell = new PcShell(this);
  }

  get hostname(): string {
    return this.name;
  }

  isPortShutdown(): boolean {
    return false;
  }

  configure(ip: Ipv4 | null, mask: Ipv4 | null, gateway: Ipv4 | null = null): void {
    this.ip = ip;
    this.mask = mask;
    this.gateway = gateway;
    this.stack.arp.clear();
  }

  receive(_port: Port, frame: Frame): void {
    this.stack.handleFrame(this.l3, frame);
  }
}
