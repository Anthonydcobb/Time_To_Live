import type { Ipv4, Ipv6 } from "../addr";
import type { StaticRoute } from "../ipstack";

/** A password stored in the config. `encrypted` means it shows as type 7. */
export interface StoredPassword {
  text: string;
  encrypted: boolean;
}

export interface LineConfig {
  password: StoredPassword | null;
  login: boolean;
  loginLocal: boolean;
  transportInput: "all" | "none" | "ssh" | "telnet";
  loggingSynchronous: boolean;
  execTimeout: [number, number] | null;
}

export type SwitchportMode = "access" | "trunk" | "dynamic auto" | "dynamic desirable";
export type ChannelGroupMode = "on" | "active" | "passive" | "desirable" | "auto";

/** Layer 2 settings on a switch's physical port. */
export interface SwitchportConfig {
  mode: SwitchportMode;
  accessVlan: number;
  voiceVlan: number | null;
  nativeVlan: number;
  /** VLANs allowed on a trunk, or null for all of them. */
  allowed: number[] | null;
  nonegotiate: boolean;
  portfast: boolean;
  bpduGuard: boolean;
  channelGroup: number | null;
  channelMode: ChannelGroupMode | null;
  portSecurity: boolean;
  portSecurityMaximum: number;
  portSecurityViolation: "shutdown" | "restrict" | "protect";
  portSecuritySticky: boolean;
  secureMacs: string[];
  dhcpTrust: boolean;
  dhcpRateLimit: number | null;
  arpInspectionTrust: boolean;
}

export function defaultSwitchport(): SwitchportConfig {
  // A Catalyst 2960 port is dynamic auto out of the box.
  return { mode: "dynamic auto", accessVlan: 1, voiceVlan: null, nativeVlan: 1, allowed: null, nonegotiate: false, portfast: false, bpduGuard: false, channelGroup: null, channelMode: null, portSecurity: false, portSecurityMaximum: 1, portSecurityViolation: "shutdown", portSecuritySticky: false, secureMacs: [], dhcpTrust: false, dhcpRateLimit: null, arpInspectionTrust: false };
}

export interface InterfaceConfig {
  shutdown: boolean;
  description: string | null;
  ip: Ipv4 | null;
  mask: Ipv4 | null;
  ipv6Addresses: { address: Ipv6; prefix: number }[];
  ipv6OspfArea: number | null;
  /** DHCP relay destinations configured with ip helper-address. */
  helperAddresses: Ipv4[];
  accessGroupIn: number | null;
  accessGroupOut: number | null;
  cdp: boolean;
  natRole: "inside" | "outside" | null;
  hsrp: { group: number; ip: Ipv4; priority: number; preempt: boolean } | null;
  /** Switch physical ports only. */
  switchport?: SwitchportConfig;
  /** Router subinterfaces only: `encapsulation dot1Q <vlan> [native]`. */
  encapsulation?: { vlan: number; native: boolean } | null;
}

export function newInterfaceConfig(shutdown: boolean): InterfaceConfig {
  return { shutdown, description: null, ip: null, mask: null, ipv6Addresses: [], ipv6OspfArea: null, helperAddresses: [], accessGroupIn: null, accessGroupOut: null, cdp: true, natRole: null, hsrp: null };
}

export interface AclAddress {
  network: Ipv4 | null;
  wildcard: Ipv4 | null;
}

export interface StandardAclRule extends AclAddress {
  action: "permit" | "deny";
}

export interface ExtendedAclRule {
  action: "permit" | "deny";
  protocol: "ip" | "icmp";
  source: AclAddress;
  destination: AclAddress;
}

export interface OspfNetwork {
  network: Ipv4;
  mask: Ipv4;
  area: number;
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
  domainName: string | null;
  users: Record<string, string>;
  rsaKeysGenerated: boolean;
  standardAcls: Record<number, StandardAclRule[]>;
  extendedAcls: Record<number, ExtendedAclRule[]>;
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
  ipRouting: boolean;
  ipv6UnicastRouting: boolean;
  ospf: { processId: number; networks: OspfNetwork[] } | null;
  ospfv3: { processId: number } | null;
  /** VTP control-plane settings for switches. */
  vtpMode: "server" | "client" | "transparent";
  vtpDomain: string;
  dhcpSnooping: boolean;
  dhcpSnoopingVlans: number[];
  dhcpSnoopingBindings: { mac: string; ip: Ipv4; vlan: number; port: string; learnedAt: number }[];
  arpInspectionVlans: number[];
  ipv6StaticRoutes: { network: Ipv6; prefix: number; nextHop: Ipv6 | null; exitIface: string | null }[];
  staticNat: { insideLocal: Ipv4; insideGlobal: Ipv4 }[];
  natOverloads: { acl: number; outsideInterface: string }[];
}

export function defaultLine(): LineConfig {
  return { password: null, login: false, loginLocal: false, transportInput: "all", loggingSynchronous: false, execTimeout: null };
}

export function defaultConfig(hostname: string, interfaces: { name: string; shutdown: boolean }[]): IosConfig {
  return {
    hostname,
    domainName: null,
    users: {},
    rsaKeysGenerated: false,
    standardAcls: {},
    extendedAcls: {},
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
    ipRouting: false,
    ipv6UnicastRouting: false,
    ospf: null,
    ospfv3: null,
    vtpMode: "server",
    vtpDomain: "",
    dhcpSnooping: false,
    dhcpSnoopingVlans: [],
    dhcpSnoopingBindings: [],
    arpInspectionVlans: [],
    ipv6StaticRoutes: [],
    staticNat: [],
    natOverloads: [],
  };
}

export function cloneConfig(c: IosConfig): IosConfig {
  return structuredClone(c);
}
