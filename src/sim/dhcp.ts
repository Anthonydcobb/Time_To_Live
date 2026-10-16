// DHCP: the IOS server that runs on a router, and the Windows-style client on PCs.
import { BROADCAST_IP, BROADCAST_MAC, broadcastOf, networkOf, type Ipv4, type Mac } from "./addr";
import type { Clock } from "./clock";
import type { DhcpMessage, Frame, Ipv4Packet } from "./frames";
import type { IpStack, L3Interface } from "./ipstack";
import type { DhcpPool, IosConfig } from "./ios/config";

export interface DhcpBinding {
  ip: Ipv4;
  mac: Mac;
  pool: string;
  /** Simulated time the lease runs out, or null for an infinite lease. */
  expiresAt: number | null;
}

export interface DhcpConflict {
  ip: Ipv4;
  detectedAt: number;
}

/** IOS pings an address twice, 500 ms apart, before offering it, and skips it if anything answers. */
export const DHCP_PING_PACKETS = 2;
export const DHCP_PING_TIMEOUT_MS = 500;
/** An offer is held for the client this long before the address goes back in the pool. */
const OFFER_HOLD_MS = 60_000;

function leaseMs(pool: DhcpPool): number | null {
  if (!pool.lease) return null;
  const [d, h, m] = pool.lease;
  return ((d * 24 + h) * 60 + m) * 60_000;
}

function dhcpFrame(src: Mac, dst: Mac, ipSrc: Ipv4, ipDst: Ipv4, dhcp: DhcpMessage): Frame {
  const packet: Ipv4Packet = { kind: "ipv4", src: ipSrc, dst: ipDst, ttl: 255, dhcp };
  return { src, dst, payload: packet };
}

export interface DhcpServerHost {
  clock(): Clock;
  config(): IosConfig;
  stack: IpStack;
  l3Interfaces(): L3Interface[];
}

/** The `ip dhcp pool` server built into IOS. */
export class DhcpServer {
  readonly bindings = new Map<Ipv4, DhcpBinding>();
  readonly conflicts = new Map<Ipv4, DhcpConflict>();
  private readonly offers = new Map<Mac, { ip: Ipv4; pool: string; until: number }>();
  /** Clients whose discover is being ping-checked right now. */
  private readonly checking = new Set<Mac>();

  constructor(private readonly host: DhcpServerHost) {}

  private get now(): number {
    return this.host.clock().now;
  }

  liveBindings(): DhcpBinding[] {
    for (const [ip, b] of this.bindings) if (b.expiresAt !== null && b.expiresAt <= this.now) this.bindings.delete(ip);
    return [...this.bindings.values()].sort((a, b) => a.ip - b.ip);
  }

  clear(ip?: Ipv4): void {
    if (ip === undefined) this.bindings.clear();
    else this.bindings.delete(ip);
  }

  clearConflicts(): void {
    this.conflicts.clear();
  }

  /** The pool serving the subnet an interface is in. */
  poolFor(iface: L3Interface): DhcpPool | null {
    if (iface.ip === null || iface.mask === null) return null;
    return (
      this.host.config().dhcpPools.find(
        (p) => p.network !== null && p.mask !== null && networkOf(iface.ip!, p.mask) === p.network,
      ) ?? null
    );
  }

  private excluded(ip: Ipv4): boolean {
    return this.host.config().dhcpExcluded.some((r) => ip >= r.low && ip <= r.high);
  }

  private inUse(ip: Ipv4, mac: Mac): boolean {
    if (this.host.l3Interfaces().some((i) => i.ip === ip)) return true;
    if (this.conflicts.has(ip)) return true;
    const b = this.bindings.get(ip);
    if (b && b.mac !== mac && (b.expiresAt === null || b.expiresAt > this.now)) return true;
    for (const [m, o] of this.offers) if (m !== mac && o.ip === ip && o.until > this.now) return true;
    return false;
  }

  private candidates(pool: DhcpPool, mac: Mac): Ipv4[] {
    const first = pool.network! + 1;
    const last = broadcastOf(pool.network!, pool.mask!) - 1;
    const out: Ipv4[] = [];
    for (let ip = first; ip <= last; ip++) if (!this.excluded(ip) && !this.inUse(ip, mac)) out.push(ip);
    return out;
  }

  handle(iface: L3Interface, packet: Ipv4Packet): void {
    const msg = packet.dhcp!;
    if (msg.op === "discover") this.discover(iface, msg);
    else if (msg.op === "request") this.request(iface, msg);
    else if (msg.op === "release") {
      const b = this.bindings.get(packet.src);
      if (b && b.mac === msg.chaddr) this.bindings.delete(packet.src);
    }
  }

  private discover(iface: L3Interface, msg: DhcpMessage): void {
    const pool = this.poolFor(iface);
    if (!pool || this.checking.has(msg.chaddr)) return;
    const existing = [...this.bindings.values()].find((b) => b.mac === msg.chaddr && b.pool === pool.name);
    if (existing) {
      this.offer(iface, pool, msg, existing.ip);
      return;
    }
    const held = this.offers.get(msg.chaddr);
    if (held && held.pool === pool.name && held.until > this.now) {
      this.offer(iface, pool, msg, held.ip);
      return;
    }
    // Ping each candidate before offering it, like `ip dhcp ping packets 2`.
    const queue = this.candidates(pool, msg.chaddr);
    this.checking.add(msg.chaddr);
    const tryNext = () => {
      const ip = queue.shift();
      if (ip === undefined) {
        this.checking.delete(msg.chaddr);
        return;
      }
      this.pingCheck(ip, (answered) => {
        if (answered) {
          this.conflicts.set(ip, { ip, detectedAt: this.now });
          tryNext();
          return;
        }
        this.checking.delete(msg.chaddr);
        this.offer(iface, pool, msg, ip);
      });
    };
    tryNext();
  }

  private pingCheck(ip: Ipv4, done: (answered: boolean) => void): void {
    const stack = this.host.stack;
    const id = stack.newPingId();
    let seq = 0;
    const next = () => {
      if (seq >= DHCP_PING_PACKETS) {
        done(false);
        return;
      }
      stack.probe(ip, { id, seq: seq++, timeoutMs: DHCP_PING_TIMEOUT_MS }, (r) => {
        if (r.kind === "reply") done(true);
        else next();
      });
    };
    next();
  }

  private options(pool: DhcpPool) {
    const lease = leaseMs(pool);
    return {
      mask: pool.mask!,
      routers: pool.defaultRouters,
      dnsServers: pool.dnsServers,
      domainName: pool.domainName ?? undefined,
      leaseSec: lease === null ? 0xffffffff : lease / 1000,
    };
  }

  private offer(iface: L3Interface, pool: DhcpPool, msg: DhcpMessage, ip: Ipv4): void {
    if (iface.ip === null) return;
    this.offers.set(msg.chaddr, { ip, pool: pool.name, until: this.now + OFFER_HOLD_MS });
    iface.transmit(
      dhcpFrame(iface.mac, msg.chaddr, iface.ip, ip, {
        op: "offer",
        xid: msg.xid,
        chaddr: msg.chaddr,
        yiaddr: ip,
        serverId: iface.ip,
        ...this.options(pool),
      }),
    );
  }

  private request(iface: L3Interface, msg: DhcpMessage): void {
    if (iface.ip === null) return;
    // The client picked a different server's offer.
    if (msg.serverId !== undefined && msg.serverId !== iface.ip) {
      this.offers.delete(msg.chaddr);
      return;
    }
    const pool = this.poolFor(iface);
    const want = msg.requested;
    if (!pool || want === undefined) return;
    const offered = this.offers.get(msg.chaddr);
    const bound = this.bindings.get(want);
    const ok =
      networkOf(want, pool.mask!) === pool.network &&
      ((offered?.ip === want && offered.until > this.now) || bound?.mac === msg.chaddr || (!this.excluded(want) && !this.inUse(want, msg.chaddr)));
    if (!ok) {
      iface.transmit(dhcpFrame(iface.mac, BROADCAST_MAC, iface.ip, BROADCAST_IP, { op: "nak", xid: msg.xid, chaddr: msg.chaddr, yiaddr: 0, serverId: iface.ip }));
      return;
    }
    this.offers.delete(msg.chaddr);
    const lease = leaseMs(pool);
    for (const [ip, b] of this.bindings) if (b.mac === msg.chaddr && b.pool === pool.name) this.bindings.delete(ip);
    this.bindings.set(want, { ip: want, mac: msg.chaddr, pool: pool.name, expiresAt: lease === null ? null : this.now + lease });
    iface.transmit(
      dhcpFrame(iface.mac, msg.chaddr, iface.ip, want, {
        op: "ack",
        xid: msg.xid,
        chaddr: msg.chaddr,
        yiaddr: want,
        serverId: iface.ip,
        ...this.options(pool),
      }),
    );
  }
}

// ---- client -------------------------------------------------------------------

export interface DhcpLease {
  ip: Ipv4;
  mask: Ipv4;
  gateway: Ipv4 | null;
  dnsServers: Ipv4[];
  server: Ipv4;
  leaseSec: number;
}

export interface DhcpClientHost {
  clock(): Clock;
  mac: Mac;
  linkUp(): boolean;
  transmit(frame: Frame): void;
}

/** Windows resends a discover after 4, 8 and 16 seconds, then gives up 32 seconds later. */
export const DHCP_CLIENT_BACKOFF_MS = [4000, 8000, 16000, 32000];

let nextXid = 0x3903f326;

/** A Windows-style DHCP client: discover, take the first offer, request it, wait for the ack. */
export class DhcpClient {
  /** Bumped on every new attempt so stale timers and replies are ignored. */
  private attempt = 0;
  private xid = 0;
  private state: "idle" | "selecting" | "requesting" = "idle";
  private done: ((lease: DhcpLease | null) => void) | null = null;

  constructor(private readonly host: DhcpClientHost) {}

  get busy(): boolean {
    return this.state !== "idle";
  }

  /** Starts a fresh discover. `done` gets the lease, or null if no server answered in time. */
  start(done: (lease: DhcpLease | null) => void): void {
    this.attempt++;
    this.xid = nextXid++;
    this.state = "selecting";
    this.done = done;
    const attempt = this.attempt;
    let tries = 0;
    const send = () => {
      if (attempt !== this.attempt || this.state === "idle") return;
      if (tries >= DHCP_CLIENT_BACKOFF_MS.length) {
        this.finish(null);
        return;
      }
      if (this.state === "selecting") this.discover();
      this.host.clock().schedule(DHCP_CLIENT_BACKOFF_MS[tries++], send);
    };
    send();
  }

  /** Stops waiting, as when the user cancels or the address is set by hand. */
  cancel(): void {
    this.attempt++;
    this.state = "idle";
    this.done = null;
  }

  release(lease: DhcpLease, from: Ipv4): void {
    this.cancel();
    const mac = this.host.mac;
    this.host.transmit(dhcpFrame(mac, BROADCAST_MAC, from, lease.server, { op: "release", xid: nextXid++, chaddr: mac, yiaddr: 0 }));
  }

  private discover(): void {
    const mac = this.host.mac;
    if (!this.host.linkUp()) return;
    this.host.transmit(dhcpFrame(mac, BROADCAST_MAC, 0, BROADCAST_IP, { op: "discover", xid: this.xid, chaddr: mac, yiaddr: 0 }));
  }

  handle(packet: Ipv4Packet): void {
    const msg = packet.dhcp!;
    if (msg.xid !== this.xid || msg.chaddr !== this.host.mac) return;
    const mac = this.host.mac;
    if (msg.op === "offer" && this.state === "selecting") {
      this.state = "requesting";
      this.host.transmit(
        dhcpFrame(mac, BROADCAST_MAC, 0, BROADCAST_IP, { op: "request", xid: this.xid, chaddr: mac, yiaddr: 0, requested: msg.yiaddr, serverId: msg.serverId }),
      );
    } else if (msg.op === "ack" && this.state === "requesting") {
      this.finish({
        ip: msg.yiaddr,
        mask: msg.mask!,
        gateway: msg.routers?.[0] ?? null,
        dnsServers: msg.dnsServers ?? [],
        server: msg.serverId!,
        leaseSec: msg.leaseSec ?? 86400,
      });
    } else if (msg.op === "nak" && this.state === "requesting") {
      // Start over with a fresh discover on the next retry.
      this.state = "selecting";
    }
  }

  private finish(lease: DhcpLease | null): void {
    const done = this.done;
    this.state = "idle";
    this.done = null;
    this.attempt++;
    done?.(lease);
  }
}

/** Windows picks a link-local address from its MAC when no DHCP server answers. */
export function apipaFor(mac: Mac): Ipv4 {
  const a = (parseInt(mac.slice(8, 10), 16) % 254) + 1;
  const b = (parseInt(mac.slice(10, 12), 16) % 254) + 1;
  return ((169 << 24) | (254 << 16) | (a << 8) | b) >>> 0;
}
