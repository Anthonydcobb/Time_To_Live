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

export interface Ipv4Packet {
  kind: "ipv4";
  src: Ipv4;
  dst: Ipv4;
  ttl: number;
  icmp: IcmpMessage;
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
