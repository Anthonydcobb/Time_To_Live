import { Pc } from "../devices/pc";
import { Router } from "../devices/router";
import { Switch } from "../devices/switch";
import { parseIpv4 as ip } from "../addr";
import { Network } from "../network";

import type { Scenario, Task } from "./types";

export type { Task } from "./types";

/**
 * Job 1: the corner store. Nothing is configured. The bench starts with
 * everything cabled; the game starts with the cables loose so you run them.
 *
 *   PC0 (register) ── Fa0/1 ┐
 *                           S1 Gi0/1 ── Gi0/0 R1
 *   PC1 (back office) ─ Fa0/2 ┘
 */
/** What Walter teaches on job 1. Everything else shows as runes until learned. */
export const CORNER_STORE_INCANTATIONS = [
  "exec: configure terminal",
  "exec: show running-config",
  "exec: show ip interface brief",
  "exec: ping",
  "exec: copy running-config startup-config",
  "config: hostname",
  "config: interface",
  "config: enable secret",
  "config: line console",
  "if: ip address",
  "if: shutdown",
  "if: no shutdown",
  "if: description",
  "line: password",
  "line: login",
];

export function cornerStore({ cabled = true } = {}) {
  const net = new Network();
  const r1 = net.add(new Router("R1"));
  const s1 = net.add(new Switch("S1"));
  const register = net.add(new Pc("PC0", "Register"));
  const office = net.add(new Pc("PC1", "Back Office"));
  if (cabled) {
    net.connect(r1.port("GigabitEthernet0/0"), s1.port("GigabitEthernet0/1"));
    net.connect(register.nic, s1.port("FastEthernet0/1"));
    net.connect(office.nic, s1.port("FastEthernet0/2"));
  }
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
  const onSwitch = (p: { peer: { device: unknown } | null }) => p.peer?.device === s1;
  // A console password only protects anything once `login` makes the console ask for it.
  const lineLocked = (line: { password: unknown; login: boolean }) => line.password !== null && line.login;
  const consoleLocked = (d: Router | Switch) => lineLocked(d.config.con);
  const tasks: Task[] = [
    ...(cabled
      ? []
      : [
          {
            id: "cable",
            text: "Cable the router's Gi0/0 to the switch, and plug both PCs into the switch.",
            done: () => r1.port("Gi0/0").peer?.device === s1 && onSwitch(register.nic) && onSwitch(office.nic),
          },
        ]),
    // One box at a time, the way a tech works: finish the router, then the switch, then the PCs.
    // On each, identity and security come before interfaces.
    {
      id: "r1-name",
      text: "Router: name it R1 with hostname.",
      done: () => r1.hostname === "R1",
    },
    {
      id: "r1-secret",
      text: "Router: lock privileged mode with an enable secret.",
      done: () => r1.config.enableSecret !== null,
    },
    {
      id: "r1-console",
      text: "Router: password-protect the console (line console 0, password, login).",
      done: () => consoleLocked(r1),
    },
    {
      id: "router",
      text: "Router: give Gi0/0 the address 192.168.1.1 255.255.255.0 and turn it on with no shutdown.",
      done: () => g00().ip === R1 && g00().mask === MASK && r1.port("Gi0/0").protocolUp,
    },
    {
      id: "r1-save",
      text: "Router: save it with copy running-config startup-config.",
      // The saved config has to hold the router's setup, so saving too early doesn't count.
      done: () => {
        const s = r1.startup;
        const g = s?.interfaces["GigabitEthernet0/0"];
        return !!s && s.hostname === "R1" && s.enableSecret !== null && lineLocked(s.con) && g?.ip === R1 && g.mask === MASK && !g.shutdown;
      },
    },
    {
      id: "s1-name",
      text: "Switch: name it S1 with hostname.",
      done: () => s1.hostname === "S1",
    },
    {
      id: "s1-secret",
      text: "Switch: lock privileged mode with an enable secret.",
      done: () => s1.config.enableSecret !== null,
    },
    {
      id: "s1-console",
      text: "Switch: password-protect the console (line console 0, password, login).",
      done: () => consoleLocked(s1),
    },
    {
      id: "s1-save",
      text: "Switch: save it with copy running-config startup-config.",
      done: () => {
        const s = s1.startup;
        return !!s && s.hostname === "S1" && s.enableSecret !== null && lineLocked(s.con);
      },
    },
    {
      id: "register",
      text: "Set the Register PC to 192.168.1.10 255.255.255.0 with gateway 192.168.1.1.",
      done: () => register.ip === REGISTER && register.mask === MASK && register.gateway === R1,
    },
    {
      id: "office",
      text: "Set the Back Office PC to 192.168.1.11 255.255.255.0 with gateway 192.168.1.1.",
      done: () => office.ip === OFFICE && office.mask === MASK && office.gateway === R1,
    },
    {
      id: "ping-router",
      text: "From each PC, ping the router at 192.168.1.1.",
      done: () => register.stack.repliesFrom.has(R1) && office.stack.repliesFrom.has(R1),
    },
    {
      id: "ping-pcs",
      text: "Ping between the two PCs to prove they can reach each other.",
      done: () => register.stack.repliesFrom.has(OFFICE) || office.stack.repliesFrom.has(REGISTER),
    },
    { text: "Do not restock the back cooler." },
  ];
  const scenario: Scenario = {
    net,
    layout,
    tasks,
    incantations: CORNER_STORE_INCANTATIONS,
    start: r1,
    workOrder: {
      number: "0001",
      client: "Quik-Stop Forever",
      place: "Corner of Elm and Elm, Static Springs. Owner: Mrs. Finch.",
      notes: cabled
        ? "The router, the switch and both PCs are already cabled. Nothing is configured."
        : "The PCs' cables are run to the rack in the back office, but nothing is plugged in or configured.",
      hint: "On a PC: ipconfig 192.168.1.10 255.255.255.0 192.168.1.1",
    },
  };
  return { ...scenario, r1, s1, register, office };
}
