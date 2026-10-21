import { nextMac, type Ipv4, type Ipv6, type Mac } from "../addr";
import type { Frame } from "../frames";
import { IpStack, type L3Interface } from "../ipstack";
import { Device, Port } from "../network";
import { IosDevice } from "./ios-device";
import { PcShell } from "../pc/shell";
import { apipaFor, DhcpClient, type DhcpLease } from "../dhcp";
import { PcTerminal } from "../pc/terminal";

/** Windows tries DHCP again this long after it fell back to a link-local address. */
export const DHCP_RETRY_MS = 5 * 60_000;

/** A desktop PC. In the game its IP settings come from a GUI panel; the shell mirrors them. */
export class Pc extends Device {
  readonly kind = "pc" as const;
  ip: Ipv4 | null = null;
  mask: Ipv4 | null = null;
  gateway: Ipv4 | null = null;
  ipv6Addresses: { address: Ipv6; prefix: number }[] = [];
  dnsServers: Ipv4[] = [];
  /** Obtain an address automatically. When false, the address was set by hand. */
  dhcp = false;
  lease: DhcpLease | null = null;
  /** True when DHCP failed and Windows gave itself a 169.254.x.x address. */
  autoconfigured = false;
  readonly dhcpClient: DhcpClient;
  readonly nic: Port;
  /** Serial port for a console cable to a router or switch. */
  readonly rs232: Port;
  readonly stack: IpStack;
  readonly shell: PcShell;
  readonly terminal: PcTerminal;
  private readonly l3: L3Interface;

  constructor(id: string, readonly name = id, mac: Mac = nextMac("0060a8")) {
    super(id);
    this.nic = new Port(this, "FastEthernet0", "Fa0", mac);
    this.ports.push(this.nic);
    this.rs232 = new Port(this, "RS 232", "RS232", "000000000000", "console");
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
      get ipv6Addresses() {
        return self.ipv6Addresses;
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
      onDhcp: (_iface, packet) => this.dhcpClient.handle(packet),
    });
    this.dhcpClient = new DhcpClient({
      clock: () => this.clock,
      mac: this.nic.mac,
      linkUp: () => this.nic.protocolUp,
      transmit: (frame) => this.send(this.nic, frame),
    });
    this.shell = new PcShell(this);
    this.terminal = new PcTerminal(this);
  }

  get hostname(): string {
    return this.name;
  }

  isPortShutdown(): boolean {
    return false;
  }

  /** Sets a static address, like typing it into the adapter's IPv4 settings. */
  configure(ip: Ipv4 | null, mask: Ipv4 | null, gateway: Ipv4 | null = null): void {
    this.dhcp = false;
    this.dhcpClient.cancel();
    this.lease = null;
    this.autoconfigured = false;
    this.dnsServers = [];
    this.setAddress(ip, mask, gateway);
  }

  configureIpv6(address: Ipv6 | null, prefix: number): void {
    this.ipv6Addresses = address === null ? [] : [{ address, prefix }];
  }

  private setAddress(ip: Ipv4 | null, mask: Ipv4 | null, gateway: Ipv4 | null): void {
    this.ip = ip;
    this.mask = mask;
    this.gateway = gateway;
    this.stack.arp.clear();
  }

  /** Switches to "obtain an address automatically" and asks for a lease right away. */
  useDhcp(done?: (lease: DhcpLease | null) => void): void {
    this.dhcp = true;
    this.renew(done);
  }

  /** `ipconfig /renew`: asks for a lease, falling back to 169.254.x.x if nobody answers. */
  renew(done?: (lease: DhcpLease | null) => void): void {
    if (!this.lease) this.setAddress(null, null, null);
    this.dhcpClient.start((lease) => {
      if (lease) {
        this.lease = lease;
        this.autoconfigured = false;
        this.dnsServers = lease.dnsServers;
        this.setAddress(lease.ip, lease.mask, lease.gateway);
      } else if (!this.lease) {
        this.autoconfigured = true;
        this.setAddress(apipaFor(this.nic.mac), 0xffff0000, null);
        this.scheduleRetry();
      }
      done?.(lease);
    });
  }

  /** `ipconfig /release`: gives the lease back and drops the address. */
  release(): void {
    if (this.lease && this.ip !== null) this.dhcpClient.release(this.lease, this.ip);
    else this.dhcpClient.cancel();
    this.lease = null;
    this.autoconfigured = false;
    this.dnsServers = [];
    this.setAddress(null, null, null);
  }

  private scheduleRetry(): void {
    this.clock.schedule(DHCP_RETRY_MS, () => {
      if (this.dhcp && this.autoconfigured && !this.dhcpClient.busy) this.renew();
    });
  }

  onPortStateChange(port: Port, layer: "link" | "protocol"): void {
    // Plugging in the cable starts DHCP if the adapter is set to obtain an address automatically.
    if (port === this.nic && layer === "protocol" && port.protocolUp && this.dhcp && !this.lease && !this.dhcpClient.busy) this.renew();
  }

  /** The device whose console this PC's terminal program would talk to, if any. */
  consoleTarget(): IosDevice | null {
    const far = this.rs232.peer?.device;
    return far instanceof IosDevice ? far : null;
  }

  receive(_port: Port, frame: Frame): void {
    // A PC's NIC doesn't understand 802.1Q tags, so tagged frames from a trunk are dropped.
    if (frame.vlan !== undefined) return;
    this.stack.handleFrame(this.l3, frame);
  }
}
