// IPv4 and MAC address helpers. IPv4 addresses are stored as unsigned 32-bit numbers.

export type Ipv4 = number;

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
