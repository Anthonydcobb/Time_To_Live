import { parseIpv4 as ip, networkOf } from "../addr";
import { Pc } from "../devices/pc";
import { Router } from "../devices/router";
import { Switch } from "../devices/switch";
import { Network } from "../network";
import { CORNER_STORE_INCANTATIONS } from "./corner-store";
import type { Scenario, Task } from "./types";

/** What Walter teaches on job 2, on top of everything from job 1. */
export const LAUNDROMAT_INCANTATIONS = [
  ...CORNER_STORE_INCANTATIONS,
  "config: ip dhcp pool",
  "config: ip dhcp excluded-address",
  "dhcp: network",
  "dhcp: default-router",
  "dhcp: dns-server",
  "exec: show ip dhcp binding",
  "exec: show ip dhcp pool",
];

/**
 * Job 2: the 24-hour laundromat. The PCs want DHCP, the printer needs a fixed address.
 *
 *   Kiosk ─── Fa0/1 ┐
 *   Office ── Fa0/2 ┼ S1 Gi0/1 ── Gi0/0 R1
 *   Printer ─ Fa0/3 ┘
 */
export function laundromat() {
  const net = new Network();
  const r1 = net.add(new Router("R1"));
  const s1 = net.add(new Switch("S1"));
  const kiosk = new Pc("PC0", "Change Kiosk");
  const office = new Pc("PC1", "Office");
  // Both PCs are set to obtain an address automatically, so they start asking as soon as they're plugged in.
  kiosk.dhcp = true;
  office.dhcp = true;
  net.add(kiosk);
  net.add(office);
  const printer = net.add(new Pc("PRN", "Printer"));
  net.connect(r1.port("GigabitEthernet0/0"), s1.port("GigabitEthernet0/1"));
  net.connect(kiosk.nic, s1.port("FastEthernet0/1"));
  net.connect(office.nic, s1.port("FastEthernet0/2"));
  net.connect(printer.nic, s1.port("FastEthernet0/3"));

  const GW = ip("192.168.20.1")!;
  const MASK = ip("255.255.255.0")!;
  const NET = ip("192.168.20.0")!;
  const PRINTER = ip("192.168.20.5")!;
  const g00 = () => r1.config.interfaces["GigabitEthernet0/0"];
  const excludedThrough20 = () => {
    for (let a = GW; a <= ip("192.168.20.20")!; a++) {
      if (!r1.config.dhcpExcluded.some((r) => a >= r.low && a <= r.high)) return false;
    }
    return true;
  };
  const leased = (pc: Pc) => !!pc.lease && pc.ip !== null && networkOf(pc.ip, MASK) === NET && pc.gateway === GW;
  const tasks: Task[] = [
    {
      text: "On the router, give Gi0/0 the address 192.168.20.1 255.255.255.0 and bring it up.",
      done: () => g00().ip === GW && g00().mask === MASK && r1.port("Gi0/0").protocolUp,
    },
    {
      text: "Keep 192.168.20.1 through .20 out of DHCP for printers and other fixed gear.",
      done: excludedThrough20,
    },
    {
      text: "Create a DHCP pool for 192.168.20.0/24 that hands out 192.168.20.1 as the default gateway.",
      done: () => r1.config.dhcpPools.some((p) => p.network === NET && p.mask === MASK && p.defaultRouters[0] === GW),
    },
    {
      text: "Set the printer to 192.168.20.5 255.255.255.0 with gateway 192.168.20.1.",
      done: () => printer.ip === PRINTER && printer.mask === MASK && printer.gateway === GW,
    },
    {
      text: "Get both PCs an address from DHCP. (They already tried once and gave up. Try ipconfig /renew.)",
      done: () => leased(kiosk) && leased(office),
    },
    {
      text: "Ping the printer from both PCs.",
      done: () => kiosk.stack.repliesFrom.has(PRINTER) && office.stack.repliesFrom.has(PRINTER),
    },
    { text: "The dryers are not on the network. Please stop asking them for their IP addresses." },
  ];

  const scenario: Scenario = {
    net,
    layout: {
      R1: { x: 400, y: 40 },
      S1: { x: 400, y: 175 },
      PC0: { x: 180, y: 290 },
      PC1: { x: 400, y: 300 },
      PRN: { x: 620, y: 290 },
    },
    tasks,
    incantations: LAUNDROMAT_INCANTATIONS,
    start: r1,
    workOrder: {
      number: "0002",
      client: "Spin Cycle Eternal",
      place: "24-hour laundromat on Route 9, Static Springs. Night manager: Gus, on shift since 1974.",
      notes: "Everything is cabled. The PCs are set to get an address automatically. Nothing on the router is configured.",
      hint: "On a PC: ipconfig /renew asks for a lease. On the printer: ipconfig 192.168.20.5 255.255.255.0 192.168.20.1",
    },
  };
  return { ...scenario, r1, s1, kiosk, office, printer };
}
