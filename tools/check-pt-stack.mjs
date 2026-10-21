const baseUrl = process.env.PT_BRIDGE_URL ?? "http://127.0.0.1:39094";

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
    error: error instanceof Error ? error.message : String(error),
    next: "Run tools/start-pt-stack.ps1 after Packet Tracer and its ExApp are available.",
  }, null, 2));
  process.exitCode = 1;
}
