/**
 * Synchronous persistence for the owner's appearance choice.
 *
 * Uses MMKV so the persisted value is available on first render (no async
 * hydration gap, no wrong-theme flash). Shares the "herdr-connect-prefs" store
 * with the language and notification preferences (different key).
 */

import { createMMKV } from "react-native-mmkv";

import { parseStoredAppearance, type AppearanceChoice } from "./appearance";

const STORAGE_ID = "herdr-connect-prefs";
const APPEARANCE_KEY = "appearance";

const storage = createMMKV({ id: STORAGE_ID });

export const appearanceStorage = {
  /** Read the persisted appearance choice synchronously; unknown values become "system". */
  read(): AppearanceChoice {
    return parseStoredAppearance(storage.getString(APPEARANCE_KEY));
  },
  /** Persist the owner's appearance choice. */
  write(choice: AppearanceChoice): void {
    storage.set(APPEARANCE_KEY, choice);
  },
};
