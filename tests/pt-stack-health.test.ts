import { describe, expect, it } from "vitest";
import { detectCurrentBridge } from "../tools/pt-stack-health.mjs";

function response(body: unknown, ok = true) {
  return { ok, async json() { return body; } };
}

describe("Packet Tracer bridge detection", () => {
  it("scans replacement ports when the default bridge is unreachable", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes(":39095/")) return response({ ok: true, pollerConnected: true, results: 4782 }) as Response;
      throw new Error("connection refused");
    };

    await expect(detectCurrentBridge({
      baseUrl: "http://127.0.0.1:39094",
      fetchImpl,
      firstReplacementPort: 39095,
      lastReplacementPort: 39096,
    })).resolves.toEqual({
      baseUrl: "http://127.0.0.1:39095",
      health: { ok: true, pollerConnected: true, results: 4782 },
    });
    expect(calls).toEqual([
      "http://127.0.0.1:39094/health",
      "http://127.0.0.1:39095/health",
    ]);
  });
});
