import type { Port } from "./network";
import type { Switch } from "./devices/switch";

/** Switches in this VLAN's currently valid STP component. Root-inconsistent links are cut. */
export function reachableSwitches(start: Switch, vlan: number, blockedPort?: Port): Switch[] {
  const seen = new Set<Switch>([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const port of current.ports) {
      if (current === start && port === blockedPort) continue;
      const peerPort = port.peer;
      const peerDevice = peerPort?.device;
      if (!peerPort || peerDevice?.kind !== "switch" || !port.protocolUp || !peerPort.protocolUp) continue;
      const peer = peerDevice as Switch;
      if (!current.vlansOn(port).includes(vlan) || !peer.vlansOn(peerPort).includes(vlan)) continue;
      if (current.isRootInconsistent(port, vlan) || peer.isRootInconsistent(peerPort, vlan)) continue;
      if (!seen.has(peer)) {
        seen.add(peer);
        queue.push(peer);
      }
    }
  }
  return [...seen];
}

/** PVST root election shared by operational roles and all spanning-tree views. */
export function electedRoot(start: Switch, vlan: number): Switch {
  return reachableSwitches(start, vlan).sort((a, b) => a.bridgeId(vlan).localeCompare(b.bridgeId(vlan)))[0] ?? start;
}
