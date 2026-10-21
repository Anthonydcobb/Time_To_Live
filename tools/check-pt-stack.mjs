let baseUrl = process.env.PT_BRIDGE_URL ?? "http://127.0.0.1:39094";
const dashboardPort = process.env.PT_TTL_DASHBOARD_PORT ?? "5173";

async function readHealth(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const health = await response.json();
    return health?.ok === true ? health : null;
  } catch {
    return null;
  }
}

if (!process.env.PT_BRIDGE_URL) {
  const defaultHealth = await readHealth(baseUrl);
  if (defaultHealth && Object.hasOwn(defaultHealth, "pollerConnected") === false) {
    for (let port = 39095; port <= 39105; port += 1) {
      const candidate = `http://127.0.0.1:${port}`;
      const health = await readHealth(candidate);
      if (health && Object.hasOwn(health, "pollerConnected")) {
        baseUrl = candidate;
        break;
      }
    }
  }
}

try {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
  const health = await response.json();
  if (!response.ok || health.ok !== true) throw new Error(health.error ?? `HTTP ${response.status}`);

  const poller = health.pollerConnected === true
    ? "connected"
    : health.pollerConnected === false
      ? "not-connected"
      : "legacy-unknown";
  const ready = poller === "connected";
  console.log(JSON.stringify({
    ok: true,
    ready,
    bridge: baseUrl,
    dashboard: `http://localhost:${dashboardPort}/pt-dashboard.html?bridge=${encodeURIComponent(baseUrl)}`,
    pending: health.pending ?? 0,
    results: health.results ?? 0,
    poller,
    lastPollAt: health.lastPollAt ?? null,
    next: ready
      ? "Packet Tracer commands can be submitted."
      : poller === "legacy-unknown"
        ? "Run tools/start-pt-stack.ps1 to select a current bridge port, then open the dashboard URL it prints."
        : "Open Packet Tracer and start the Java ExApp bridge; confirm its window reports polling the bridge.",
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    ready: false,
    bridge: baseUrl,
    dashboard: `http://localhost:${dashboardPort}/pt-dashboard.html?bridge=${encodeURIComponent(baseUrl)}`,
    error: error instanceof Error ? error.message : String(error),
    next: "Run tools/start-pt-stack.ps1 after Packet Tracer and its ExApp are available.",
  }, null, 2));
  process.exitCode = 1;
}
