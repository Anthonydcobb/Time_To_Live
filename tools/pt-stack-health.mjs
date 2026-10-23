export async function readHealth(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const health = await response.json();
    return health?.ok === true ? health : null;
  } catch {
    return null;
  }
}

export async function detectCurrentBridge({
  baseUrl,
  fetchImpl = fetch,
  firstReplacementPort = 39095,
  lastReplacementPort = 39105,
}) {
  const defaultHealth = await readHealth(baseUrl, fetchImpl);
  if (defaultHealth && Object.hasOwn(defaultHealth, "pollerConnected")) {
    return { baseUrl, health: defaultHealth };
  }

  for (let port = firstReplacementPort; port <= lastReplacementPort; port += 1) {
    const candidate = `http://127.0.0.1:${port}`;
    const health = await readHealth(candidate, fetchImpl);
    if (health && Object.hasOwn(health, "pollerConnected")) {
      return { baseUrl: candidate, health };
    }
  }

  return { baseUrl, health: defaultHealth };
}
