import { parseIpv4 as ip, networkOf, type Ipv4 } from "../addr";
import { Pc } from "../devices/pc";
import { Router } from "../devices/router";
import { Switch } from "../devices/switch";
import { Network } from "../network";
import { LAUNDROMAT_INCANTATIONS } from "./laundromat";
import type { Scenario, Task } from "./types";

/** What Walter teaches on job 3, on top of everything from jobs 1 and 2. */
export const DENTIST_INCANTATIONS = [
  ...LAUNDROMAT_INCANTATIONS,
  "config: vlan",
  "vlan: name",
  "if: switchport mode",
  "if: switchport access vlan",
  "if: switchport trunk",
  "if: encapsulation dot1Q",
  "exec: show vlan brief",
  "exec: show interfaces trunk",
];

/**
 * Job 3: the dentist's office. Staff and the X-ray room on separate VLANs,
 * one trunk to the router, and the router routing between them.
 *
 *   Front desk ── Fa0/1 ┐ (VLAN 10)
 *   Billing ───── Fa0/2 ┼ S1 Gi0/1 ══ trunk ══ Gi0/0 R1 (.10 and .20)
 *   X-ray ─────── Fa0/3 ┘ (VLAN 20)
 */
export function dentist() {
  const net = new Network();
  const r1 = net.add(new Router("R1"));
  const s1 = net.add(new Switch("S1"));
  const frontDesk = new Pc("PC0", "Front Desk");
  const billing = new Pc("PC1", "Billing");
  const xray = new Pc("PC2", "X-Ray");
  for (const pc of [frontDesk, billing, xray]) {
    pc.dhcp = true;
    net.add(pc);
  }
  net.connect(r1.port("GigabitEthernet0/0"), s1.port("GigabitEthernet0/1"));
  net.connect(frontDesk.nic, s1.port("FastEthernet0/1"));
  net.connect(billing.nic, s1.port("FastEthernet0/2"));
  net.connect(xray.nic, s1.port("FastEthernet0/3"));

  const MASK = ip("255.255.255.0")!;
  const STAFF_NET = ip("192.168.10.0")!;
  const XRAY_NET = ip("192.168.20.0")!;
  const STAFF_GW = ip("192.168.10.1")!;
  const XRAY_GW = ip("192.168.20.1")!;

  const accessIn = (port: string, vlan: number) => {
    const sp = s1.switchport(s1.port(port));
    return sp.mode === "access" && sp.accessVlan === vlan;
  };
  const sub = (vlan: number, gw: Ipv4) =>
    Object.entries(r1.config.interfaces).some(
      ([name, c]) => name.startsWith("GigabitEthernet0/0.") && c.encapsulation?.vlan === vlan && c.ip === gw && c.mask === MASK && !c.shutdown,
    );
  const pool = (net: Ipv4, gw: Ipv4) => r1.config.dhcpPools.some((p) => p.network === net && p.mask === MASK && p.defaultRouters[0] === gw);
  const leasedIn = (pc: Pc, net: Ipv4, gw: Ipv4) => !!pc.lease && pc.ip !== null && networkOf(pc.ip, MASK) === net && pc.gateway === gw;
  const trunk = s1.port("GigabitEthernet0/1");

  const tasks: Task[] = [
    {
      text: "On S1, create VLAN 10 named STAFF and VLAN 20 named XRAY.",
      done: () => s1.vlans.get(10) === "STAFF" && s1.vlans.get(20) === "XRAY",
    },
    {
      text: "Make Fa0/1 and Fa0/2 access ports in VLAN 10, and Fa0/3 an access port in VLAN 20.",
      done: () => accessIn("Fa0/1", 10) && accessIn("Fa0/2", 10) && accessIn("Fa0/3", 20),
    },
    {
      text: "Make S1's Gi0/1 a trunk. Routers don't negotiate trunks, so you'll have to force it.",
      done: () => s1.switchport(trunk).mode === "trunk" && s1.operationalMode(trunk) === "trunk",
    },
    {
      text: "On R1, bring up Gi0/0 and give it two subinterfaces: VLAN 10 at 192.168.10.1/24 and VLAN 20 at 192.168.20.1/24.",
      done: () => r1.port("Gi0/0").protocolUp && sub(10, STAFF_GW) && sub(20, XRAY_GW),
    },
    {
      text: "Create a DHCP pool for each VLAN, each handing out its own gateway.",
      done: () => pool(STAFF_NET, STAFF_GW) && pool(XRAY_NET, XRAY_GW),
    },
    {
      text: "Get all three PCs a lease in the right VLAN: the front desk and billing in 192.168.10.0, the X-ray room in 192.168.20.0.",
      done: () => leasedIn(frontDesk, STAFF_NET, STAFF_GW) && leasedIn(billing, STAFF_NET, STAFF_GW) && leasedIn(xray, XRAY_NET, XRAY_GW),
    },
    {
      text: "Ping the X-ray PC from the front desk. It has to go through the router.",
      done: () => xray.ip !== null && networkOf(xray.ip, MASK) === XRAY_NET && frontDesk.stack.repliesFrom.has(xray.ip),
    },
    { text: "Do not open the drawer marked TEETH (SPARE). Dr. Marrow counts them." },
  ];

  const scenario: Scenario = {
    net,
    layout: {
      R1: { x: 400, y: 40 },
      S1: { x: 400, y: 175 },
      PC0: { x: 180, y: 290 },
      PC1: { x: 400, y: 300 },
      PC2: { x: 620, y: 290 },
    },
    tasks,
    incantations: DENTIST_INCANTATIONS,
    start: s1,
    workOrder: {
      number: "0003",
      client: "Marrow Family Dentistry",
      place: "The shopfront row past the Quik-Stop, Static Springs. Dr. Ilse Marrow, DDS. Evening appointments only.",
      notes: "Everything is cabled and set to get an address automatically. The X-ray room must not share a network with the front desk. Nothing is configured.",
      hint: "VLANs are created when you leave config-vlan mode. After a PC moves to a new VLAN, run ipconfig /renew on it.",
    },
  };
  return { ...scenario, r1, s1, frontDesk, billing, xray };
}
