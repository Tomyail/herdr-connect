/**
 * Public entry point for the pinned-fetch module.
 *
 * On iOS, dispatches to the native `PinnedFetchModule.pinnedFetch` which performs
 * a URLSession request pinned to the supplied certificate fingerprint. On every
 * other platform (Android, web), throws {@link PinnedFetchError} with code
 * `unsupported_platform` without touching the network.
 */

import { Platform } from "react-native";

import {
  PinnedFetchError,
  type PinnedFetchErrorCode,
  type PinnedFetchOptions,
  type PinnedFetchResponse,
} from "./src/PinnedFetch.types";

// `require` so a missing native module (e.g. prebuild not yet run, or JS bundle
// on a non-iOS host) surfaces a clear, typed error instead of a crash at import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NativeModule = require("react-native").NativeModules.PinnedFetchModule as
  | {
      pinnedFetch: (
        url: string,
        fingerprintBase64Url: string,
        options: PinnedFetchOptions,
      ) => Promise<PinnedFetchResponse>;
    }
  | undefined;

/**
 * Issue an HTTPS request pinned to `fingerprintBase64Url`.
 *
 * `fingerprintBase64Url` is the base64url-encoded SHA-256 of the server's leaf
 * certificate DER (no padding), as produced by the LAN daemon's pairing flow.
 *
 * Resolves with `{ status, headers, body }` for any HTTP response status — the
 * caller decides whether a given status (e.g. 401 before pairing) is a success
 * or a domain error. Rejects with {@link PinnedFetchError} for transport-level
 * failures: fingerprint mismatch, TLS handshake failure, timeout, network error,
 * invalid URL, or unsupported platform.
 */
export async function pinnedFetch(
  url: string,
  fingerprintBase64Url: string,
  options: PinnedFetchOptions = {},
): Promise<PinnedFetchResponse> {
  if (Platform.OS !== "ios") {
    throw new PinnedFetchError({
      code: "unsupported_platform",
      message: `pinnedFetch is only available on iOS (got Platform.OS="${Platform.OS}")`,
    });
  }
  if (!NativeModule) {
    throw new PinnedFetchError({
      code: "unsupported_platform",
      message:
        "Native PinnedFetchModule is not linked; run expo prebuild and rebuild the iOS app.",
    });
  }
  try {
    return await NativeModule.pinnedFetch(url, fingerprintBase64Url, options);
  } catch (error) {
    // The native side rejects with { code, message }. Normalize anything else.
    if (isNativePinnedFetchError(error) && isKnownErrorCode(error.code)) {
      throw new PinnedFetchError({ code: error.code, message: error.message });
    }
    throw new PinnedFetchError({
      code: "network_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export { PinnedFetchError } from "./src/PinnedFetch.types";
export type {
  PinnedFetchErrorCode,
  PinnedFetchErrorOptions,
  PinnedFetchOptions,
  PinnedFetchResponse,
} from "./src/PinnedFetch.types";

type NativePinnedFetchError = { code: string; message: string };

const PINNED_FETCH_ERROR_CODES: readonly PinnedFetchErrorCode[] = [
  "fingerprint_mismatch",
  "tls_handshake_failed",
  "timeout",
  "network_error",
  "invalid_url",
  "unsupported_platform",
];

function isKnownErrorCode(code: string): code is PinnedFetchErrorCode {
  return (PINNED_FETCH_ERROR_CODES as readonly string[]).includes(code);
}

function isNativePinnedFetchError(value: unknown): value is NativePinnedFetchError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
