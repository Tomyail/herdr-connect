/**
 * Persisted preferences for the continuous voice flow.
 * Follows the same MMKV pattern as voice language (voice/storage.ts) and
 * notification prefs (notifications/settings.ts).
 */

import { createMMKV } from "react-native-mmkv";

const STORAGE_ID = "herdr-connect-prefs";
const SILENCE_THRESHOLD_KEY = "voiceSilenceThresholdMs";

/** Preset options in milliseconds shown in the settings picker. */
export const SILENCE_THRESHOLD_OPTIONS = [1000, 1500, 2000, 3000] as const;
export const DEFAULT_SILENCE_THRESHOLD = 1500;

const storage = createMMKV({ id: STORAGE_ID });

export const silenceThresholdStorage = {
  read(): number {
    const raw = storage.getNumber(SILENCE_THRESHOLD_KEY);
    if (raw != null && Number.isFinite(raw) && raw > 0) return raw;
    return DEFAULT_SILENCE_THRESHOLD;
  },
  write(ms: number): void {
    storage.set(SILENCE_THRESHOLD_KEY, ms);
  },
};
