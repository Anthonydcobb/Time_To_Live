import { runCommand } from "./pt-bridge-client.mjs";

export const DEFAULT_SNAPSHOT_COMMANDS = [
  "show version",
  "show ip interface brief",
  "show vlan brief",
  "show spanning-tree",
  "show mac address-table",
  "show cdp neighbors",
];

export async function executeDeviceCommand(device, line, mode = "enable") {
  return runCommand({ device, line, mode });
}

export async function discoverDevices() {
  const response = await executeDeviceCommand("__network__", "list devices");
  if (response.result?.status !== "STATUS_OK") return { response, devices: [] };
  const devices = response.result.output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, type, model, serialNumber] = line.split("|");
      return { name, type, model, serialNumber };
    });
  return { response, devices };
}

export async function discoverLinks() {
  const response = await executeDeviceCommand("__network__", "list links");
  if (response.result?.status !== "STATUS_OK") return { response, links: [] };
  const links = response.result.output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [device, port, remotePort, connectionType, portUp] = line.split("|");
      return { device, port, remotePort, connectionType, portUp: portUp === "true" };
    });
  return { response, links };
}

export async function configureDevice(device, commands) {
  const results = [];
  for (const command of commands) {
    const line = typeof command === "string" ? command : command.line;
    const mode = typeof command === "string" ? "enable" : (command.mode ?? "enable");
    results.push({
      command: line,
      mode,
      result: await executeDeviceCommand(device, line, mode),
    });
  }
  return results;
}

export async function captureDeviceSnapshot(
  device,
  commands = DEFAULT_SNAPSHOT_COMMANDS,
) {
  const results = [];
  for (const command of commands) {
    results.push({
      command,
      result: await executeDeviceCommand(device, command, "enable"),
    });
  }
  return {
    device,
    capturedAt: new Date().toISOString(),
    commands: results,
  };
}
