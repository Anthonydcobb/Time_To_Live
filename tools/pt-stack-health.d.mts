export function readHealth(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown> | null>;

export function detectCurrentBridge(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  firstReplacementPort?: number;
  lastReplacementPort?: number;
}): Promise<{
  baseUrl: string;
  health: Record<string, unknown> | null;
}>;
