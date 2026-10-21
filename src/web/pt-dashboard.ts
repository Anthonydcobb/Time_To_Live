type Device = { name: string; type: string; model: string; serialNumber?: string };
type Link = { device: string; port: string; remotePort?: string; connectionType: string; portUp: boolean };

const urlInput = document.querySelector<HTMLInputElement>("#bridge-url")!;
const bridgeStatus = document.querySelector<HTMLElement>("#bridge-status")!;
const deviceCount = document.querySelector<HTMLElement>("#device-count")!;
const linkCount = document.querySelector<HTMLElement>("#link-count")!;
const lastRefresh = document.querySelector<HTMLElement>("#last-refresh")!;
const devicesEl = document.querySelector<HTMLElement>("#devices")!;
const linksEl = document.querySelector<HTMLElement>("#links")!;
const deviceSelect = document.querySelector<HTMLSelectElement>("#device-select")!;
const output = document.querySelector<HTMLElement>("#output")!;
const topologyMap = document.querySelector<HTMLElement>("#topology-map")!;
const historyEl = document.querySelector<HTMLElement>("#history")!;
const healthResults = document.querySelector<HTMLElement>("#health-results")!;
const commandHistory: { device: string; command: string; status: string; at: string }[] = [];
let liveDevices: Device[] = [];
let refreshInFlight = false;
const commandOutputs = new Map<string, string>();

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function bridge(path: string, options?: RequestInit): Promise<any> {
  const response = await fetchWithTimeout(`${urlInput.value.replace(/\/$/, "")}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function renderDevices(devices: Device[]): void {
  const operational = devices.filter((device) => device.type !== "POWER_DISTRIBUTION_DEVICE");
  deviceCount.textContent = String(operational.length);
  devicesEl.replaceChildren();
  deviceSelect.replaceChildren();
  for (const device of operational) {
    const row = document.createElement("div"); row.className = "device";
    row.innerHTML = `<span>${device.name}<br><small class="type">${device.model} · ${device.serialNumber ?? "no serial"}</small></span><span class="up">ONLINE</span>`;
    devicesEl.append(row);
    if (device.type === "SWITCH" || device.type === "ROUTER" || device.type === "PC") deviceSelect.add(new Option(device.name, device.name));
  }
}

function renderLinks(links: Link[]): void {
  linkCount.textContent = String(links.length);
  linksEl.replaceChildren();
  for (const link of links) {
    const row = document.createElement("div"); row.className = "link";
    const state = link.portUp ? "UP" : "DOWN";
    row.innerHTML = `<span>${link.device} / ${link.port}<br><small class="type">${link.connectionType}</small></span><span class="${link.portUp ? "up" : "down"}">${state}</span>`;
    linksEl.append(row);
  }
}

function renderTopology(devices: Device[], links: Link[]): void {
  topologyMap.replaceChildren();
  const deviceByName = new Map(devices.map((device) => [device.name, device]));
  const operational = devices.filter((device) => device.type !== "POWER_DISTRIBUTION_DEVICE");
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]!));
  const node = (device: Device, x: number, y: number) => `<g><rect x="${x - 82}" y="${y - 27}" width="164" height="54" rx="8" class="svg-node"/><text x="${x}" y="${y - 2}" class="svg-name">${esc(device.name)}</text><text x="${x}" y="${y + 16}" class="svg-type">${esc(device.type)} · ${esc(device.model)}</text></g>`;
  const portUp = (device: string, port: string) => links.some((link) => link.device === device && link.port === port && link.portUp);
  const edge = (a: Device | undefined, aPort: string, b: Device | undefined, bPort: string, x1: number, y1: number, x2: number, y2: number) => {
    if (!a || !b) return "";
    const up = portUp(a.name, aPort) || portUp(b.name, bPort);
    const label = `${aPort} ↔ ${bPort}`;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="svg-line ${up ? "" : "svg-line-down"}"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" class="svg-port">${label}</text>`;
  };

  // Packet Tracer's IPC link object exposes the local endpoint but not the
  // remote device. For the supported expanded lab, use the intentional port
  // mapping instead of guessing from cable type.
  const expanded = deviceByName.has("Switch0") && deviceByName.has("Switch1") && deviceByName.has("PC0") && deviceByName.has("PC1") && deviceByName.has("Router0");
  if (expanded) {
    const s0 = deviceByName.get("Switch0"); const s1 = deviceByName.get("Switch1");
    const pc0 = deviceByName.get("PC0"); const pc1 = deviceByName.get("PC1"); const router = deviceByName.get("Router0");
    const lines = [
      edge(s0, "0/1", s1, "0/1", 462, 70, 598, 70),
      edge(s0, "0/2", pc0, "0", 360, 98, 160, 205),
      edge(s0, "0/3", router, "0/0", 380, 98, 380, 205),
      edge(s1, "0/2", pc1, "0", 680, 98, 680, 205),
    ].join("");
    topologyMap.innerHTML = `<svg viewBox="0 0 760 300" role="img" aria-label="Live Packet Tracer topology"><text x="380" y="20" class="svg-caption">LIVE PACKET TRACER TOPOLOGY · EXPANDED LAB</text>${lines}${node(s0!, 380, 70)}${node(s1!, 680, 70)}${node(pc0!, 160, 235)}${node(router!, 380, 235)}${node(pc1!, 680, 235)}</svg>`;
    return;
  }

  // Baseline lab fallback: show the known two-switch/PC layout when those
  // devices are present; otherwise list the discovered devices without
  // drawing potentially false edges.
  if (deviceByName.has("Switch0") && deviceByName.has("Switch1") && deviceByName.has("PC0")) {
    const s0 = deviceByName.get("Switch0"); const s1 = deviceByName.get("Switch1"); const pc0 = deviceByName.get("PC0");
    const lines = [edge(s0, "0/1", s1, "0/1", 462, 70, 598, 70), edge(s0, "0/2", pc0, "0", 380, 98, 380, 205)].join("");
    topologyMap.innerHTML = `<svg viewBox="0 0 760 300" role="img" aria-label="Live Packet Tracer topology"><text x="380" y="20" class="svg-caption">LIVE PACKET TRACER TOPOLOGY</text>${lines}${node(s0!, 380, 70)}${node(s1!, 680, 70)}${node(pc0!, 380, 235)}</svg>`;
    return;
  }
  if (operational.length) topologyMap.innerHTML = `<p class="muted">Devices discovered; endpoint pairing is not available for this topology.</p>`;
  else topologyMap.innerHTML = `<p class="muted">No live devices discovered.</p>`;
}

function addHistory(device: string, command: string, status: string): void {
  commandHistory.unshift({ device, command, status, at: new Date().toLocaleTimeString() });
  commandHistory.splice(10);
  historyEl.replaceChildren();
  for (const item of commandHistory) {
    const row = document.createElement("div"); row.className = "history-row";
    row.innerHTML = `<span>${item.at}</span><span class="history-command">${item.device} · ${item.command}</span><span class="history-status">${item.status}</span>`;
    historyEl.append(row);
  }
}

async function refresh(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const health = await bridge("/health");
    bridgeStatus.textContent = `ONLINE · ${health.pending} queued`;
    bridgeStatus.className = "up";
    const deviceResult = await run("__network__", "list devices", "enable");
    const devices: Device[] = String(deviceResult.output ?? "").split("\n").filter(Boolean).map((line) => {
      const [name, type, model, serialNumber] = line.split("|"); return { name, type, model, serialNumber };
    });
    liveDevices = devices;
    renderDevices(devices);
    const linkResult = await run("__network__", "list links", "enable");
    const links: Link[] = String(linkResult.output ?? "").split("\n").filter(Boolean).map((line) => {
      const [device, port, remotePort, connectionType, portUp] = line.split("|");
      return { device, port, remotePort, connectionType, portUp: portUp === "true" };
    });
    renderLinks(links);
    renderTopology(devices, links);
    lastRefresh.textContent = new Date().toLocaleTimeString();
  } catch (error) {
    bridgeStatus.textContent = "OFFLINE"; bridgeStatus.className = "down";
    liveDevices = [];
    deviceCount.textContent = "0";
    linkCount.textContent = "0";
    devicesEl.innerHTML = `<p class="muted">Bridge offline.</p>`;
    linksEl.innerHTML = `<p class="muted">Bridge offline.</p>`;
    topologyMap.innerHTML = `<p class="muted">Bridge offline.</p>`;
    output.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    refreshInFlight = false;
  }
}

async function run(device: string, line: string, mode = "enable"): Promise<any> {
  const queued = await bridge("/v1/command", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ device, line, mode }) });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(`${urlInput.value.replace(/\/$/, "")}/v1/result/${encodeURIComponent(queued.id)}`);
    if (response.ok) {
      const body = await response.json();
      const result = body.result ?? {};
      commandOutputs.set(line, String(result.output ?? ""));
      addHistory(device, line, result.status ?? "OK");
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${device} / ${line}`);
}

function showHealth(results: { label: string; ok: boolean; detail: string }[]): void {
  healthResults.replaceChildren();
  for (const result of results) {
    const row = document.createElement("div"); row.className = "health-row";
    row.innerHTML = `<span>${result.label}<small class="type"> · ${result.detail}</small></span><strong class="${result.ok ? "health-pass" : "health-fail"}">${result.ok ? "PASS" : "FAIL"}</strong>`;
    const evidence = !result.ok ? commandOutputs.get(result.detail) : undefined;
    if (evidence) {
      const details = document.createElement("details"); details.className = "health-evidence";
      const summary = document.createElement("summary"); summary.textContent = "Show command output";
      const pre = document.createElement("pre"); pre.textContent = evidence;
      details.append(summary, pre);
      row.firstElementChild?.append(details);
    }
    healthResults.append(row);
  }
}

async function healthCheck(): Promise<void> {
  healthResults.innerHTML = `<p class="muted">Running live checks…</p>`;
  try {
    const text = (result: any) => String(result?.output ?? "");
    const expanded = liveDevices.some((device) => device.name === "Router0") && liveDevices.some((device) => device.name === "PC1");
    if (expanded) {
      const pc0Ip = await run("PC0", "ipconfig", "");
      const pc1Ip = await run("PC1", "ipconfig", "");
      const interVlanPing = await run("PC0", "ping 192.168.20.10", "");
      const routerInterfaces = await run("Router0", "show ip interface brief");
      const sshStatus = await run("Router0", "show ssh");
      const routerConfig = await run("Router0", "show running-config");
      const routingProtocols = await run("Router0", "show ip protocols");
      const eigrpInterfaces = await run("Router0", "show ip eigrp interfaces");
      const eigrpTopology = await run("Router0", "show ip eigrp topology");
      const ospfInterfaces = await run("Router0", "show ip ospf interface");
      const ipRoutes = await run("Router0", "show ip route");
      const dnsHosts = await run("Router0", "show hosts");
      const ipv6AccessLists = await run("Router0", "show ipv6 access-list");
      const ipv6Interfaces = await run("Router0", "show ipv6 interface brief");
      const ipv6Routes = await run("Router0", "show ipv6 route");
      const ipv6Neighbors = await run("Router0", "show ipv6 neighbors");
      const ipv6Ospf = await run("Router0", "show ipv6 ospf neighbor");
      const ipv6OspfInterfaces = await run("Router0", "show ipv6 ospf interface");
      const natTranslations = await run("Router0", "show ip nat translations");
      const natStatistics = await run("Router0", "show ip nat statistics");
      const snmpStatus = await run("Router0", "show snmp");
      const standby = await run("Router0", "show standby");
      const vrrp = await run("Router0", "show vrrp");
      const glbp = await run("Router0", "show glbp");
      const ntpStatus = await run("Router0", "show ntp status");
      const logging = await run("Router0", "show logging");
      const lldpStatus = await run("Router0", "show lldp");
      const lldpNeighbors = await run("Router0", "show lldp neighbors");
      const trunk0 = await run("Switch0", "show interfaces trunk");
      const trunk1 = await run("Switch1", "show interfaces trunk");
      const dhcpSnoopingStatistics = await run("Switch0", "show ip dhcp snooping statistics");
      const arpInspectionStatistics = await run("Switch0", "show ip arp inspection statistics");
      const pc0Text = text(pc0Ip); const pc1Text = text(pc1Ip);
      const routerText = text(routerInterfaces); const sshText = text(sshStatus); const configText = text(routerConfig); const trunks = `${text(trunk0)}\n${text(trunk1)}`;
      const ipv6InterfaceText = text(ipv6Interfaces); const ipv6RouteText = text(ipv6Routes); const ipv6NeighborText = text(ipv6Neighbors);
      const ipv6OspfText = text(ipv6Ospf); const ipv6OspfInterfaceText = text(ipv6OspfInterfaces);
      const natText = text(natTranslations); const natStatisticsText = text(natStatistics); const snmpText = text(snmpStatus); const standbyText = text(standby); const vrrpText = text(vrrp); const glbpText = text(glbp); const ntpText = text(ntpStatus); const loggingText = text(logging); const lldpText = text(lldpStatus); const lldpNeighborText = text(lldpNeighbors);
      const dhcpSnoopingStatisticsText = text(dhcpSnoopingStatistics); const arpInspectionStatisticsText = text(arpInspectionStatistics);
      const routingText = text(routingProtocols); const eigrpInterfaceText = text(eigrpInterfaces); const eigrpTopologyText = text(eigrpTopology); const ospfInterfaceText = text(ospfInterfaces); const routeText = text(ipRoutes); const dnsText = text(dnsHosts); const ipv6AclText = text(ipv6AccessLists);
      const ipv6Configured = /[0-9a-f]{1,4}:[0-9a-f:]+\/\d+/i.test(ipv6InterfaceText);
      const ipv6Checks = ipv6Configured ? [
        { label: "Router IPv6 interface", ok: /[0-9a-f]{1,4}:[0-9a-f:]+\/\d+.*up\s+up/i.test(ipv6InterfaceText), detail: "show ipv6 interface brief" },
        { label: "IPv6 routing table", ok: /(?:^|\n)[CLSOD]\s+[0-9a-f:]+\/\d+/i.test(ipv6RouteText), detail: "show ipv6 route" },
        { label: "IPv6 neighbor discovery", ok: /(?:^|\n)[0-9a-f]{1,4}:[0-9a-f:]+\s+\d+\s+[0-9a-f.]+\s+REACH/i.test(ipv6NeighborText), detail: "show ipv6 neighbors" },
        { label: "IPv6 OSPFv3 adjacency", ok: /FULL/i.test(ipv6OspfText), detail: "show ipv6 ospf neighbor" },
        { label: "IPv6 OSPFv3 interfaces", ok: /OSPFv3 process/i.test(ipv6OspfInterfaceText) && /Neighbor count/i.test(ipv6OspfInterfaceText), detail: "show ipv6 ospf interface" },
      ] : [];
      const optionalChecks = [
        /Pro Inside global/i.test(natText) ? { label: "NAT translation table", ok: natText.split("\n").slice(2).some((line: string) => /^(?:---|icmp)\s+/i.test(line)), detail: "show ip nat translations" } : null,
        /Total active translations:/i.test(natStatisticsText) ? { label: "NAT operational statistics", ok: /Inside interfaces:/i.test(natStatisticsText) && /Outside interfaces:/i.test(natStatisticsText), detail: "show ip nat statistics" } : null,
        /SNMP communities configured:\s*[1-9]/i.test(snmpText) ? { label: "SNMP community configured", ok: /SNMP packets input/i.test(snmpText), detail: "show snmp" } : null,
        /Virtual IP address/i.test(standbyText) ? { label: "HSRP gateway state", ok: /State is (Active|Standby)/i.test(standbyText), detail: "show standby" } : null,
        /Virtual IP address/i.test(vrrpText) ? { label: "VRRP gateway state", ok: /State is (Master|Backup)/i.test(vrrpText), detail: "show vrrp" } : null,
        /Virtual IP address/i.test(glbpText) ? { label: "GLBP gateway state", ok: /State is (Active|Standby)/i.test(glbpText), detail: "show glbp" } : null,
        /Clock is synchronized/i.test(ntpText) ? { label: "NTP synchronization", ok: true, detail: "show ntp status" } : null,
        /Logging to (?!none)/i.test(loggingText) ? { label: "Syslog destination", ok: /Syslog logging: enabled/i.test(loggingText), detail: "show logging" } : null,
        /Routing Protocol is "(?:ospf|eigrp)/i.test(routingText) ? { label: "Dynamic routing protocol", ok: /Routing Protocol is "(?:ospf|eigrp)/i.test(routingText), detail: "show ip protocols" } : null,
        /EIGRP-IPv4 Interfaces for AS/i.test(eigrpInterfaceText) ? { label: "EIGRP interfaces", ok: !/EIGRP is not configured/i.test(eigrpInterfaceText), detail: "show ip eigrp interfaces" } : null,
        /EIGRP-IPv4 Topology Table for AS/i.test(eigrpTopologyText) ? { label: "EIGRP topology", ok: !/EIGRP is not configured/i.test(eigrpTopologyText), detail: "show ip eigrp topology" } : null,
        /Designated Router \(ID\)/i.test(ospfInterfaceText) ? { label: "OSPF DR/BDR state", ok: /State (DR|BDR|DROTHER)/i.test(ospfInterfaceText) && /Designated Router \(ID\)/i.test(ospfInterfaceText), detail: "show ip ospf interface" } : null,
        /Global LLDP information/i.test(lldpText) ? { label: "LLDP neighbor discovery", ok: /Device ID\s+Local Intf/i.test(lldpNeighborText) && !/not enabled/i.test(lldpNeighborText), detail: "show lldp neighbors" } : null,
        /Name\/address lookup uses|Host\s+Address/i.test(dnsText) && !/No hosts configured/i.test(dnsText) ? { label: "DNS host records", ok: /Host\s+Address/i.test(dnsText), detail: "show hosts" } : null,
        /default-information originate|Area ranges:/i.test(routingText + configText) ? { label: "OSPF edge policy", ok: /default-information originate|Area ranges:/i.test(configText + routingText), detail: "default route / area summary" } : null,
        /IPv6 access list/i.test(ipv6AclText) ? { label: "IPv6 ACL attachment", ok: /ipv6 traffic-filter .* (in|out)/i.test(configText), detail: "show ipv6 access-list" } : null,
        /0\.0\.0\.0\/0/i.test(routeText) ? { label: "Default route present", ok: /(?:^|\n)O\*?\s+.*0\.0\.0\.0\/0|(?:^|\n)S\*\s+0\.0\.0\.0\/0/i.test(routeText), detail: "show ip route" } : null,
        /DHCP snooping statistics:/i.test(dhcpSnoopingStatisticsText) ? { label: "DHCP snooping counters", ok: /Packets processed:/i.test(dhcpSnoopingStatisticsText), detail: "show ip dhcp snooping statistics" } : null,
        /Dynamic ARP inspection statistics:/i.test(arpInspectionStatisticsText) ? { label: "DAI counters", ok: /ARP packets inspected:/i.test(arpInspectionStatisticsText), detail: "show ip arp inspection statistics" } : null,
      ].filter((check): check is { label: string; ok: boolean; detail: string } => check !== null);
      showHealth([
        { label: "PC0 IPv4 address", ok: /IPv4 Address.*192\.168\.10\.10/i.test(pc0Text), detail: "192.168.10.10 / VLAN 10" },
        { label: "PC1 IPv4 address", ok: /IPv4 Address.*192\.168\.20\.10/i.test(pc1Text), detail: "192.168.20.10 / VLAN 20" },
        { label: "Router VLAN 10 gateway", ok: /GigabitEthernet0\/0\.10\s+192\.168\.10\.1\s+YES\s+\w+\s+up\s+up/i.test(routerText), detail: "192.168.10.1 up/up" },
        { label: "Router VLAN 20 gateway", ok: /GigabitEthernet0\/0\.20\s+192\.168\.20\.1\s+YES\s+\w+\s+up\s+up/i.test(routerText), detail: "192.168.20.1 up/up" },
        { label: "Inter-VLAN connectivity", ok: /Reply from 192\.168\.20\.10/i.test(text(interVlanPing)), detail: "PC0 → PC1" },
        { label: "Trunks forwarding", ok: /Fa0\/1\s+1,10,20/i.test(trunks) && /Fa0\/3\s+1,10,20/i.test(trunks), detail: "VLANs 10/20" },
        { label: "Router SSH service", ok: /SSH Enabled/i.test(sshText), detail: "show ssh" },
        { label: "VTY local authentication", ok: (/login local/i.test(configText) || /aaa authentication login default local/i.test(configText)) && /transport input ssh/i.test(configText), detail: "line vty 0 4 / AAA" },
        ...ipv6Checks,
        ...optionalChecks,
      ]);
      return;
    }
    const ipconfig = await run("PC0", "ipconfig", "");
    const ping = await run("PC0", "ping 192.168.10.1", "");
    const interfaces = await run("Switch0", "show ip interface brief");
    const macs = await run("Switch0", "show mac address-table");
    const cdp = await run("Switch0", "show cdp neighbors");
    const interfaceText = text(interfaces); const macText = text(macs);
    showHealth([
      { label: "PC0 IPv4 address", ok: /IPv4 Address.*192\.168\.10\.10/i.test(text(ipconfig)), detail: "192.168.10.10" },
      { label: "PC0 reaches Switch0", ok: /Reply from 192\.168\.10\.1/i.test(text(ping)), detail: "ping 192.168.10.1" },
      { label: "Switch0 management SVI", ok: /Vlan1\s+192\.168\.10\.1\s+YES\s+\w+\s+up\s+up/i.test(interfaceText), detail: "Vlan1 up/up" },
      { label: "PC0 learned on VLAN 1 access port", ok: /\b1\s+00e0\.a379\.2d27\s+\w+\s+Fa0\/2/i.test(macText), detail: "VLAN 1 / Fa0/2" },
      { label: "Switch1 neighbor present", ok: /Switch\s+Fas?\s*0\/1/i.test(text(cdp)), detail: "CDP via Fa0/1" },
    ]);
  } catch (error) {
    healthResults.innerHTML = `<p class="health-fail">Health check failed: ${error instanceof Error ? error.message : String(error)}</p>`;
  }
}

document.querySelector("#refresh")!.addEventListener("click", () => void refresh());
document.querySelector("#health-check")!.addEventListener("click", () => void healthCheck());
document.querySelector<HTMLFormElement>("#command-form")!.addEventListener("submit", async (event) => {
  event.preventDefault(); output.textContent = "Running…";
  try {
    const mode = document.querySelector<HTMLSelectElement>("#mode-select")!.value;
    const result = await run(deviceSelect.value, document.querySelector<HTMLInputElement>("#command")!.value, mode);
    output.textContent = result.output ?? JSON.stringify(result, null, 2);
  }
  catch (error) { output.textContent = error instanceof Error ? error.message : String(error); }
});
void refresh();
window.setInterval(() => void refresh(), 10000);
