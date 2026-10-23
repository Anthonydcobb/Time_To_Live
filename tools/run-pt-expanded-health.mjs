import { executeDeviceCommand } from "./pt-adapter.mjs";

async function run(device, line, mode = "enable") {
  const response = await executeDeviceCommand(device, line, mode);
  console.log(`--- ${device} / ${line} ---`);
  console.log(response.result?.output ?? response.output ?? JSON.stringify(response));
}

await run("PC0", "ipconfig", "");
await run("PC1", "ipconfig", "");
await run("PC0", "ping 192.168.20.10", "");
await run("Router0", "show ip interface brief");
await run("Switch0", "show interfaces trunk");
await run("Switch1", "show interfaces trunk");
