/**
 * Public entry point for the pinned-stream module.
 *
 * On iOS, opens a long-lived HTTPS Server-Sent Events stream pinned to the
 * supplied certificate fingerprint via the native `PinnedStreamModule`. On
 * every other platform (Android, web), throws {@link PinnedStreamError} with
 * code `unsupported_platform` without touching the network.
 *
 * Returns a {@link PinnedStreamHandle} whose `onEvent` / `onError` / `onClose`
 * methods subscribe to the corresponding native events and return unsubscribe
 * functions. `stop()` tears down the stream. One module instance supports at
 * most one active stream; calling `startStream` again replaces the previous one.
 *
 * Event payloads are raw SSE `data:` strings; this module parses them with
 * {@link parseStreamEvent} and drops malformed frames silently.
 */

import { Platform } from "react-native";

import {
  PinnedStreamError,
  type PinnedStreamErrorCode,
} from "./src/PinnedStream.types";
import { parseStreamEvent, type StreamEvent } from "./src/parseStreamEvent";

export type { StreamEvent } from "./src/parseStreamEvent";
export { parseStreamEvent } from "./src/parseStreamEvent";
export type {
  PinnedStreamErrorCode,
  PinnedStreamErrorOptions,
} from "./src/PinnedStream.types";
export { PinnedStreamError } from "./src/PinnedStream.types";

/** Handle returned by {@link startStream}. */
export interface PinnedStreamHandle {
  /**
   * Subscribe to parsed stream events. Returns an unsubscribe function.
   * Malformed native payloads are silently dropped (never delivered).
   */
  onEvent(cb: (event: StreamEvent) => void): () => void;
  /** Subscribe to stream-lifetime errors. Returns an unsubscribe function. */
  onError(cb: (error: PinnedStreamError) => void): () => void;
  /** Subscribe to clean stream close. Returns an unsubscribe function. */
  onClose(cb: () => void): () => void;
  /** Tear down the stream. Idempotent. Suppresses the close/error callbacks. */
  stop(): void;
}

type StartStreamArgs = {
  readonly url: string;
  readonly fingerprintBase64Url: string;
  readonly token: string;
};

type NativeStreamError = { code: string; message: string };

// The native module proxy is also an EventEmitter; we only need addListener
// and the start/stop functions.
interface PinnedStreamNativeModule {
  startStream(args: StartStreamArgs): boolean;
  stopStream(): boolean;
  addListener(eventName: string, cb: (...args: any[]) => void): { remove(): void };
}

let NativeModule: PinnedStreamNativeModule | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require("expo-modules-core") as {
    requireNativeModule: <T>(name: string) => T;
  };
  NativeModule = core.requireNativeModule<PinnedStreamNativeModule>("PinnedStreamModule");
} catch {
  NativeModule = undefined;
}

const NATIVE_EVENT_NAMES = {
  event: "onEvent",
  error: "onError",
  close: "onClose",
} as const;

/**
 * Open a pinned SSE stream to `url`.
 *
 * `fingerprintBase64Url` is the base64url-encoded SHA-256 of the server's leaf
 * certificate DER (no padding), as produced by the LAN daemon's pairing flow.
 * `token` is the paired bearer token; it is sent as `Authorization: Bearer`.
 *
 * Throws {@link PinnedStreamError} synchronously for setup failures
 * (unsupported platform, module not linked, invalid URL). Stream-lifetime
 * failures are reported via `onError`.
 */
export function startStream(
  url: string,
  fingerprintBase64Url: string,
  token: string,
): PinnedStreamHandle {
  if (Platform.OS !== "ios") {
    throw new PinnedStreamError({
      code: "unsupported_platform",
      message: `pinned-stream is only available on iOS (got Platform.OS="${Platform.OS}")`,
    });
  }
  if (!NativeModule) {
    throw new PinnedStreamError({
      code: "unsupported_platform",
      message:
        "Native PinnedStreamModule is not linked; run expo prebuild and rebuild the iOS app.",
    });
  }

  const native = NativeModule;
  native.startStream({ url, fingerprintBase64Url, token });

  return {
    onEvent(cb: (event: StreamEvent) => void): () => void {
      const sub = native.addListener(NATIVE_EVENT_NAMES.event, (payload: unknown) => {
        // Native forwards { data: "<raw SSE data string>" }. Defensive in case
        // the shape drifts: tolerate both { data } and a bare string.
        const raw = extractDataPayload(payload);
        const event = parseStreamEvent(raw);
        if (event) cb(event);
        // Malformed → silently drop (see parseStreamEvent contract).
      });
      return () => sub.remove();
    },
    onError(cb: (error: PinnedStreamError) => void): () => void {
      const sub = native.addListener(NATIVE_EVENT_NAMES.error, (payload: unknown) => {
        const { code, message } = extractErrorPayload(payload);
        cb(new PinnedStreamError({ code, message }));
      });
      return () => sub.remove();
    },
    onClose(cb: () => void): () => void {
      const sub = native.addListener(NATIVE_EVENT_NAMES.close, () => cb());
      return () => sub.remove();
    },
    stop(): void {
      native.stopStream();
    },
  };
}

function extractDataPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (isRecord(payload) && typeof payload.data === "string") return payload.data;
  return "";
}

function extractErrorPayload(payload: unknown): { code: PinnedStreamErrorCode; message: string } {
  if (!isRecord(payload)) {
    return { code: "network_error", message: "unknown stream error" };
  }
  const code = typeof payload.code === "string" && isKnownErrorCode(payload.code)
    ? payload.code
    : "network_error";
  const message = typeof payload.message === "string" ? payload.message : "stream error";
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PINNED_STREAM_ERROR_CODES: readonly PinnedStreamErrorCode[] = [
  "fingerprint_mismatch",
  "tls_handshake_failed",
  "timeout",
  "network_error",
  "invalid_url",
  "unsupported_platform",
];

function isKnownErrorCode(code: string): code is PinnedStreamErrorCode {
  return (PINNED_STREAM_ERROR_CODES as readonly string[]).includes(code);
}
