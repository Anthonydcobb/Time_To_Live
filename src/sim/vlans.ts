// VLAN facts and VLAN lists the way IOS reads and writes them ("10,20,30-35").
// No imports, so devices and the command table can both use it.

/** Parses "10,20,30-35" into VLAN IDs. Returns null if any part isn't a VLAN between 1 and 4094. */
export function parseVlanList(text: string): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const low = Number(m[1]);
    const high = m[2] === undefined ? low : Number(m[2]);
    if (low < 1 || high > 4094 || high < low) return null;
    for (let v = low; v <= high; v++) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Writes VLAN IDs back in IOS's compressed form: runs of three or more become ranges. */
export function formatVlanList(vlans: number[]): string {
  const sorted = [...new Set(vlans)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
    i = j + 1;
  }
  return parts.join(",");
}

/** The VLANs every Catalyst ships with. They can't be deleted or renamed. */
export const DEFAULT_VLANS: [number, string][] = [
  [1, "default"],
  [1002, "fddi-default"],
  [1003, "token-ring-default"],
  [1004, "fddinet-default"],
  [1005, "trnet-default"],
];
/** 1002 to 1005 are for FDDI and Token Ring, which a 2960 can't switch. */
export const UNSUPPORTED_VLANS = new Set([1002, 1003, 1004, 1005]);
export const isDefaultVlan = (id: number) => id === 1 || UNSUPPORTED_VLANS.has(id);
/** VLANs above 1005 are the extended range, which VTP server mode won't create. */
export const MAX_NORMAL_VLAN = 1005;

export function defaultVlanName(id: number): string {
  return `VLAN${String(id).padStart(4, "0")}`;
}

export function sviVlan(name: string): number | null {
  const m = /^Vlan(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** "GigabitEthernet0/0.10" → ["GigabitEthernet0/0", 10]. */
export function splitSubinterface(name: string): [string, number] | null {
  const m = /^(.+)\.(\d+)$/.exec(name);
  return m ? [m[1], Number(m[2])] : null;
}

