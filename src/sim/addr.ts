// IPv4 and MAC address helpers. IPv4 addresses are stored as unsigned 32-bit numbers.

export type Ipv4 = number;
export type Ipv6 = string;

/** Parses and normalizes a basic IPv6 address (eight hex groups with :: compression). */
export function parseIpv6(text: string): Ipv6 | null {
  const raw = text.trim().toLowerCase();
  if (!raw || raw.includes(".")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((g) => g.padStart(4, "0")).join(":");
}

export function parseIpv6Prefix(text: string): { address: Ipv6; prefix: number } | null {
  const slash = text.lastIndexOf("/");
  if (slash < 1) return null;
  const prefix = Number(text.slice(slash + 1));
  const address = parseIpv6(text.slice(0, slash));
  return address !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128 ? { address, prefix } : null;
}

export function formatIpv6(address: Ipv6): string {
  return parseIpv6(address) ?? address;
}

export function ipv6InPrefix(address: Ipv6, prefixAddress: Ipv6, prefix: number): boolean {
  const a = BigInt(`0x${address.replaceAll(":", "")}`);
  const p = BigInt(`0x${prefixAddress.replaceAll(":", "")}`);
  if (prefix === 0) return true;
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (a & mask) === (p & mask);
}

export function parseIpv4(text: string): Ipv4 | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

export function formatIpv4(ip: Ipv4): string {
  return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".");
}

/** Returns the prefix length for a contiguous mask, or null if the mask has holes. */
export function maskToPrefix(mask: Ipv4): number | null {
  const inverted = ~mask >>> 0;
  if ((inverted & (inverted + 1)) !== 0) return null;
  let bits = 0;
  for (let m = mask; m !== 0; m = (m << 1) >>> 0) bits++;
  return bits;
}

export function prefixToMask(prefix: number): Ipv4 {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function networkOf(ip: Ipv4, mask: Ipv4): Ipv4 {
  return (ip & mask) >>> 0;
}

export function broadcastOf(ip: Ipv4, mask: Ipv4): Ipv4 {
  return (networkOf(ip, mask) | (~mask >>> 0)) >>> 0;
}

export function sameSubnet(a: Ipv4, b: Ipv4, mask: Ipv4): boolean {
  return networkOf(a, mask) === networkOf(b, mask);
}

export const BROADCAST_IP: Ipv4 = 0xffffffff;

export type Mac = string; // 12 lowercase hex digits, e.g. "00e0f7a1b2c3"

export const BROADCAST_MAC: Mac = "ffffffffffff";

/** Cisco dotted format: 00e0.f7a1.b2c3 */
export function formatMacCisco(mac: Mac): string {
  return `${mac.slice(0, 4)}.${mac.slice(4, 8)}.${mac.slice(8, 12)}`;
}

/** Windows format: 00-E0-F7-A1-B2-C3 */
export function formatMacWindows(mac: Mac): string {
  return mac.toUpperCase().match(/../g)!.join("-");
}

let macCounter = 0x0a0000;

/** Deterministic MAC allocator. The OUI is made up for Cryptis Systems. */
export function nextMac(oui = "00d0c7"): Mac {
  macCounter = (macCounter + 1) & 0xffffff;
  return oui + macCounter.toString(16).padStart(6, "0");
}

export function resetMacAllocator(): void {
  macCounter = 0x0a0000;
}
