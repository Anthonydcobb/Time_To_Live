import { Pc } from "../devices/pc";
import { Router } from "../devices/router";
import { Switch } from "../devices/switch";
import { parseIpv4 as ip } from "../addr";
import { Network } from "../network";

/** One line of a work order. `done` reads the live network, so it ticks itself off. */
export interface Task {
  text: string;
  done?: () => boolean;
}

/**
 * Job 1: the corner store. Everything is cabled, nothing is configured.
 *
 *   PC0 (register) ── Fa0/1 ┐
 *                           S1 Gig0/1 ── Gig0/0 R1
 *   PC1 (back office) ─ Fa0/2 ┘
 */
export function cornerStore() {
  const net = new Network();
  const r1 = net.add(new Router("R1"));
  const s1 = net.add(new Switch("S1"));
  const register = net.add(new Pc("PC0", "Register"));
  const office = net.add(new Pc("PC1", "Back Office"));
  net.connect(r1.port("GigabitEthernet0/0"), s1.port("GigabitEthernet0/1"));
  net.connect(register.nic, s1.port("FastEthernet0/1"));
  net.connect(office.nic, s1.port("FastEthernet0/2"));
  // Where each device sits on the logical diagram, in an 800 x 360 drawing.
  const layout = {
    R1: { x: 400, y: 40 },
    S1: { x: 400, y: 175 },
    PC0: { x: 220, y: 290 },
    PC1: { x: 580, y: 290 },
  };

  const R1 = ip("192.168.1.1")!;
  const REGISTER = ip("192.168.1.10")!;
  const OFFICE = ip("192.168.1.11")!;
  const MASK = ip("255.255.255.0")!;
  const g00 = () => r1.config.interfaces["GigabitEthernet0/0"];
  const tasks: Task[] = [
    {
      text: "On the router, give Gig0/0 the address 192.168.1.1 255.255.255.0 and turn it on with no shutdown.",
      done: () => g00().ip === R1 && g00().mask === MASK && r1.port("Gig0/0").protocolUp,
    },
    {
      text: "Set the Register PC to 192.168.1.10 255.255.255.0 with gateway 192.168.1.1.",
      done: () => register.ip === REGISTER && register.mask === MASK && register.gateway === R1,
    },
    {
      text: "Set the Back Office PC to 192.168.1.11 255.255.255.0 with gateway 192.168.1.1.",
      done: () => office.ip === OFFICE && office.mask === MASK && office.gateway === R1,
    },
    {
      text: "From each PC, ping the router at 192.168.1.1.",
      done: () => register.stack.repliesFrom.has(R1) && office.stack.repliesFrom.has(R1),
    },
    {
      text: "Ping between the two PCs to prove they can reach each other.",
      done: () => register.stack.repliesFrom.has(OFFICE) || office.stack.repliesFrom.has(REGISTER),
    },
    { text: "Do not restock the back cooler." },
  ];
  return { net, r1, s1, register, office, layout, tasks };
}
