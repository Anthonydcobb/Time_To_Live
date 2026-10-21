import type { Ipv4, Ipv6, Mac } from "./addr";

export interface ArpPacket {
  kind: "arp";
  op: "request" | "reply";
  senderMac: Mac;
  senderIp: Ipv4;
  targetMac: Mac;
  targetIp: Ipv4;
}

export interface IcmpMessage {
  type: "echo-request" | "echo-reply" | "unreachable" | "time-exceeded";
  id: number;
  seq: number;
}

/** A DHCP message (carried over UDP 67/68 in real life). */
export interface DhcpMessage {
  op: "discover" | "offer" | "request" | "ack" | "nak" | "release";
  xid: number;
  /** The client's hardware address. */
  chaddr: Mac;
  /** "Your" address: what the server is offering or confirming. */
  yiaddr: Ipv4;
  /** Address the client is asking for in a request. */
  requested?: Ipv4;
  serverId?: Ipv4;
  mask?: Ipv4;
  routers?: Ipv4[];
  dnsServers?: Ipv4[];
  domainName?: string;
  leaseSec?: number;
  /** The client-facing interface address added by a DHCP relay. */
  relayIp?: Ipv4;
}

/** An IPv4 packet carries either an ICMP message or a DHCP message. */
export interface Ipv4Packet {
  kind: "ipv4";
  src: Ipv4;
  dst: Ipv4;
  ttl: number;
  icmp?: IcmpMessage;
  dhcp?: DhcpMessage;
}

export interface Icmpv6Message {
  type: "echo-request" | "echo-reply" | "time-exceeded" | "unreachable" | "neighbor-solicitation" | "neighbor-advertisement";
  id: number;
  seq: number;
  target?: Ipv6;
  targetMac?: Mac;
}

export interface Ipv6Packet {
  kind: "ipv6";
  src: Ipv6;
  dst: Ipv6;
  hopLimit: number;
  icmpv6?: Icmpv6Message;
}

/** Cisco Discovery Protocol advertisement. Switches consume these instead of forwarding them. */
export interface CdpPacket {
  kind: "cdp";
  deviceId: string;
  platform: string;
  capability: "Router" | "Switch";
  portId: string;
  holdtimeSec: number;
  address: Ipv4 | null;
  version: string;
  /** Switches advertise the port's native (or access) VLAN, which is how they spot a mismatch. */
  nativeVlan?: number;
}

/** A small PVST-style configuration BPDU. It is intentionally modeled as a
 * control frame so switches can react to real topology changes rather than
 * merely waiting out a fixed timer. */
export interface BpduPacket {
  kind: "bpdu";
  vlan: number;
  rootPriority: number;
  rootMac: Mac;
  rootPathCost: number;
  bridgePriority: number;
  bridgeMac: Mac;
  portId: string;
}

export const CDP_MAC: Mac = "01000ccccccc";
export const STP_MAC: Mac = "0180c2000000";

export interface Frame {
  src: Mac;
  dst: Mac;
  /** The 802.1Q tag, present only while the frame crosses a trunk. */
  vlan?: number;
  payload: ArpPacket | Ipv4Packet | Ipv6Packet | CdpPacket | BpduPacket;
}

/** A copy of the frame with an 802.1Q tag, or without one when `vlan` is undefined. */
export function retag(frame: Frame, vlan: number | undefined): Frame {
  if (frame.vlan === vlan) return frame;
  const { vlan: _old, ...rest } = frame;
  return vlan === undefined ? rest : { ...rest, vlan };
}
