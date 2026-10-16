import type { Ipv4, Mac } from "./addr";

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
}

export const CDP_MAC: Mac = "01000ccccccc";

export interface Frame {
  src: Mac;
  dst: Mac;
  vlan?: number;
  payload: ArpPacket | Ipv4Packet | CdpPacket;
}
