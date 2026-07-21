import { useEffect, useRef, type RefObject } from "react";
import type { NavigationContainerRef } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useMMKVBoolean } from "react-native-mmkv";

import doneSound from "../../assets/sounds/done.mp3";
import type { DemoAgent } from "../demo-contract";
import { useConnection } from "../connection";
import { useI18n } from "../i18n/I18nContext";
import { detectNewlyActive, detectNewlyCompleted, indexAgents } from "./doneDetection";
import { useRecentCompletions } from "./RecentCompletions";
import {
  DEFAULT_DONE_SOUND_ENABLED,
  DEFAULT_NOTIFY_WHILE_VIEWING,
  DEFAULT_LOCAL_NOTIFICATIONS_ENABLED,
  DONE_SOUND_ENABLED_KEY,
  NOTIFY_WHILE_VIEWING_KEY,
  LOCAL_NOTIFICATIONS_ENABLED_KEY,
  notificationStorage,
} from "./settings";
import type { RootStackParamList } from "../navigation";

interface AgentDetailParams {
  agent?: { source_id?: string };
}

/**
 * Configure the notification handler for foreground banners.
 *
 * Banner / list display: enabled (foreground notifications should appear).
 * Sound: disabled (done.mp3 already covers audio; avoid double-chime).
 * Badge: disabled (the in-app RecentCompletions badge is the primary indicator).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Plays the completion chime when an agent transitions to "done",
 * and (when enabled) sends an OS banner + haptic.
 *
 * Polling only runs while the app is in the foreground (see `connection.tsx`),
 * so detected transitions are inherently foreground-only — matching the
 * product decision to defer background/push notifications. Respects the three
 * notification prefs, and skips the agent currently open in AgentDetail when
 * "notify while viewing" is off. The current route is read via the navigation
 * ref (this provider lives outside the navigator, so `useNavigationState`
 * cannot be used).
 */
export function DoneSoundProvider({
  navigationRef,
}: {
  navigationRef: RefObject<NavigationContainerRef<RootStackParamList> | null>;
}) {
  const { state } = useConnection();
  const { t } = useI18n();

  const [enabledRaw] = useMMKVBoolean(DONE_SOUND_ENABLED_KEY, notificationStorage);
  const [notifyWhileViewingRaw] = useMMKVBoolean(NOTIFY_WHILE_VIEWING_KEY, notificationStorage);
  const [localNotificationsEnabledRaw] = useMMKVBoolean(
    LOCAL_NOTIFICATIONS_ENABLED_KEY,
    notificationStorage,
  );
  const enabled = enabledRaw ?? DEFAULT_DONE_SOUND_ENABLED;
  const notifyWhileViewing = notifyWhileViewingRaw ?? DEFAULT_NOTIFY_WHILE_VIEWING;
  const localNotificationsEnabled = localNotificationsEnabledRaw ?? DEFAULT_LOCAL_NOTIFICATIONS_ENABLED;

  const player = useAudioPlayer(doneSound);
  const { markCompleted, clearCompleted } = useRecentCompletions();
  const prevMapRef = useRef<Map<string, DemoAgent>>(new Map());
  const currentAgentsRef = useRef<DemoAgent[]>([]);

  useEffect(() => {
    currentAgentsRef.current = state.phase === "connected" ? state.data.agents : [];
  }, [state]);

  // Configure global audio so the chime is audible even under the iOS silent
  // switch (default ambient session is muted by it). Duck other audio briefly;
  // keep background playback off since we only chime in the foreground.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
    }).catch((error) => console.warn("[done-sound] setAudioModeAsync failed:", error));
  }, []);

  // Request notification permission once on mount if the setting is enabled.
  // The Settings toggle also requests permission on its own onChange, but that
  // only fires when the user actually flips the switch — since the default
  // value is "on" (DEFAULT_LOCAL_NOTIFICATIONS_ENABLED = true) without the user
  // ever touching it, relying solely on the toggle handler means permission is
  // never requested for the common case, and scheduleNotificationAsync then
  // fails silently forever. This mount-time check closes that gap.
  useEffect(() => {
    if (!localNotificationsEnabled) return;
    Notifications.getPermissionsAsync()
      .then(({ status }) => {
        if (status === "undetermined") {
          return Notifications.requestPermissionsAsync();
        }
        return undefined;
      })
      .catch((error) => console.warn("[done-sound] notification permission request failed:", error));
  }, [localNotificationsEnabled]);

  useEffect(() => {
    const agents = state.phase === "connected" ? state.data.agents : [];
    const newlyDone = detectNewlyCompleted(prevMapRef.current, agents);
    const newlyActive = detectNewlyActive(prevMapRef.current, agents);
    // Always advance the baseline so toggling the switch never backfills old transitions.
    prevMapRef.current = indexAgents(agents);

    // The visual badge is independent of the sound switch: mark completions
    // unconditionally, and drop the badge once an agent is working again.
    clearCompleted(newlyActive.map((agent) => agent.source_id));
    markCompleted(newlyDone.map((agent) => agent.source_id));

    // Early return if both sound and local notifications are disabled or no agents completed.
    if (newlyDone.length === 0) return;
    if (!enabled && !localNotificationsEnabled) return;

    let audible = newlyDone;
    if (!notifyWhileViewing) {
      const route = navigationRef.current?.getCurrentRoute();
      const viewingSourceId =
        route?.name === "AgentDetail"
          ? (route.params as AgentDetailParams | undefined)?.agent?.source_id
          : undefined;
      if (viewingSourceId) {
        audible = newlyDone.filter((agent) => agent.source_id !== viewingSourceId);
        if (audible.length === 0) return;
      }
    }

    // Sound: already plays via player below.

    // OS banner + haptic (stage 4 of issue #25).
    // Threat model constraint: notification content MUST NOT include agent
    // output or prompt plaintext. See docs/security/lan-tls-pairing.md (or
    // protocol-v1-threat-model.md) — DemoAgent has no terminal-output fields
    // by design; only metadata (display_name, workspace_label, etc.) is used.
    if (localNotificationsEnabled && audible.length > 0) {
      const titleKey = "notifications.agentFinished";
      const bodyText = t("notifications.waitingForInput");
      // Schedule one banner per agent (grouped banners would lose the per-agent
      // tap target). Sound is disabled here because done.mp3 already covers it.
      for (const agent of audible) {
        const displayName =
          agent.display_name || agent.workspace_label || agent.agent_name || "Agent";
        void Notifications.scheduleNotificationAsync({
          content: {
            title: displayName,
            body: bodyText,
            data: { source_id: agent.source_id },
          },
          trigger: null,
        }).catch((error) => {
          // Silently ignore failures (e.g., permission denied) to avoid crashing
          // the effect. The user can re-enable permissions via Settings.
          console.warn("[done-sound] scheduleNotificationAsync failed:", error);
        });
      }
      // Haptic: once per batch, not per agent.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((error) => {
        console.warn("[done-sound] Haptics.notificationAsync failed:", error);
      });
    }

    // Play sound only when the sound switch is enabled.
    if (enabled) {
      player.seekTo(0);
      player.play();
    }
  }, [state, enabled, notifyWhileViewing, localNotificationsEnabled, player, navigationRef, markCompleted, clearCompleted, t]);

  // Handle notification tap: navigate to the corresponding AgentDetail.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (!data) return;
      const sourceId = data.source_id as string | undefined;
      if (!sourceId) return;

      // Look up the agent in the current snapshot (the agent may have disappeared
      // if we reconnected or it was cleaned up). If found, navigate to AgentDetail.
      const agents = currentAgentsRef.current;
      const agent = agents.find((a) => a.source_id === sourceId);
      if (agent) {
        navigationRef.current?.navigate("AgentDetail", { agent });
      }
    });
    return () => {
      subscription.remove();
    };
  }, [navigationRef]);

  return null;
}