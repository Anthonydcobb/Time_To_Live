import { describe, expect, it } from "vitest";
import { loadTopology } from "../src/sim/topology-json";

describe("JSON topology loader", () => {
  it("builds devices, startup configuration, PC addressing, and links", () => {
    const { network, devices } = loadTopology({
      devices: [
        { name: "R1", type: "router", hostname: "R1", startupConfig: [
          "enable", "configure terminal", "interface gigabitEthernet 0/0",
          "ip address 192.168.10.1 255.255.255.0", "no shutdown", "end",
        ] },
        { name: "S1", type: "switch", hostname: "S1" },
        { name: "PC1", type: "pc", ip: "192.168.10.10/24", gateway: "192.168.10.1", ipv6: "2001:db8:10::10/64", ipv6Gateway: "2001:db8:10::1" },
      ],
      links: [
        { a: "R1 Gi0/0", b: "S1 Gi0/1" },
        { a: "PC1 Fa0", b: "S1 Fa0/1" },
      ],
    });

    expect(network.devices).toHaveLength(3);
    expect(devices.get("R1")?.hostname).toBe("R1");
    expect(devices.get("R1")?.port("Gi0/0").peer?.device.id).toBe("S1");
    expect(devices.get("PC1")).toMatchObject({ ip: 0xc0a80a0a, gateway: 0xc0a80a01 });
    expect(devices.get("PC1")).toMatchObject({ ipv6Gateway: "2001:0db8:0010:0000:0000:0000:0000:0001" });
    expect((devices.get("PC1") as any).ipv6Addresses[0]).toMatchObject({ address: "2001:0db8:0010:0000:0000:0000:0000:0010", prefix: 64 });
  });

  it("rejects duplicate devices and unknown link endpoints", () => {
    expect(() => loadTopology({ devices: [{ name: "S1", type: "switch" }, { name: "S1", type: "switch" }], links: [] })).toThrow("Duplicate device");
    expect(() => loadTopology({ devices: [{ name: "S1", type: "switch" }], links: [{ a: "S1 Gi0/1", b: "S2 Gi0/1" }] })).toThrow("unknown device");
  });
});
