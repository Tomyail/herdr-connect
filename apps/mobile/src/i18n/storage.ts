/**
 * Synchronous persistence for the owner's language choice.
 *
 * Uses MMKV so the persisted value is available on first render (no async
 * hydration gap, no wrong-language flicker — see product decision #8).
 * Parsing of the raw stored value is delegated to the pure {@link parseStoredLanguage}
 * so the validation logic stays unit-testable without a native dependency.
 */

import { createMMKV } from "react-native-mmkv";

import { parseStoredLanguage, type AppLanguage } from "./locale";

const STORAGE_ID = "herdr-connect-prefs";
const LANGUAGE_KEY = "language";

const storage = createMMKV({ id: STORAGE_ID });

export const languageStorage = {
  /** Read the persisted language choice synchronously; unknown values become "system". */
  read(): AppLanguage {
    return parseStoredLanguage(storage.getString(LANGUAGE_KEY));
  },
  /** Persist the owner's language choice. */
  write(language: AppLanguage): void {
    storage.set(LANGUAGE_KEY, language);
  },
};
