/**
 * Voice recognition language persistence.
 *
 * Mirrors the language/appearance persistence pattern: MMKV for synchronous
 * first-render reads (no async hydration gap), sharing the shared prefs store.
 *
 * The stored value is a BCP-47 language tag string (e.g. "en-US", "zh-CN",
 * "ja-JP") or the sentinel {@link VOICE_LANG_SYSTEM} meaning "follow the device
 * system locale". Unknown values fall back to {@link VOICE_LANG_SYSTEM}.
 */

import { createMMKV } from "react-native-mmkv";

const STORAGE_ID = "herdr-connect-prefs";
const VOICE_LANG_KEY = "voiceRecognitionLanguage";

/** Sentinel stored value meaning "follow the device system locale". */
export const VOICE_LANG_SYSTEM = "system";

const storage = createMMKV({ id: STORAGE_ID });

export const voiceLanguageStorage = {
  /** Read the persisted voice-language choice synchronously; unknown values fall back to "system". */
  read(): string {
    const value = storage.getString(VOICE_LANG_KEY);
    return value && value.length > 0 ? value : VOICE_LANG_SYSTEM;
  },
  /** Persist the owner's voice-language choice (a BCP-47 tag or the "system" sentinel). */
  write(lang: string): void {
    storage.set(VOICE_LANG_KEY, lang);
  },
};
