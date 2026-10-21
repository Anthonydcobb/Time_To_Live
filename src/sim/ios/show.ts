// Output for IOS show commands, formatted like the real thing.
import { formatIpv4, formatIpv6, formatMacCisco, maskToPrefix, networkOf, type Ipv4 } from "../addr";
import { configTimestamp, type IosDevice } from "../devices/ios-device";
import type { Router } from "../devices/router";
import type { Switch } from "../devices/switch";
import { UNSUPPORTED_VLANS, formatVlanList } from "../vlans";
import type { Route } from "../ipstack";
import type { AclAddress, IosConfig, LineConfig, StoredPassword, SwitchportConfig, SwitchportMode } from "./config";
import { type7Encode } from "./passwords";

const IOS_VERSION = "15.1(4)M4";

function pw(p: StoredPassword): string {
  return p.encrypted ? `7 ${type7Encode(p.text)}` : p.text;
}

/** The body of the config, as `show running-config` prints it after the header. */
export function renderConfig(device: IosDevice, c: IosConfig, stamps: ConfigStamps = { changed: null, nvram: null }): string[] {
  const isSwitch = device.kind === "switch";
  const out: string[] = ["!"];
  if (stamps.changed !== null) out.push(`! Last configuration change at ${configTimestamp(stamps.changed)}`);
  if (stamps.nvram !== null) out.push(`! NVRAM config last updated at ${configTimestamp(stamps.nvram)}`);
  if (stamps.changed !== null || stamps.nvram !== null) out.push("!");
  out.push(`version ${isSwitch ? "15.0" : "15.1"}`);
  if (isSwitch) out.push("no service pad");
  out.push(
    "service timestamps debug datetime msec",
    "service timestamps log datetime msec",
    c.servicePasswordEncryption ? "service password-encryption" : "no service password-encryption",
    "!",
    `hostname ${c.hostname}`,
    "!",
    "boot-start-marker",
    "boot-end-marker",
    "!",
  );
  if (c.domainName) out.push(`ip domain-name ${c.domainName}`);
  for (const [name, secret] of Object.entries(c.users).sort(([a], [b]) => a.localeCompare(b))) out.push(`username ${name} secret 5 ${secret}`);
  if (c.domainName || Object.keys(c.users).length) out.push("!");
  if (c.enableSecret) out.push(`enable secret 5 ${c.enableSecret}`);
  if (c.enablePassword) out.push(`enable password ${pw(c.enablePassword)}`);
  if (c.enableSecret || c.enablePassword) out.push("!");
  out.push("no aaa new-model");
  if (isSwitch) out.push("system mtu routing 1500");
  out.push("!");
  if (c.dhcpExcluded.length) {
    for (const r of c.dhcpExcluded) out.push(`ip dhcp excluded-address ${formatIpv4(r.low)}${r.high !== r.low ? ` ${formatIpv4(r.high)}` : ""}`);
    out.push("!");
  }
  for (const p of c.dhcpPools) {
    out.push(`ip dhcp pool ${p.name}`);
    if (p.network !== null) out.push(` network ${formatIpv4(p.network)} ${formatIpv4(p.mask!)}`);
    if (p.defaultRouters.length) out.push(` default-router ${p.defaultRouters.map(formatIpv4).join(" ")}`);
    if (p.dnsServers.length) out.push(` dns-server ${p.dnsServers.map(formatIpv4).join(" ")}`);
    if (p.domainName) out.push(` domain-name ${p.domainName}`);
    if (p.lease === null) out.push(" lease infinite");
    else if (p.lease.join() !== "1,0,0") {
      const [d, h, m] = p.lease;
      out.push(` lease ${m ? `${d} ${h} ${m}` : h ? `${d} ${h}` : d}`);
    }
    out.push("!");
  }
  // Real IOS writes the space form in its config, whichever way you typed it.
  if (!c.ipDomainLookup) out.push("no ip domain lookup", "!");
  if (!isSwitch) out.push("ip cef", "no ipv6 cef", "!", "multilink bundle-name authenticated", "!");
  if (!c.cdpRun) out.push("no cdp run", "!");
  if (c.ipv6UnicastRouting) out.push("ipv6 unicast-routing");
  if (c.ospfv3) out.push(`ipv6 router ospf ${c.ospfv3.processId}`);
  for (const route of c.ipv6StaticRoutes) out.push(`ipv6 route ${formatIpv6(route.network)}/${route.prefix} ${route.nextHop ?? route.exitIface ?? "Null0"}`);
  if (isSwitch) {
    if (c.ipRouting) out.push("ip routing");
    if (c.dhcpSnooping) out.push("ip dhcp snooping");
    if (c.dhcpSnoopingVlans.length) out.push(`ip dhcp snooping vlan ${formatVlanList(c.dhcpSnoopingVlans)}`);
    if (c.arpInspectionVlans.length) out.push(`ip arp inspection vlan ${formatVlanList(c.arpInspectionVlans)}`);
    out.push("spanning-tree mode pvst", "spanning-tree extend system-id");
    for (const [vlan, priority] of Object.entries(c.spanningTreePriority).sort(([a], [b]) => Number(a) - Number(b))) out.push(`spanning-tree vlan ${vlan} priority ${priority}`);
    out.push("!", "vlan internal allocation policy ascending", "!");
  }

  for (const name of device.configInterfaceOrder(c)) {
    const ic = c.interfaces[name];
    if (!ic) continue;
    const physical = device.ports.some((p) => p.name === name);
    out.push(`interface ${name}`);
    if (ic.description) out.push(` description ${ic.description}`);
    for (const helper of ic.helperAddresses) out.push(` ip helper-address ${formatIpv4(helper)}`);
    for (const address of ic.ipv6Addresses) out.push(` ipv6 address ${formatIpv6(address.address)}/${address.prefix}`);
    if (ic.ipv6OspfArea !== null) out.push(` ipv6 ospf ${c.ospfv3?.processId ?? 1} area ${ic.ipv6OspfArea}`);
    if (ic.natRole) out.push(` ip nat ${ic.natRole}`);
    if (ic.hsrp) {
      out.push(` standby ${ic.hsrp.group} ip ${formatIpv4(ic.hsrp.ip)}`);
      if (ic.hsrp.priority !== 100) out.push(` standby ${ic.hsrp.group} priority ${ic.hsrp.priority}`);
      if (ic.hsrp.preempt) out.push(` standby ${ic.hsrp.group} preempt`);
    }
    if (ic.encapsulation) out.push(` encapsulation dot1Q ${ic.encapsulation.vlan}${ic.encapsulation.native ? " native" : ""}`);
    if (ic.accessGroupIn !== null) out.push(" ip access-group " + ic.accessGroupIn + " in");
    if (ic.accessGroupOut !== null) out.push(" ip access-group " + ic.accessGroupOut + " out");
    if (ic.switchport) out.push(...switchportLines(ic.switchport));
    else out.push(ic.ip !== null ? ` ip address ${formatIpv4(ic.ip)} ${formatIpv4(ic.mask!)}` : " no ip address");
    if (ic.shutdown) out.push(" shutdown");
    if (physical && !isSwitch) out.push(" duplex auto", " speed auto");
    if (physical && !ic.cdp) out.push(" no cdp enable");
    out.push("!");
  }

  if (c.defaultGateway !== null) out.push(`ip default-gateway ${formatIpv4(c.defaultGateway)}`);
  if (!isSwitch) out.push("ip forward-protocol nd", "!");
  out.push(isSwitch ? "ip http server" : "no ip http server", isSwitch ? "ip http secure-server" : "no ip http secure-server", "!");
  for (const r of c.staticRoutes) {
    const target = r.exitIface ?? formatIpv4(r.nextHop!);
    out.push(`ip route ${formatIpv4(r.network)} ${formatIpv4(r.mask)} ${target}`);
  }
  if (c.staticRoutes.length) out.push("!");
  for (const nat of c.staticNat) out.push(`ip nat inside source static ${formatIpv4(nat.insideLocal)} ${formatIpv4(nat.insideGlobal)}`);
  for (const rule of c.natOverloads) out.push(`ip nat inside source list ${rule.acl} interface ${rule.outsideInterface} overload`);
  for (const [number, rules] of Object.entries(c.standardAcls).sort(([a], [b]) => Number(a) - Number(b))) {
    for (const rule of rules) out.push("access-list " + number + " " + rule.action + " " + formatAclSource(rule));
  }
  for (const [number, rules] of Object.entries(c.extendedAcls).sort(([a], [b]) => Number(a) - Number(b))) {
    for (const rule of rules) out.push("access-list " + number + " " + rule.action + " " + rule.protocol + " " + formatAclSource(rule.source) + " " + formatAclSource(rule.destination));
  }
  if (Object.keys(c.standardAcls).length || Object.keys(c.extendedAcls).length) out.push("!");
  if (!isSwitch) out.push("control-plane", "!");

  if (c.bannerMotd !== null) out.push("banner motd ^C", ...c.bannerMotd.split("\n"), "^C", "!");

  const line = (header: string, l: LineConfig) => {
    out.push(header);
    if (l.execTimeout) out.push(` exec-timeout ${l.execTimeout[0]} ${l.execTimeout[1]}`);
    if (l.password) out.push(` password ${pw(l.password)}`);
    if (l.loggingSynchronous) out.push(" logging synchronous");
    if (l.loginLocal) out.push(" login local");
    else if (l.login) out.push(" login");
    if (l.transportInput !== "all") out.push(` transport input ${l.transportInput}`);
  };
  line("line con 0", c.con);
  if (!isSwitch) out.push("line aux 0");
  line("line vty 0 4", c.vty);
  if (isSwitch) line("line vty 5 15", c.vty);
  out.push("!", "end");
  return out;
}

/** Switchport lines in the order a Catalyst writes them. Defaults print nothing. */
function switchportLines(sp: SwitchportConfig): string[] {
  const out: string[] = [];
  if (sp.accessVlan !== 1) out.push(` switchport access vlan ${sp.accessVlan}`);
  if (sp.voiceVlan !== null) out.push(` switchport voice vlan ${sp.voiceVlan}`);
  if (sp.nativeVlan !== 1) out.push(` switchport trunk native vlan ${sp.nativeVlan}`);
  if (sp.allowed !== null) out.push(` switchport trunk allowed vlan ${sp.allowed.length ? formatVlanList(sp.allowed) : "none"}`);
  if (sp.mode !== "dynamic auto") out.push(` switchport mode ${sp.mode}`);
  if (sp.nonegotiate) out.push(" switchport nonegotiate");
  if (sp.portfast) out.push(" spanning-tree portfast");
  if (sp.bpduGuard) out.push(" spanning-tree bpduguard enable");
  if (sp.channelGroup !== null && sp.channelMode !== null) out.push(` channel-group ${sp.channelGroup} mode ${sp.channelMode}`);
  if (sp.portSecurity) out.push(" switchport port-security");
  if (sp.portSecurityMaximum !== 1) out.push(` switchport port-security maximum ${sp.portSecurityMaximum}`);
  if (sp.portSecurityViolation !== "shutdown") out.push(` switchport port-security violation ${sp.portSecurityViolation}`);
  if (sp.portSecuritySticky) out.push(" switchport port-security mac-address sticky");
  if (sp.dhcpTrust) out.push(" ip dhcp snooping trust");
  if (sp.dhcpRateLimit !== null) out.push(` ip dhcp snooping limit rate ${sp.dhcpRateLimit}`);
  if (sp.arpInspectionTrust) out.push(" ip arp inspection trust");
  return out;
}

function formatAclSource(rule: AclAddress): string {
  if (rule.network === null) return "any";
  return rule.wildcard === 0 ? formatIpv4(rule.network) : formatIpv4(rule.network) + " " + formatIpv4(rule.wildcard!);
}

function byteCount(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length + 1, 0);
}

interface ConfigStamps {
  changed: number | null;
  nvram: number | null;
}

export function showRunningConfig(device: IosDevice): string[] {
  const body = renderConfig(device, device.config, { changed: device.configChangedAt, nvram: device.nvramWrittenAt });
  return ["Building configuration...", "", `Current configuration : ${byteCount(body)} bytes`, ...body, ""];
}

export function showStartupConfig(device: IosDevice): string[] {
  if (!device.startup) return ["startup-config is not present"];
  const body = renderConfig(device, device.startup, device.startupStamps);
  // NVRAM is 256 KB on the router and 64 KB on the switch.
  return [`Using ${byteCount(body)} out of ${device.kind === "switch" ? 65536 : 262136} bytes`, ...body, ""];
}

export function showIpInterfaceBrief(device: IosDevice): string[] {
  const out = [`${"Interface".padEnd(23)}${"IP-Address".padEnd(16)}OK? Method Status                Protocol `];
  for (const i of device.interfaces()) {
    const c = device.config.interfaces[i.name];
    const ip = c?.ip != null ? formatIpv4(c.ip) : "unassigned";
    const method = c?.ip != null ? "manual" : "unset ";
    out.push(`${i.name.padEnd(23)}${ip.padEnd(16)}YES ${method} ${i.status().padEnd(22)}${i.protocol()} `);
  }
  return out;
}

export function showIpv6InterfaceBrief(device: IosDevice): string[] {
  const out = [`${"Interface".padEnd(23)}${"IPv6-Address".padEnd(42)}${"Status".padEnd(22)}Protocol`];
  for (const i of device.interfaces()) {
    const addresses = device.config.interfaces[i.name]?.ipv6Addresses ?? [];
    out.push(`${i.name.padEnd(23)}${(addresses.length ? addresses.map((a) => `${formatIpv6(a.address)}/${a.prefix}`).join(",") : "unassigned").padEnd(42)}${i.status().padEnd(22)}${i.protocol()}`);
  }
  return out;
}

export function showIpv6Route(device: IosDevice): string[] {
  const out = ["IPv6 Routing Table - default - 1 entries", "Codes: C - Connected, L - Local, S - Static", ""];
  for (const iface of device.interfaces()) {
    for (const address of device.config.interfaces[iface.name]?.ipv6Addresses ?? []) out.push(`C   ${formatIpv6(address.address)}/${address.prefix} is directly connected, ${iface.name}`);
  }
  for (const route of device.config.ipv6StaticRoutes) out.push(`S   ${formatIpv6(route.network)}/${route.prefix} [1/0] via ${route.nextHop ?? route.exitIface ?? "Null0"}`);
  if (device.kind === "router") for (const route of (device as Router).ipv6OspfRoutes()) out.push(`O   ${formatIpv6(route.network)}/${route.prefix} [110/2] via ${route.nextHop ?? route.exitIface ?? "Null0"}`);
  return out;
}

export function showIpv6Neighbors(device: IosDevice): string[] {
  const out = [
    "IPv6 Address                              Age Link-layer Addr State Interface",
  ];
  for (const entry of device.stack.ipv6NeighborEntries().sort((a, b) => a.address.localeCompare(b.address))) {
    const age = Math.floor((device.clock.now - entry.learnedAt) / 1000);
    out.push(`${formatIpv6(entry.address).padEnd(42)}${String(age).padStart(3)} ${formatMacCisco(entry.mac).padEnd(17)} REACH ${entry.iface.name}`);
  }
  return out;
}

export function showIpv6OspfNeighbor(router: Router): string[] {
  const out = ["IPv6 OSPF neighbors", "Neighbor ID     Pri   State           Dead Time   Interface ID    Interface"];
  for (const [index, n] of router.ospfv3Neighbors.entries()) {
    out.push(`${n.router.hostname.padEnd(17)}1     FULL/ -         00:00:40    ${String(index + 1).padEnd(16)}${n.localInterface}`);
  }
  return out;
}

/** How long ago, the way `show interfaces` prints it: 00:00:08, 1d02h, 3w2d, or never. */
export function sinceText(now: number, at: number | null): string {
  if (at === null) return "never";
  const s = Math.floor((now - at) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 86400) return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `${d}d${pad(Math.floor(s / 3600) % 24)}h` : `${Math.floor(d / 7)}w${d % 7}d`;
}

export function showInterfaces(device: IosDevice, only?: string): string[] {
  const out: string[] = [];
  const isSwitch = device.kind === "switch";
  const now = device.clock.now;
  for (const i of device.interfaces()) {
    if (only && i.name !== only) continue;
    const c = device.config.interfaces[i.name];
    const status = i.status();
    const proto = i.protocol();
    const svi = !i.port && !i.name.includes(".");
    const sub = i.name.includes(".");
    const suffix = i.port ? (status === "administratively down" ? " (disabled)" : status === "up" ? " (connected)" : " (notconnect)") : "";
    out.push(`${i.name} is ${status}, line protocol is ${proto}${isSwitch ? suffix : ""} `);
    const gig = i.name.startsWith("Gigabit");
    const hw = svi ? "EtherSVI" : !isSwitch ? "CN Gigabit Ethernet" : gig ? "Gigabit Ethernet" : "Fast Ethernet";
    const mac = formatMacCisco(i.mac);
    out.push(`  Hardware is ${hw}, address is ${mac} (bia ${mac})`);
    if (c?.description) out.push(`  Description: ${c.description}`);
    if (c?.ip != null) out.push(`  Internet address is ${formatIpv4(c.ip)}/${maskToPrefix(c.mask!)}`);
    const fast = i.name.startsWith("Fast");
    out.push(
      `  MTU 1500 bytes, BW ${fast ? 100000 : 1000000} Kbit/sec, DLY ${fast ? 100 : 10} usec, `,
      "     reliability 255/255, txload 1/255, rxload 1/255",
    );
    if (sub) {
      out.push(
        `  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${c?.encapsulation?.vlan ?? 1}.`,
        "  ARP type: ARPA, ARP Timeout 04:00:00",
        "  Keepalive set (10 sec)",
        '  Last clearing of "show interface" counters never',
      );
      continue;
    }
    out.push("  Encapsulation ARPA, loopback not set", svi ? "  Keepalive not supported " : "  Keepalive set (10 sec)");
    if (i.port && isSwitch) {
      const media = gig ? "10/100/1000BaseTX" : "10/100BaseTX";
      out.push(
        status === "up" ? `  Full-duplex, ${gig ? "1000" : "100"}Mb/s, media type is ${media}` : `  Auto-duplex, Auto-speed, media type is ${media}`,
        "  input flow-control is off, output flow-control is unsupported ",
      );
    } else if (i.port) {
      out.push(
        status === "up" ? "  Full Duplex, 1Gbps, media type is RJ45" : "  Auto Duplex, Auto Speed, media type is RJ45",
        "  output flow-control is unsupported, input flow-control is unsupported",
      );
    }
    const st = i.port?.stats;
    out.push(
      "  ARP type: ARPA, ARP Timeout 04:00:00",
      `  Last input ${sinceText(now, st?.lastIn ?? null)}, output ${sinceText(now, st?.lastOut ?? null)}, output hang never`,
      '  Last clearing of "show interface" counters never',
      "  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0",
      "  Queueing strategy: fifo",
      "  Output queue: 0/40 (size/max)",
      "  5 minute input rate 0 bits/sec, 0 packets/sec",
      "  5 minute output rate 0 bits/sec, 0 packets/sec",
      `     ${st?.inPackets ?? 0} packets input, ${st?.inBytes ?? 0} bytes, 0 no buffer`,
      `     Received ${st?.inBroadcasts ?? 0} broadcasts (0 ${isSwitch && !svi ? "multicasts" : "IP multicasts"})`,
      "     0 runts, 0 giants, 0 throttles ",
      "     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored",
    );
    if (!svi) out.push("     0 watchdog, 0 multicast, 0 pause input");
    if (isSwitch && !svi) out.push("     0 input packets with dribble condition detected");
    out.push(`     ${st?.outPackets ?? 0} packets output, ${st?.outBytes ?? 0} bytes, 0 underruns`);
    if (svi) {
      out.push(`     0 output errors, ${proto === "up" ? 1 : 0} interface resets`, "     0 unknown protocol drops");
    } else {
      out.push(
        `     0 output errors, 0 collisions, ${st?.resets ?? 0} interface resets`,
        "     0 unknown protocol drops",
        "     0 babbles, 0 late collision, 0 deferred",
        "     0 lost carrier, 0 no carrier, 0 pause output",
      );
    }
    out.push("     0 output buffer failures, 0 output buffers swapped out");
  }
  return out;
}

export function showInterfacesStatus(sw: Switch): string[] {
  const out = [
    "Port      Name               Status       Vlan       Duplex  Speed Type",
  ];
  for (const port of sw.ports) {
    const sp = sw.switchport(port);
    const status = port.adminDown ? "disabled" : port.protocolUp ? "connected" : "notconnect";
    const vlan = sw.operationalMode(port) === "trunk" ? "trunk" : String(sp.accessVlan);
    const duplex = port.protocolUp ? "a-full" : "auto";
    const speed = port.protocolUp ? (port.name.startsWith("Gigabit") ? "a-1000" : "a-100") : "auto";
    const type = port.name.startsWith("Gigabit") ? "10/100/1000BaseTX" : "10/100BaseTX";
    out.push(
      `${port.shortName.padEnd(10)}${(sw.config.interfaces[port.name].description ?? "").slice(0, 18).padEnd(19)}${status.padEnd(13)}${vlan.padEnd(11)}${duplex.padEnd(8)}${speed.padEnd(7)}${type}`,
    );
  }
  return out;
}

const ROUTE_CODES = [
  "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
  "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
  "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2",
  "       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP",
  "       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2",
  "       ia - IS-IS inter area, * - candidate default, U - per-user static route",
  "       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP",
  "       + - replicated route, % - next hop override",
];

function classfulPrefix(ip: Ipv4): number {
  const first = ip >>> 24;
  if (first < 128) return 8;
  if (first < 192) return 16;
  return 24;
}

function routeTail(r: Route, withPrefix: boolean): string {
  const net = formatIpv4(r.network) + (withPrefix ? `/${maskToPrefix(r.mask)}` : "");
  if (r.code === "S" && r.nextHop !== null) return `${net} [1/0] via ${formatIpv4(r.nextHop)}`;
  if (r.code === "O" && r.nextHop !== null) return `${net} [110/2] via ${formatIpv4(r.nextHop)}`;
  return `${net} is directly connected, ${r.iface!.name}`;
}

export function showIpRoute(device: IosDevice): string[] {
  const routes = device.stack.routes();
  const defaultRoute = routes.find((r) => r.mask === 0 && r.network === 0);
  const out = [...ROUTE_CODES, ""];
  if (defaultRoute) {
    const via = defaultRoute.nextHop !== null ? formatIpv4(defaultRoute.nextHop) : "0.0.0.0";
    out.push(`Gateway of last resort is ${via} to network 0.0.0.0`, "");
  } else {
    out.push("Gateway of last resort is not set", "");
  }

  const groups = new Map<number, Route[]>();
  for (const r of routes) {
    if (r === defaultRoute) continue;
    const prefix = classfulPrefix(r.network);
    const major = networkOf(r.network, prefix === 8 ? 0xff000000 : prefix === 16 ? 0xffff0000 : 0xffffff00);
    groups.set(major, [...(groups.get(major) ?? []), r]);
  }
  const majors = [...groups.keys()].sort((a, b) => a - b);
  for (const major of majors) {
    const rs = groups.get(major)!.sort((a, b) => a.network - b.network || (a.mask >>> 0) - (b.mask >>> 0));
    const cprefix = classfulPrefix(major);
    const masks = new Set(rs.map((r) => r.mask));
    const code = (r: Route) => r.code.padEnd(2);
    if (rs.length === 1 && maskToPrefix(rs[0].mask) === cprefix) {
      out.push(`${code(rs[0])}    ${routeTail(rs[0], true)}`);
    } else if (masks.size > 1) {
      out.push(`      ${formatIpv4(major)}/${cprefix} is variably subnetted, ${rs.length} subnets, ${masks.size} masks`);
      for (const r of rs) out.push(`${code(r)}       ${routeTail(r, true)}`);
    } else {
      out.push(`      ${formatIpv4(major)}/${maskToPrefix(rs[0].mask)} is subnetted, ${rs.length} subnets`);
      for (const r of rs) out.push(`${code(r)}       ${routeTail(r, false)}`);
    }
  }
  if (defaultRoute) out.push(`S*    0.0.0.0/0 [1/0] via ${formatIpv4(defaultRoute.nextHop ?? 0)}`);
  out.push("");
  return out;
}

export function showIpOspfNeighbor(router: Router): string[] {
  const out = ["", "Neighbor ID     Pri   State           Dead Time   Address         Interface"];
  for (const n of router.ospfNeighbors) {
    out.push(`${n.router.config.hostname.padEnd(16)}1     FULL/ -         00:00:34    ${formatIpv4(n.remoteAddress).padEnd(16)}${n.localInterface}`);
  }
  return out;
}

export function showIpProtocols(device: IosDevice): string[] {
  if (device.kind !== "router" || !device.config.ospf) return ["Routing Protocol is \"connected\"", "  Routing Protocol is \"static\"", ""];
  return [
    `Routing Protocol is \"ospf ${device.config.ospf.processId}\"`,
    "  Outgoing update filter list for all interfaces is not set",
    "  Incoming update filter list for all interfaces is not set",
    `  Routing for Networks: ${device.config.ospf.networks.map((n) => formatIpv4(n.network)).join(", ") || "none"}`,
    "  Routing Information Sources:",
    "    Gateway         Distance      Last Update",
    "  Distance: (default is 110)",
    "",
  ];
}

export function showArp(device: IosDevice): string[] {
  const out = ["Protocol  Address          Age (min)  Hardware Addr   Type   Interface"];
  const row = (ip: Ipv4, age: string, mac: string, iface: string) =>
    `Internet  ${formatIpv4(ip).padEnd(17)}${age.padStart(9)}  ${formatMacCisco(mac)}  ARPA   ${iface}`;
  const rows: [Ipv4, string][] = [];
  for (const i of device.l3Interfaces()) {
    if (i.ip !== null && i.up()) rows.push([i.ip, row(i.ip, "-", i.mac, i.name)]);
  }
  const now = device.clock.now;
  for (const e of device.stack.arp.values()) {
    rows.push([e.ip, row(e.ip, String(Math.floor((now - e.learnedAt) / 60000)), e.mac, e.iface.name)]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return [...out, ...rows.map((r) => r[1])];
}

export function showMacAddressTable(sw: Switch): string[] {
  const out = [
    "          Mac Address Table",
    "-------------------------------------------",
    "",
    "Vlan    Mac Address       Type        Ports",
    "----    -----------       --------    -----",
    "",
  ];
  const entries = sw.liveMacEntries().sort((a, b) => a.vlan - b.vlan || (a.mac < b.mac ? -1 : 1));
  for (const e of entries) {
    out.push(`${String(e.vlan).padStart(4)}    ${formatMacCisco(e.mac)}    DYNAMIC     ${e.port.shortName}`);
  }
  return out;
}

/** The VLAN table at the top of `show vlan` and `show vlan brief`. */
function vlanTable(sw: Switch): string[] {
  const out = [
    "",
    "VLAN Name                             Status    Ports",
    "---- -------------------------------- --------- -------------------------------",
  ];
  for (const [id, name] of [...sw.vlans].sort((a, b) => a[0] - b[0])) {
    // Trunks aren't listed under any VLAN. Access ports are, even when they're down.
    const ports = sw.ports.filter((p) => sw.operationalMode(p) !== "trunk" && sw.config.interfaces[p.name].switchport?.accessVlan === id).map((p) => p.shortName);
    const chunks: string[] = [];
    for (let i = 0; i < ports.length; i += 4) chunks.push(ports.slice(i, i + 4).join(", "));
    const status = UNSUPPORTED_VLANS.has(id) ? "act/unsup" : "active";
    // IOS pads the status column even when no ports follow, so those lines end in spaces.
    out.push(`${String(id).padEnd(5)}${name.padEnd(33)}${status.padEnd(10)}${chunks[0] ?? ""}`);
    for (const c of chunks.slice(1)) out.push(`${"".padEnd(48)}${c}`);
  }
  return out;
}

export function showVlanBrief(sw: Switch): string[] {
  return vlanTable(sw);
}

export function showVtpStatus(sw: Switch): string[] {
  return [
    "VTP Version                     : 2",
    `Configuration Revision          : ${sw.vlanDat ? 1 : 0}`,
    `VTP Operating Mode              : ${sw.config.vtpMode}`,
    "Maximum VLANs supported locally : 1005",
    `Number of existing VLANs        : ${sw.vlans.size}`,
    `VTP Domain Name                 : ${sw.config.vtpDomain}`,
    "VTP Pruning Mode                : Disabled",
    "VTP V2 Mode                     : Disabled",
    "VTP Traps Generation            : Disabled",
    "MD5 digest                      : 0x00000000000000000000000000000000",
    "Configuration last modified by  : 0.0.0.0 at 0-00-00 00:00:00",
  ];
}

export function showSpanningTree(sw: Switch): string[] {
  const switches = (sw.network?.devices ?? []).filter((d): d is Switch => d.kind === "switch");
  const out: string[] = [];
  for (const vlan of [...sw.vlans.keys()].filter((v) => sw.vlanActive(v)).sort((a, b) => a - b)) {
    const root = [...switches].sort((a, b) => a.bridgeId(vlan).localeCompare(b.bridgeId(vlan)))[0] ?? sw;
    const rootPriority = root.bridgePriority(vlan) + vlan;
    const rootPorts = sw.ports.filter((p) => sw.stpRole(p, vlan) === "root");
    out.push(`VLAN${String(vlan).padStart(4, "0")}`, "  Spanning tree enabled protocol ieee", `  Root ID    Priority    ${rootPriority}`,
      `             Address     ${formatMacCisco(root.baseMac)}`);
    if (root === sw) out.push("             This bridge is the root");
    else if (rootPorts[0]) out.push(`             Cost        ${rootPorts[0].shortName.startsWith("Gi") ? 4 : 19}`, `             Port        ${rootPorts[0].shortName.replace(/^\D+/, "") || rootPorts[0].shortName}(${rootPorts[0].name})`);
    out.push("", `  Bridge ID  Priority    ${sw.bridgePriority(vlan) + vlan}`, `             Address     ${formatMacCisco(sw.baseMac)}`, "", "Interface        Role Sts Cost      Prio.Nbr Type", "---------------- ---- --- --------- -------- --------------------------------");
    for (const p of sw.ports.filter((p) => sw.vlansOn(p).includes(vlan))) {
      const role = sw.stpRole(p, vlan);
      const state = sw.stpState(p, vlan);
      const roleText = role === "root" ? "Root" : role === "alternate" ? "Altn" : "Desg";
      const stateText = state === "blocking" ? "BLK" : state === "listening" ? "LST" : state === "learning" ? "LRN" : state === "forwarding" ? "FWD" : "---";
      const cost = p.shortName.startsWith("Gi") ? 4 : 19;
      const number = Number(p.shortName.split("/").pop()) || 0;
      out.push(`${p.shortName.padEnd(16)} ${roleText.padEnd(4)} ${stateText.padEnd(3)} ${String(cost).padEnd(9)} 128.${number}    ${p.peer?.device.kind === "switch" ? "P2p" : "Edge"}`);
    }
    out.push("");
  }
  return out;
}

export function showEtherchannelSummary(sw: Switch): string[] {
  const groups = new Map<number, typeof sw.ports>();
  for (const port of sw.ports) {
    const group = sw.switchport(port).channelGroup;
    if (group !== null) groups.set(group, [...(groups.get(group) ?? []), port]);
  }
  const out = ["", "                Port-channel        Protocol    Ports", "Group  Port-channel   Protocol       Ports", "------+-------------+-----------+-----------------------------------------------"];
  for (const [group, ports] of [...groups].sort(([a], [b]) => a - b)) {
    const mode = sw.switchport(ports[0]).channelMode;
    const protocol = mode === "active" || mode === "passive" ? "LACP" : mode === "desirable" || mode === "auto" ? "PAgP" : "-";
    const active = sw.channelGroupActive(ports[0]);
    const members = ports.map((port) => `${port.shortName}${active ? "(P)" : "(s)"}`).join(" ");
    out.push(`${String(group).padStart(5)}  Po${group}-       ${protocol.padEnd(12)} ${members}`);
  }
  if (groups.size === 0) out.push("No EtherChannels configured.");
  out.push("");
  return out;
}

const VLAN_TYPES: Record<number, [string, string]> = { 1002: ["fddi", "-"], 1003: ["tr", "-"], 1004: ["fdnet", "ieee"], 1005: ["trnet", "ibm"] };

export function showVlan(sw: Switch): string[] {
  const out = [
    ...vlanTable(sw),
    "",
    "VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2",
    "---- ----- ---------- ----- ------ ------ -------- ---- -------- ------ ------",
  ];
  for (const id of [...sw.vlans.keys()].sort((a, b) => a - b)) {
    const [type, stp] = VLAN_TYPES[id] ?? ["enet", "-"];
    out.push(`${String(id).padEnd(5)}${type.padEnd(6)}${String(100000 + id).padEnd(11)}1500  -      -      -        ${stp.padEnd(5)}-        0      0   `);
  }
  out.push(
    "",
    "Remote SPAN VLANs",
    "------------------------------------------------------------------------------",
    "",
    "",
    "Primary Secondary Type              Ports",
    "------- --------- ----------------- ------------------------------------------",
    "",
  );
  return out;
}

export function showInterfacesTrunk(sw: Switch): string[] {
  const trunks = sw.ports.filter((p) => sw.operationalMode(p) === "trunk");
  if (!trunks.length) return [];
  const list = (vlans: number[]) => (vlans.length ? formatVlanList(vlans) : "none");
  const mode = (p: (typeof trunks)[number]) => {
    const sp = sw.switchport(p);
    if (sp.mode === "trunk") return sp.nonegotiate ? "nonegotiate" : "on";
    return sp.mode === "dynamic desirable" ? "desirable" : "auto";
  };
  const out = ["", "Port        Mode             Encapsulation  Status        Native vlan"];
  for (const p of trunks) out.push(`${p.shortName.padEnd(12)}${mode(p).padEnd(17)}${"802.1q".padEnd(15)}${"trunking".padEnd(14)}${sw.switchport(p).nativeVlan}`);
  out.push("", "Port        Vlans allowed on trunk");
  for (const p of trunks) out.push(`${p.shortName.padEnd(12)}${list(sw.switchport(p).allowed ?? [...Array(4094).keys()].map((i) => i + 1))}`);
  out.push("", "Port        Vlans allowed and active in management domain");
  for (const p of trunks) out.push(`${p.shortName.padEnd(12)}${list(sw.vlansOn(p))}`);
  out.push("", "Port        Vlans in spanning tree forwarding state and not pruned");
  for (const p of trunks) out.push(`${p.shortName.padEnd(12)}${list(sw.forwardingVlans(p))}`);
  out.push("");
  return out;
}

const ADMIN_MODE: Record<SwitchportMode, string> = {
  access: "static access",
  trunk: "trunk",
  "dynamic auto": "dynamic auto",
  "dynamic desirable": "dynamic desirable",
};

export function showInterfacesSwitchport(sw: Switch, only?: string): string[] {
  const out: string[] = [];
  const vlanLabel = (id: number) => (sw.vlanActive(id) ? `${id} (${sw.vlans.get(id)})` : `${id} (Inactive)`);
  for (const p of sw.ports) {
    if (only && p.name !== only) continue;
    const sp = sw.switchport(p);
    if (!sp) {
      out.push(`Name: ${p.shortName}`, "Switchport: Disabled", "");
      continue;
    }
    const op = sw.operationalMode(p);
    out.push(
      `Name: ${p.shortName}`,
      "Switchport: Enabled",
      `Administrative Mode: ${ADMIN_MODE[sp.mode]}`,
      `Operational Mode: ${op === "access" ? "static access" : op}`,
      "Administrative Trunking Encapsulation: dot1q",
      `Operational Trunking Encapsulation: ${op === "trunk" ? "dot1q" : "native"}`,
      `Negotiation of Trunking: ${sp.mode === "access" || sp.nonegotiate ? "Off" : "On"}`,
      `Access Mode VLAN: ${vlanLabel(sp.accessVlan)}`,
      `Trunking Native Mode VLAN: ${vlanLabel(sp.nativeVlan)}`,
      "Administrative Native VLAN tagging: enabled",
      `Voice VLAN: ${sp.voiceVlan === null ? "none" : vlanLabel(sp.voiceVlan)}`,
      `Port Security: ${sp.portSecurity ? "Enabled" : "Disabled"}`,
      `Port Security Maximum: ${sp.portSecurityMaximum}`,
      `Port Security Violation Mode: ${sp.portSecurityViolation}`,
      `Sticky MAC Addresses: ${sp.portSecuritySticky ? "Enabled" : "Disabled"}`,
      `Secure MAC Addresses: ${sp.secureMacs.length}`,
      `DHCP Snooping Trust: ${sp.dhcpTrust ? "trusted" : "untrusted"}`,
      `DHCP Snooping Rate Limit: ${sp.dhcpRateLimit ?? "none"}`,
      `ARP Inspection Trust: ${sp.arpInspectionTrust ? "trusted" : "untrusted"}`,
      "Administrative private-vlan host-association: none ",
      "Administrative private-vlan mapping: none ",
      "Administrative private-vlan trunk native VLAN: none",
      "Administrative private-vlan trunk Native VLAN tagging: enabled",
      "Administrative private-vlan trunk encapsulation: dot1q",
      "Administrative private-vlan trunk normal VLANs: none",
      "Administrative private-vlan trunk associations: none",
      "Administrative private-vlan trunk mappings: none",
      "Operational private-vlan: none",
      `Trunking VLANs Enabled: ${sp.allowed === null ? "ALL" : sp.allowed.length ? formatVlanList(sp.allowed) : "NONE"}`,
      "Pruning VLANs Enabled: 2-1001",
      "Capture Mode Disabled",
      "Capture VLANs Allowed: ALL",
      "",
      "Protected: false",
      "Unknown unicast blocked: disabled",
      "Unknown multicast blocked: disabled",
      "Appliance trust: none",
      "",
    );
  }
  return out;
}

export function showIpDhcpSnooping(sw: Switch): string[] {
  const out = [
    "DHCP snooping is " + (sw.config.dhcpSnooping ? "active" : "not configured"),
    `DHCP snooping is configured on VLANs: ${sw.config.dhcpSnoopingVlans.length ? formatVlanList(sw.config.dhcpSnoopingVlans) : "none"}`,
    "Insertion of option 82 is enabled",
    "Verification of hwaddr field is enabled",
    "",
    "Interface                  Trusted     Rate limit (pps)",
  ];
  for (const p of sw.ports) {
    const sp = sw.switchport(p);
    out.push(`${p.shortName.padEnd(27)}${(sp.dhcpTrust ? "yes" : "no").padEnd(12)}${sp.dhcpRateLimit ?? "none"}`);
  }
  return out;
}

export function showIpDhcpSnoopingBinding(sw: Switch): string[] {
  const out = ["MacAddress          IpAddress        Lease(sec)  Type           VLAN  Interface", "------------------  ---------------  ----------  -------------  ----  -----------------"];
  for (const b of sw.config.dhcpSnoopingBindings) {
    out.push(`${formatMacCisco(b.mac).padEnd(20)}${formatIpv4(b.ip).padEnd(17)}${"-".padEnd(12)}${"dhcp-snooping".padEnd(15)}${String(b.vlan).padEnd(6)}${b.port}`);
  }
  return out;
}

export function showIpArpInspection(sw: Switch): string[] {
  const out = [
    `Source MAC validation: ${sw.config.arpInspectionVlans.length ? "enabled" : "disabled"}`,
    `Destination MAC validation: ${sw.config.arpInspectionVlans.length ? "enabled" : "disabled"}`,
    `IP address validation: ${sw.config.arpInspectionVlans.length ? "enabled" : "disabled"}`,
    `Inspection VLANs: ${sw.config.arpInspectionVlans.length ? formatVlanList(sw.config.arpInspectionVlans) : "none"}`,
    "",
    "Interface                  Trusted",
  ];
  for (const p of sw.ports) out.push(`${p.shortName.padEnd(27)}${sw.switchport(p).arpInspectionTrust ? "yes" : "no"}`);
  return out;
}

/** The first lines of `show version`, which IOS also prints while it boots. */
export function showVersionBanner(device: IosDevice): string[] {
  const isRouter = device.kind === "router";
  return [
    `Cryptis IOS Software, ${isRouter ? "CR-2900" : "CS-2960"} Software, Version ${isRouter ? IOS_VERSION : "15.0(2)SE4"}, RELEASE SOFTWARE (fc2)`,
    "Technical Support: please do not call after dark",
    "Copyright (c) 1986-1993 by Cryptis Systems, Inc. All rights reserved, and some that were not.",
  ];
}

export function showVersion(device: IosDevice): string[] {
  const isRouter = device.kind === "router";
  const uptimeMin = Math.floor(device.clock.now / 60000);
  const image = isRouter ? "cr2900-universalk9-mz.SPA.151-4.M4.bin" : "cs2960-lanbasek9-mz.150-2.SE4.bin";
  return [
    ...showVersionBanner(device),
    "",
    "ROM: System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)",
    "",
    `${device.hostname} uptime is ${uptimeMin} minute${uptimeMin === 1 ? "" : "s"}`,
    "System returned to ROM by power-on",
    `System image file is "flash:${image}"`,
    "",
    `Cryptis ${device.model} (revision 1.0) with 491520K/32768K bytes of memory.`,
    isRouter ? "3 Gigabit Ethernet interfaces" : "24 FastEthernet interfaces\n2 Gigabit Ethernet interfaces",
    "255K bytes of non-volatile configuration memory.",
    "",
    "Configuration register is 0x2102",
    "",
  ].flatMap((l) => l.split("\n"));
}

/** CDP's short interface names: "Gig 0/0", "Fas 0/1". */
function cdpIfName(name: string): string {
  const m = /^([A-Za-z]+)(.*)$/.exec(name)!;
  return `${m[1].slice(0, 3)} ${m[2]}`;
}

export function showCdp(device: IosDevice): string[] {
  if (!device.config.cdpRun) return ["% CDP is not enabled"];
  return [
    "Global CDP information:",
    "    Sending CDP packets every 60 seconds",
    "    Sending a holdtime value of 180 seconds",
    "    Sending CDPv2 advertisements is enabled",
  ];
}

export function showCdpNeighbors(device: IosDevice): string[] {
  if (!device.config.cdpRun) return ["% CDP is not enabled"];
  const now = device.clock.now;
  const out = [
    "Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge",
    "                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone",
    "Device ID    Local Intrfce   Holdtme    Capability   Platform    Port ID",
  ];
  for (const n of device.liveCdpNeighbors()) {
    const hold = String(Math.ceil((n.expiresAt - now) / 1000));
    const cap = n.capability === "Router" ? "R" : "S";
    out.push(
      `${n.deviceId.padEnd(13)}${cdpIfName(n.localPort.name).padEnd(16)}${hold.padEnd(15)}${cap.padEnd(9)}${(n.platform.replace("Cryptis ", "") + " ").padEnd(12)}${cdpIfName(n.portId)}`,
    );
  }
  return out;
}

export function showCdpNeighborsDetail(device: IosDevice): string[] {
  if (!device.config.cdpRun) return ["% CDP is not enabled"];
  const now = device.clock.now;
  const out: string[] = [];
  for (const n of device.liveCdpNeighbors()) {
    out.push(
      "",
      `Device ID: ${n.deviceId}`,
      "Entry address(es): ",
      ...(n.address !== null ? [`  IP address : ${formatIpv4(n.address)}`] : []),
      `Platform: ${n.platform}, Capabilities: ${n.capability}`,
      `Interface: ${n.localPort.name}, Port ID (outgoing port): ${n.portId}`,
      `Holdtime: ${Math.ceil((n.expiresAt - now) / 1000)}`,
      "",
      "Version :",
      n.version,
      "",
      "advertisement version: 2",
      "Duplex: full",
      "---------------------------",
    );
  }
  return out;
}

export function showClock(device: IosDevice): string[] {
  // Every device in Static Springs believes it is March 1st, 1993.
  const ms = device.clock.now;
  const h = Math.floor(ms / 3_600_000) % 24;
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const frac = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return [`*${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)} UTC Mon Mar 1 1993`];
}

export function showSsh(device: IosDevice): string[] {
  const c = device.config;
  return [
    c.rsaKeysGenerated && c.domainName ? "SSH Enabled - version 1.99" : "SSH Disabled - version 1.99",
    "Authentication timeout: 120 secs; Authentication retries: 3",
    `Local user authentication: ${c.vty.loginLocal ? "enabled" : "disabled"}`,
    `VTY transport input: ${c.vty.transportInput}`,
  ];
}

export function showAccessLists(device: IosDevice): string[] {
  const out: string[] = [];
  for (const [number, rules] of Object.entries(device.config.standardAcls).sort(([a], [b]) => Number(a) - Number(b))) {
    out.push(`Standard IP access list ${number}`);
    rules.forEach((rule, index) => out.push(`    ${(index + 1) * 10} ${rule.action} ${formatAclSource(rule)}`));
  }
  for (const [number, rules] of Object.entries(device.config.extendedAcls).sort(([a], [b]) => Number(a) - Number(b))) {
    out.push("Extended IP access list " + number);
    rules.forEach((rule, index) => out.push("    " + ((index + 1) * 10) + " " + rule.action + " " + rule.protocol + " " + formatAclSource(rule.source) + " " + formatAclSource(rule.destination)));
  }
  return out.length ? out : ["No access lists configured"];
}

export function showIpNatTranslations(device: IosDevice): string[] {
  const out = ["Pro Inside global      Pro Inside local       Outside local      Outside global", "--- -------------------- -------------------- --------------- ---------------"];
  for (const nat of device.config.staticNat) out.push(`--- ${formatIpv4(nat.insideGlobal).padEnd(20)} ${formatIpv4(nat.insideLocal).padEnd(20)} ---               ---`);
  if (device.kind === "router") for (const nat of (device as Router).natPatTranslations()) out.push(`icmp ${formatIpv4(nat.globalIp).padEnd(20)} ${formatIpv4(nat.localIp).padEnd(20)} ---               ---`);
  return out;
}

export function showStandby(router: Router): string[] {
  const out: string[] = [];
  for (const iface of router.interfaces()) {
    const h = router.config.interfaces[iface.name]?.hsrp;
    if (!h || iface.status() !== "up") continue;
    const active = router.hsrpActive(iface.name);
    out.push(`${iface.name} - Group ${h.group}`, `  State is ${active === router ? "Active" : "Standby"}`, `  Virtual IP address is ${formatIpv4(h.ip)}`, `  Priority ${h.priority}`, `  Active router is ${active.hostname}`);
  }
  return out.length ? out : ["HSRP is not configured"];
}

// ---- DHCP ----------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A simulated time as IOS prints dates, counting from midnight on March 1st, 1993. */
export function iosDate(ms: number): string {
  const d = new Date(Date.UTC(1993, 2, 1) + ms);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(h12)}:${pad(d.getUTCMinutes())} ${h24 < 12 ? "AM" : "PM"}`;
}

/** DHCP client IDs are 01 (Ethernet) followed by the MAC, dotted every four digits. */
function clientId(mac: string): string {
  return ("01" + mac).match(/.{1,4}/g)!.join(".");
}

export function showDhcpBinding(router: Router): string[] {
  const out = [
    "Bindings from all pools not associated with VRF:",
    "IP address          Client-ID/              Lease expiration        Type",
    "                    Hardware address/",
    "                    User name",
  ];
  for (const b of router.dhcp.liveBindings()) {
    const expires = b.expiresAt === null ? "Infinite" : iosDate(b.expiresAt);
    out.push(`${formatIpv4(b.ip).padEnd(20)}${clientId(b.mac).padEnd(24)}${expires.padEnd(24)}Automatic`);
  }
  return out;
}

export function showDhcpPool(router: Router): string[] {
  const out: string[] = [];
  const bindings = router.dhcp.liveBindings();
  for (const p of router.config.dhcpPools) {
    out.push("", `Pool ${p.name} :`, " Utilization mark (high/low)    : 100 / 0", " Subnet size (first/next)       : 0 / 0 ");
    if (p.network === null) {
      out.push(" Total addresses                : 0", " Leased addresses               : 0", " Pending event                  : none", " 0 subnet is currently in the pool :");
      continue;
    }
    const first = p.network + 1;
    const last = broadcastOfMask(p.network, p.mask!) - 1;
    const leased = bindings.filter((b) => b.pool === p.name);
    const next = leased.length ? Math.max(...leased.map((b) => b.ip)) + 1 : first;
    out.push(
      ` Total addresses                : ${last - first + 1}`,
      ` Leased addresses               : ${leased.length}`,
      " Pending event                  : none",
      " 1 subnet is currently in the pool :",
      " Current index        IP address range                    Leased addresses",
      ` ${formatIpv4(next).padEnd(21)}${formatIpv4(first).padEnd(17)}- ${formatIpv4(last).padEnd(18)}${leased.length}`,
    );
  }
  return out;
}

export function showDhcpConflict(router: Router): string[] {
  const out = ["IP address        Detection method   Detection time          VRF"];
  for (const c of [...router.dhcp.conflicts.values()].sort((a, b) => a.ip - b.ip)) {
    out.push(`${formatIpv4(c.ip).padEnd(18)}${"Ping".padEnd(19)}${iosDate(c.detectedAt)}`);
  }
  return out;
}

function broadcastOfMask(network: number, mask: number): number {
  return (network | (~mask >>> 0)) >>> 0;
}
