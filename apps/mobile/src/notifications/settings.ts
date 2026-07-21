import { createMMKV } from "react-native-mmkv";

/**
 * Persisted notification preferences. Shares the same MMKV id as the language
 * preference (different keys), so all app prefs live in one store. The raw
 * stored value is `boolean | undefined` (undefined before first toggle); callers
 * apply the exported defaults via `??`.
 */
export const notificationStorage = createMMKV({ id: "herdr-connect-prefs" });

export const DONE_SOUND_ENABLED_KEY = "doneSoundEnabled";
export const NOTIFY_WHILE_VIEWING_KEY = "notifyWhileViewing";
export const LOCAL_NOTIFICATIONS_ENABLED_KEY = "localNotificationsEnabled";

/** Default for the completion-sound master switch. */
export const DEFAULT_DONE_SOUND_ENABLED = true;
/**
 * Default for "also chime for the agent currently open in AgentDetail".
 * Mobile owners may look away even from the foreground agent, so default on.
 */
export const DEFAULT_NOTIFY_WHILE_VIEWING = true;
/** Default for OS banner + haptic notifications when an agent finishes a turn. */
export const DEFAULT_LOCAL_NOTIFICATIONS_ENABLED = true;
