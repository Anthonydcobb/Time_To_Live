import type { Ipv4 } from "../addr";
import type { StaticRoute } from "../ipstack";

/** A password stored in the config. `encrypted` means it shows as type 7. */
export interface StoredPassword {
  text: string;
  encrypted: boolean;
}

export interface LineConfig {
  password: StoredPassword | null;
  login: boolean;
  loggingSynchronous: boolean;
  execTimeout: [number, number] | null;
}

export type SwitchportMode = "access" | "trunk" | "dynamic auto" | "dynamic desirable";

/** Layer 2 settings on a switch's physical port. */
export interface SwitchportConfig {
  mode: SwitchportMode;
  accessVlan: number;
  nativeVlan: number;
  /** VLANs allowed on a trunk, or null for all of them. */
  allowed: number[] | null;
  nonegotiate: boolean;
}

export function defaultSwitchport(): SwitchportConfig {
  // A Catalyst 2960 port is dynamic auto out of the box.
  return { mode: "dynamic auto", accessVlan: 1, nativeVlan: 1, allowed: null, nonegotiate: false };
}

export interface InterfaceConfig {
  shutdown: boolean;
  description: string | null;
  ip: Ipv4 | null;
  mask: Ipv4 | null;
  cdp: boolean;
  /** Switch physical ports only. */
  switchport?: SwitchportConfig;
  /** Router subinterfaces only: `encapsulation dot1Q <vlan> [native]`. */
  encapsulation?: { vlan: number; native: boolean } | null;
}

export function newInterfaceConfig(shutdown: boolean): InterfaceConfig {
  return { shutdown, description: null, ip: null, mask: null, cdp: true };
}

export interface DhcpPool {
  name: string;
  network: Ipv4 | null;
  mask: Ipv4 | null;
  defaultRouters: Ipv4[];
  dnsServers: Ipv4[];
  domainName: string | null;
  /** Lease length as [days, hours, minutes], or null for infinite. IOS defaults to one day. */
  lease: [number, number, number] | null;
}

export function newDhcpPool(name: string): DhcpPool {
  return { name, network: null, mask: null, defaultRouters: [], dnsServers: [], domainName: null, lease: [1, 0, 0] };
}

/** Everything `show running-config` prints. `reload` restores this from startup-config. */
export interface IosConfig {
  hostname: string;
  enableSecret: string | null;
  enablePassword: StoredPassword | null;
  servicePasswordEncryption: boolean;
  bannerMotd: string | null;
  ipDomainLookup: boolean;
  cdpRun: boolean;
  interfaces: Record<string, InterfaceConfig>;
  con: LineConfig;
  vty: LineConfig;
  staticRoutes: StaticRoute[];
  defaultGateway: Ipv4 | null;
  dhcpExcluded: { low: Ipv4; high: Ipv4 }[];
  dhcpPools: DhcpPool[];
  /** PVST+ bridge priority overrides, keyed by VLAN ID. */
  spanningTreePriority: Record<number, number>;
}

export function defaultLine(): LineConfig {
  return { password: null, login: false, loggingSynchronous: false, execTimeout: null };
}

export function defaultConfig(hostname: string, interfaces: { name: string; shutdown: boolean }[]): IosConfig {
  return {
    hostname,
    enableSecret: null,
    enablePassword: null,
    servicePasswordEncryption: false,
    bannerMotd: null,
    ipDomainLookup: true,
    cdpRun: true,
    interfaces: Object.fromEntries(
      interfaces.map((i) => [i.name, newInterfaceConfig(i.shutdown)]),
    ),
    con: defaultLine(),
    vty: { ...defaultLine(), login: true },
    staticRoutes: [],
    defaultGateway: null,
    dhcpExcluded: [],
    dhcpPools: [],
    spanningTreePriority: {},
  };
}

export function cloneConfig(c: IosConfig): IosConfig {
  return structuredClone(c);
}
