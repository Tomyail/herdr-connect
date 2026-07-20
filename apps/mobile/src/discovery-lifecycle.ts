const DISCOVERY_RETRY_BASE_MS = 1_000;
const DISCOVERY_RETRY_MAX_MS = 15_000;

export function shouldRestartDiscovery(previous: string, next: string): boolean {
  return previous !== "active" && next === "active";
}

export function discoveryRetryDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(DISCOVERY_RETRY_BASE_MS * 2 ** safeAttempt, DISCOVERY_RETRY_MAX_MS);
}
