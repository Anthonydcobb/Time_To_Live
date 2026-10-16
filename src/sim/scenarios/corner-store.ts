import { Pc } from "../devices/pc";
import { Router } from "../devices/router";
import { Switch } from "../devices/switch";
import { Network } from "../network";

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
  return { net, r1, s1, register, office, layout };
}
