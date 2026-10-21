import {
  BROADCAST_IP,
  BROADCAST_MAC,
  broadcastOf,
  networkOf,
  type Ipv4,
  type Ipv6,
  ipv6InPrefix,
  type Mac,
} from "./addr";
import type { Clock } from "./clock";
import type { Frame, IcmpMessage, Ipv4Packet, Ipv6Packet } from "./frames";

/** Anything that can hold an IP address: a router port, a PC NIC, a switch SVI. */
export interface L3Interface {
  name: string;
  mac: Mac;
  ip: Ipv4 | null;
  mask: Ipv4 | null;
  ipv6Addresses: { address: Ipv6; prefix: number }[];
  /** True when line protocol is up and frames can flow. */
  up(): boolean;
  transmit(frame: Frame): void;
}

export interface ArpEntry {
  ip: Ipv4;
  mac: Mac;
  iface: L3Interface;
  learnedAt: number;
}

export interface StaticRoute {
  network: Ipv4;
  mask: Ipv4;
  nextHop: Ipv4 | null;
  exitIface: string | null;
}

export interface Route {
  code: "C" | "L" | "S" | "O";
  network: Ipv4;
  mask: Ipv4;
  nextHop: Ipv4 | null;
  iface: L3Interface | null;
}

export type PingResult =
  | { kind: "reply"; rttMs: number; ttl: number; from: Ipv4 }
  | { kind: "timeout" }
  | { kind: "unreachable"; from: Ipv4 }
  | { kind: "ttl-expired"; from: Ipv4 };

export interface IpStackOptions {
  clock: () => Clock;
  interfaces: () => L3Interface[];
  /** Routers forward packets that aren't addressed to them. */
  forwarding: boolean | (() => boolean);
  /**
   * PCs hold a packet while they ARP for the next hop. Routers drop it,
   * which is why the first ping from a router is often a `.`.
   */
  queueWhileArping: boolean;
  initialTtl: number;
  /** Routers add local /32 routes to the table. */
  localRoutes: boolean;
  staticRoutes?: () => StaticRoute[];
  ospfRoutes?: () => StaticRoute[];
  defaultGateway?: () => Ipv4 | null;
  /** DHCP messages go here instead of through normal delivery. They arrive before the client has an address. */
  onDhcp?: (iface: L3Interface, packet: Ipv4Packet) => void;
  /** Optional inbound/outbound IPv4 ACL gate supplied by the owning device. */
  filter?: (iface: L3Interface, packet: Ipv4Packet, direction: "in" | "out") => boolean;
}

const MAX_QUEUED_PER_HOST = 4;

export class IpStack {
  readonly arp = new Map<Ipv4, ArpEntry>();
  /** Every address that has answered a ping from this host. Work orders check it. */
  readonly repliesFrom = new Set<Ipv4>();
  private queued = new Map<Ipv4, { iface: L3Interface; packet: Ipv4Packet }[]>();
  private waiters = new Map<string, (r: PingResult) => void>();
  private nextPingId = 1;
  private ipv6Waiters = new Map<string, (r: PingResult) => void>();

  constructor(private readonly opts: IpStackOptions) {}

  private get clock(): Clock {
    return this.opts.clock();
  }

  private upInterfaces(): L3Interface[] {
    return this.opts.interfaces().filter((i) => i.up() && i.ip !== null && i.mask !== null);
  }

  isLocal(ip: Ipv4): boolean {
    return this.upInterfaces().some((i) => i.ip === ip);
  }

  routes(): Route[] {
    const routes: Route[] = [];
    for (const iface of this.upInterfaces()) {
      routes.push({ code: "C", network: networkOf(iface.ip!, iface.mask!), mask: iface.mask!, nextHop: null, iface });
      if (this.opts.localRoutes) routes.push({ code: "L", network: iface.ip!, mask: 0xffffffff, nextHop: null, iface });
    }
    const connected = [...routes];
    for (const s of this.opts.staticRoutes?.() ?? []) {
      if (s.exitIface) {
        const iface = connected.find((r) => r.iface?.name === s.exitIface)?.iface;
        if (iface) routes.push({ code: "S", network: s.network, mask: s.mask, nextHop: s.nextHop, iface });
      } else if (s.nextHop !== null && connected.some((r) => r.code === "C" && networkOf(s.nextHop!, r.mask) === r.network)) {
        routes.push({ code: "S", network: s.network, mask: s.mask, nextHop: s.nextHop, iface: null });
      }
    }
    for (const s of this.opts.ospfRoutes?.() ?? []) {
      if (s.nextHop !== null && connected.some((r) => r.code === "C" && networkOf(s.nextHop!, r.mask) === r.network)) {
        routes.push({ code: "O", network: s.network, mask: s.mask, nextHop: s.nextHop, iface: null });
      }
    }
    return routes;
  }

  /** Longest-prefix match. Resolves recursive static routes to an exit interface. */
  lookup(dst: Ipv4, depth = 0): { iface: L3Interface; nextHop: Ipv4 } | null {
    let best: Route | null = null;
    for (const r of this.routes()) {
      if (networkOf(dst, r.mask) !== r.network) continue;
      if (!best || r.mask >>> 0 > best.mask >>> 0) best = r;
    }
    if (best) {
      if (best.iface) return { iface: best.iface, nextHop: best.nextHop ?? dst };
      if (best.nextHop !== null && depth < 8) {
        const via = this.lookup(best.nextHop, depth + 1);
        if (via) return { iface: via.iface, nextHop: best.nextHop };
      }
      return null;
    }
    const gw = this.opts.defaultGateway?.() ?? null;
    if (gw !== null && depth === 0) {
      const via = this.lookup(gw, depth + 1);
      if (via && via.nextHop === gw) return { iface: via.iface, nextHop: gw };
    }
    return null;
  }

  /** Routes and sends a packet this host originated. Returns false if there is no route. */
  send(packet: Ipv4Packet): boolean {
    if (this.isLocal(packet.dst)) {
      const iface = this.upInterfaces().find((i) => i.ip === packet.dst)!;
      this.clock.schedule(0, () => this.deliver(iface, packet));
      return true;
    }
    const route = this.lookup(packet.dst);
    if (!route) return false;
    this.sendVia(route.iface, route.nextHop, packet);
    return true;
  }

  private sendVia(iface: L3Interface, nextHop: Ipv4, packet: Ipv4Packet): void {
    if (this.opts.filter && !this.opts.filter(iface, packet, "out")) return;
    const isBroadcast = nextHop === BROADCAST_IP || (iface.ip !== null && nextHop === broadcastOf(iface.ip, iface.mask!));
    if (isBroadcast) {
      iface.transmit({ src: iface.mac, dst: BROADCAST_MAC, payload: packet });
      return;
    }
    const entry = this.arp.get(nextHop);
    if (entry && entry.iface === iface) {
      iface.transmit({ src: iface.mac, dst: entry.mac, payload: packet });
      return;
    }
    if (this.opts.queueWhileArping) {
      const q = this.queued.get(nextHop) ?? [];
      if (q.length < MAX_QUEUED_PER_HOST) q.push({ iface, packet });
      this.queued.set(nextHop, q);
    }
    this.arpRequest(iface, nextHop);
  }

  private arpRequest(iface: L3Interface, target: Ipv4): void {
    if (iface.ip === null) return;
    iface.transmit({
      src: iface.mac,
      dst: BROADCAST_MAC,
      payload: { kind: "arp", op: "request", senderMac: iface.mac, senderIp: iface.ip, targetMac: "000000000000", targetIp: target },
    });
  }

  private learn(iface: L3Interface, ip: Ipv4, mac: Mac): void {
    this.arp.set(ip, { ip, mac, iface, learnedAt: this.clock.now });
    const waiting = this.queued.get(ip);
    if (!waiting) return;
    this.queued.delete(ip);
    for (const w of waiting) if (w.iface === iface) iface.transmit({ src: iface.mac, dst: mac, payload: w.packet });
  }

  handleFrame(iface: L3Interface, frame: Frame): void {
    if (frame.dst !== iface.mac && frame.dst !== BROADCAST_MAC) return;
    const p = frame.payload;
    if (p.kind === "cdp" || p.kind === "bpdu") return;
    if (p.kind === "ipv6") {
      this.handleIpv6(iface, p);
      return;
    }
    if (p.kind === "arp") {
      if (iface.ip === null) return;
      if (p.targetIp === iface.ip) {
        this.learn(iface, p.senderIp, p.senderMac);
        if (p.op === "request") {
          iface.transmit({
            src: iface.mac,
            dst: p.senderMac,
            payload: { kind: "arp", op: "reply", senderMac: iface.mac, senderIp: iface.ip, targetMac: p.senderMac, targetIp: p.senderIp },
          });
        }
      } else if (this.arp.has(p.senderIp)) {
        this.learn(iface, p.senderIp, p.senderMac);
      }
      return;
    }

    if (this.opts.filter && !this.opts.filter(iface, p, "in")) return;

    if (p.dhcp) {
      this.opts.onDhcp?.(iface, p);
      return;
    }

    const forMe =
      this.isLocal(p.dst) ||
      p.dst === BROADCAST_IP ||
      (iface.ip !== null && iface.mask !== null && p.dst === broadcastOf(iface.ip, iface.mask));
    if (forMe) {
      this.deliver(iface, p);
      return;
    }
    const forwarding = typeof this.opts.forwarding === "function" ? this.opts.forwarding() : this.opts.forwarding;
    if (!forwarding || iface.ip === null) return;

    const ttl = p.ttl - 1;
    if (ttl <= 0) {
      this.reply(iface.ip, p, "time-exceeded");
      return;
    }
    const route = this.lookup(p.dst);
    if (!route) {
      this.reply(iface.ip, p, "unreachable");
      return;
    }
    this.sendVia(route.iface, route.nextHop, { ...p, ttl });
  }

  private ipv6Local(address: Ipv6): L3Interface | null {
    return this.opts.interfaces().find((iface) => iface.up() && iface.ipv6Addresses.some((a) => a.address === address)) ?? null;
  }

  private ipv6Route(dst: Ipv6): { iface: L3Interface; source: Ipv6 } | null {
    const matches = this.opts.interfaces().flatMap((iface) => iface.up() ? iface.ipv6Addresses.filter((a) => ipv6InPrefix(dst, a.address, a.prefix)).map((a) => ({ iface, source: a.address, prefix: a.prefix })) : []);
    const best = matches.sort((a, b) => b.prefix - a.prefix)[0];
    return best ? { iface: best.iface, source: best.source } : null;
  }

  sendIpv6(packet: Ipv6Packet): boolean {
    const local = this.ipv6Local(packet.dst);
    if (local) {
      this.clock.schedule(0, () => this.deliverIpv6(local, packet));
      return true;
    }
    const route = this.ipv6Route(packet.dst);
    if (!route) return false;
    route.iface.transmit({ src: route.iface.mac, dst: BROADCAST_MAC, payload: packet });
    return true;
  }

  private handleIpv6(_iface: L3Interface, packet: Ipv6Packet): void {
    const local = this.ipv6Local(packet.dst);
    if (local) {
      this.deliverIpv6(local, packet);
      return;
    }
    const forwarding = typeof this.opts.forwarding === "function" ? this.opts.forwarding() : this.opts.forwarding;
    if (!forwarding || packet.hopLimit <= 1) return;
    const route = this.ipv6Route(packet.dst);
    if (!route) return;
    route.iface.transmit({ src: route.iface.mac, dst: BROADCAST_MAC, payload: { ...packet, hopLimit: packet.hopLimit - 1 } });
  }

  private deliverIpv6(_iface: L3Interface, packet: Ipv6Packet): void {
    const icmp = packet.icmpv6;
    if (!icmp) return;
    if (icmp.type === "echo-request") {
      this.sendIpv6({ kind: "ipv6", src: packet.dst, dst: packet.src, hopLimit: 64, icmpv6: { type: "echo-reply", id: icmp.id, seq: icmp.seq } });
      return;
    }
    const waiter = this.ipv6Waiters.get(`${icmp.id}:${icmp.seq}`);
    if (waiter && icmp.type === "echo-reply") {
      this.ipv6Waiters.delete(`${icmp.id}:${icmp.seq}`);
      waiter({ kind: "reply", rttMs: 0, ttl: packet.hopLimit, from: 0 });
    }
  }

  probeIpv6(dst: Ipv6, opts: { id: number; seq: number; timeoutMs: number; source: Ipv6 }, done: (r: PingResult) => void): void {
    const key = `${opts.id}:${opts.seq}`;
    let settled = false;
    const settle = (result: PingResult) => { if (settled) return; settled = true; this.ipv6Waiters.delete(key); done(result); };
    this.ipv6Waiters.set(key, settle);
    this.sendIpv6({ kind: "ipv6", src: opts.source, dst, hopLimit: 64, icmpv6: { type: "echo-request", id: opts.id, seq: opts.seq } });
    this.clock.schedule(opts.timeoutMs, () => settle({ kind: "timeout" }));
  }

  private reply(from: Ipv4, original: Ipv4Packet, type: IcmpMessage["type"]): void {
    if (original.icmp?.type !== "echo-request") return;
    this.send({ kind: "ipv4", src: from, dst: original.src, ttl: this.opts.initialTtl, icmp: { type, id: original.icmp.id, seq: original.icmp.seq } });
  }

  private deliver(iface: L3Interface, p: Ipv4Packet): void {
    const icmp = p.icmp;
    if (!icmp) return;
    if (icmp.type === "echo-request") {
      const src = this.isLocal(p.dst) ? p.dst : iface.ip;
      if (src === null) return;
      this.send({ kind: "ipv4", src, dst: p.src, ttl: this.opts.initialTtl, icmp: { type: "echo-reply", id: icmp.id, seq: icmp.seq } });
      return;
    }
    const waiter = this.waiters.get(`${icmp.id}:${icmp.seq}`);
    if (!waiter) return;
    if (icmp.type === "echo-reply") waiter({ kind: "reply", rttMs: 0, ttl: p.ttl, from: p.src });
    else if (icmp.type === "unreachable") waiter({ kind: "unreachable", from: p.src });
    else waiter({ kind: "ttl-expired", from: p.src });
  }

  /** Source address this host would use to reach `dst`, or null if it has no route. */
  sourceFor(dst: Ipv4): Ipv4 | null {
    if (this.isLocal(dst)) return dst;
    return this.lookup(dst)?.iface.ip ?? null;
  }

  newPingId(): number {
    return this.nextPingId++;
  }

  /**
   * Sends one echo request and calls back with the result when a reply comes
   * in or the timeout passes, in simulated time. `ttl` below the default is
   * how traceroute finds each hop.
   */
  probe(dst: Ipv4, opts: { id: number; seq: number; timeoutMs: number; ttl?: number }, done: (r: PingResult) => void): void {
    const start = this.clock.now;
    const key = `${opts.id}:${opts.seq}`;
    let settled = false;
    const settle = (r: PingResult) => {
      if (settled) return;
      settled = true;
      this.waiters.delete(key);
      if (r.kind === "reply") this.repliesFrom.add(dst);
      done(r.kind === "reply" ? { ...r, rttMs: this.clock.now - start } : r);
    };
    this.waiters.set(key, settle);
    const src = this.sourceFor(dst);
    if (src !== null) {
      this.send({ kind: "ipv4", src, dst, ttl: opts.ttl ?? this.opts.initialTtl, icmp: { type: "echo-request", id: opts.id, seq: opts.seq } });
    }
    this.clock.schedule(opts.timeoutMs, () => settle({ kind: "timeout" }));
  }
}
