const baseUrl = process.env.PT_BRIDGE_URL ?? "http://127.0.0.1:39094";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(5000) });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function health() {
  return request("/health");
}

export async function runCommand({ device, line, mode = "enable", timeoutMs = 15000 }) {
  const queued = await request("/v1/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device, line, mode }),
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await request(`/v1/result/${encodeURIComponent(queued.id)}`);
    } catch (error) {
      if (!String(error).includes("404:")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for Packet Tracer result ${queued.id}`);
}
