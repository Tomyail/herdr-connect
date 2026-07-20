/**
 * Paired-device credentials, persisted via expo-secure-store (iOS Keychain).
 *
 * These represent the result of QR pairing: the daemon's certificate
 * fingerprint (the pinned TLS identity), and the per-device bearer token +
 * device id issued by `/v1/pair`. The token is a sensitive credential, so it
 * MUST live in Keychain-backed secure storage — never MMKV (which is for
 * non-sensitive settings). See docs/security/lan-tls-pairing.md for the model.
 */

import * as SecureStore from "expo-secure-store";

const CREDENTIALS_KEY = "herdr-connect.paired-device";

/** Shape persisted to Keychain. Keep field names stable — older installs read them. */
export interface DeviceCredentials {
  /** base64url SHA-256 of the daemon's leaf certificate DER. Pinned on every request. */
  readonly fingerprint: string;
  /** Device id issued by `/v1/pair` (e.g. `dev_…`). */
  readonly deviceId: string;
  /** Per-device bearer token. Sent as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Device name submitted at pairing. Shown in Settings for recognition. */
  readonly deviceName: string;
  /** ISO timestamp of pairing. */
  readonly pairedAt: string;
}

/** Persist credentials (Keychain, device-local, when-unlocked). Overwrites any prior pairing. */
export async function saveCredentials(credentials: DeviceCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Read persisted credentials, or `null` if this device has never paired (or was unpaired). */
export async function loadCredentials(): Promise<DeviceCredentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!raw) return null;
  const parsed = parseCredentials(raw);
  return parsed;
}

/** Clear persisted credentials. Used by "unpair" (local-only; daemon-side revocation is separate). */
export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}

function parseCredentials(raw: string): DeviceCredentials | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.fingerprint !== "string" ||
    typeof record.deviceId !== "string" ||
    typeof record.token !== "string" ||
    typeof record.deviceName !== "string" ||
    typeof record.pairedAt !== "string"
  ) {
    return null;
  }
  return {
    fingerprint: record.fingerprint,
    deviceId: record.deviceId,
    token: record.token,
    deviceName: record.deviceName,
    pairedAt: record.pairedAt,
  };
}
