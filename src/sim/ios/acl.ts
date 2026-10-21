import type { Ipv4Packet } from "../frames";
import type { AclAddress, IosConfig } from "./config";

export type AclDirection = "in" | "out";

/** Standard numbered ACL evaluation. An attached ACL has an implicit deny. */
export function permitsStandardAcl(config: IosConfig, ifaceName: string, packet: Ipv4Packet, direction: AclDirection): boolean {
  const iface = config.interfaces[ifaceName];
  const name = direction === "in" ? iface?.accessGroupIn : iface?.accessGroupOut;
  if (name === null || name === undefined) return true;
  const isExtended = Object.prototype.hasOwnProperty.call(config.extendedAcls, name) || (!Object.prototype.hasOwnProperty.call(config.standardAcls, name) && /^\d+$/.test(name) && Number(name) >= 100);
  if (isExtended) return permitsExtendedAcl(config, name, packet);
  const rules = config.standardAcls[name] ?? [];
  for (const rule of rules) {
    const matches = rule.network === null || (((packet.src ^ rule.network) & (~rule.wildcard! >>> 0)) >>> 0) === 0;
    if (matches) return rule.action === "permit";
  }
  return false;
}

function matches(rule: AclAddress, address: number): boolean {
  return rule.network === null || (((address ^ rule.network) & (~rule.wildcard! >>> 0)) >>> 0) === 0;
}

function permitsExtendedAcl(config: IosConfig, name: string, packet: Ipv4Packet): boolean {
  const protocol = packet.icmp ? "icmp" : "ip";
  for (const rule of config.extendedAcls[name] ?? []) {
    if ((rule.protocol === "ip" || rule.protocol === protocol) && matches(rule.source, packet.src) && matches(rule.destination, packet.dst)) return rule.action === "permit";
  }
  return false;
}
