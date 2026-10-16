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

export interface InterfaceConfig {
  shutdown: boolean;
  description: string | null;
  ip: Ipv4 | null;
  mask: Ipv4 | null;
  cdp: boolean;
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
      interfaces.map((i) => [i.name, { shutdown: i.shutdown, description: null, ip: null, mask: null, cdp: true }]),
    ),
    con: defaultLine(),
    vty: { ...defaultLine(), login: true },
    staticRoutes: [],
    defaultGateway: null,
  };
}

export function cloneConfig(c: IosConfig): IosConfig {
  return structuredClone(c);
}
