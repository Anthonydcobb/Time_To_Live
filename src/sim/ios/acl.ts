import type { Ipv4Packet } from "../frames";
import type { IosConfig } from "./config";

export type AclDirection = "in" | "out";

/** Standard numbered ACL evaluation. An attached ACL has an implicit deny. */
export function permitsStandardAcl(config: IosConfig, ifaceName: string, packet: Ipv4Packet, direction: AclDirection): boolean {
  const iface = config.interfaces[ifaceName];
  const number = direction === "in" ? iface?.accessGroupIn : iface?.accessGroupOut;
  if (number === null || number === undefined) return true;
  const rules = config.standardAcls[number] ?? [];
  for (const rule of rules) {
    const matches = rule.network === null || (((packet.src ^ rule.network) & (~rule.wildcard! >>> 0)) >>> 0) === 0;
    if (matches) return rule.action === "permit";
  }
  return false;
}
