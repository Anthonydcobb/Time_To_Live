import { mkdir, writeFile } from "node:fs/promises";
import { configureDevice, executeDeviceCommand } from "./pt-adapter.mjs";

const scenarios = [];
const wait = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));
const command = async (device, line, mode = "enable") => {
  const response = await executeDeviceCommand(device, line, mode);
  return response.result ?? response;
};
const configure = (device, commands) => configureDevice(device, commands);
const text = (result) => String(result?.output ?? "");

async function observe() {
  const pc0Ip = await command("PC0", "ipconfig", "");
  const pc1Ip = await command("PC1", "ipconfig", "");
  const pc0ToPc1 = await command("PC0", "ping 192.168.20.10", "");
  const pc1ToGateway = await command("PC1", "ping 192.168.20.1", "");
  const router = await command("Router0", "show ip interface brief");
  const trunks = await command("Switch0", "show interfaces trunk");
  return {
    pc0Address: /IPv4 Address.*192\.168\.10\.10/i.test(text(pc0Ip)),
    pc1Address: /IPv4 Address.*192\.168\.20\.10/i.test(text(pc1Ip)),
    interVlanReachable: /Reply from 192\.168\.20\.10/i.test(text(pc0ToPc1)),
    pc1GatewayReachable: /Reply from 192\.168\.20\.1/i.test(text(pc1ToGateway)),
    routerVlan10Up: /GigabitEthernet0\/0\.10\s+192\.168\.10\.1\s+YES\s+\w+\s+up\s+up/i.test(text(router)),
    routerVlan20Up: /GigabitEthernet0\/0\.20\s+192\.168\.20\.1\s+YES\s+\w+\s+up\s+up/i.test(text(router)),
    switch0TrunkUp: /Fa0\/3\s+1,10,20/i.test(text(trunks)),
    raw: { pc0Ip: text(pc0Ip), pc1Ip: text(pc1Ip), pc0ToPc1: text(pc0ToPc1), pc1ToGateway: text(pc1ToGateway), router: text(router), trunks: text(trunks) },
  };
}

async function scenario(id, description, inject, restore) {
  const before = await observe();
  await inject();
  await wait();
  const during = await observe();
  await restore();
  await wait(1200);
  const after = await observe();
  scenarios.push({ id, description, before, during, after });
  console.log(`${id}: captured and restored`);
}

await scenario(
  "router-uplink-shutdown",
  "Disable Switch0 Fa0/3, the trunk to Router0.",
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/3", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/3", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await scenario(
  "inter-switch-trunk-shutdown",
  "Disable Switch0 Fa0/1, the trunk to Switch1.",
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure("Switch0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface fastethernet 0/1", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await scenario(
  "router-vlan20-shutdown",
  "Disable Router0 Gi0/0.20, the VLAN 20 gateway.",
  () => configure("Router0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface gigabitethernet 0/0.20", mode: "global" },
    { line: "shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
  () => configure("Router0", [
    { line: "configure terminal", mode: "enable" },
    { line: "interface gigabitethernet 0/0.20", mode: "global" },
    { line: "no shutdown", mode: "" },
    { line: "end", mode: "" },
  ]),
);

await scenario(
  "pc1-wrong-gateway",
  "Give PC1 an unreachable default gateway, then restore it.",
  () => command("PC1", "ipconfig 192.168.20.10 255.255.255.0 192.168.20.254", ""),
  () => command("PC1", "ipconfig 192.168.20.10 255.255.255.0 192.168.20.1", ""),
);

await mkdir("harness/artifacts", { recursive: true });
await writeFile("harness/artifacts/pt-expanded-fault-scenarios.json", `${JSON.stringify({ capturedAt: new Date().toISOString(), scenarios }, null, 2)}\n`);
console.log("Wrote harness/artifacts/pt-expanded-fault-scenarios.json");
