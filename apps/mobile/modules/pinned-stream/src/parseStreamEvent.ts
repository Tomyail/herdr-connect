/**
 * Pure-function validation of an SSE `data:` payload into a {@link StreamEvent}.
 *
 * Extracted from the module entry point so it can be unit-tested in isolation
 * (node --test, no React Native runtime required), matching the pattern of
 * demo-contract.ts / pairing.ts.
 *
 * The daemon SSE endpoint emits one `data:` line per frame containing a JSON
 * object `{"cursor": "<string>", "online": <boolean>}`. The native module
 * forwards that string verbatim; this function parses + hand-validates it.
 *
 * Validation policy: a single malformed payload should NOT tear down the whole
 * stream — the caller is expected to `JSON.parse`, hand-check the shape, and
 * silently drop anything that does not match. The "thin signal" design of the
 * SSE channel (the client re-REST-fetches real state on every event) makes
 * dropping a bad frame strictly harmless.
 */

export interface StreamEvent {
  /** Snapshot cursor the daemon observed at the moment of the change signal. */
  readonly cursor: string;
  /** Whether the daemon's source was online at the moment of the signal. */
  readonly online: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a raw SSE `data:` payload string into a {@link StreamEvent}, or return
 * `null` if the payload is not valid (malformed JSON, wrong shape, or extra
 * junk that fails the hand-written type guard).
 *
 * Never throws — invalid input yields `null` so the caller can `continue`
 * without a try/catch wrapping the whole stream loop.
 */
export function parseStreamEvent(payload: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    typeof value.cursor !== "string" ||
    typeof value.online !== "boolean"
  ) {
    return null;
  }
  return { cursor: value.cursor, online: value.online };
}
