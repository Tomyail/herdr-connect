import { useEffect, useRef, type RefObject } from "react";
import type { NavigationContainerRef } from "@react-navigation/native";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useMMKVBoolean } from "react-native-mmkv";

import doneSound from "../../assets/sounds/done.mp3";
import type { DemoAgent } from "../demo-contract";
import { useConnection } from "../connection";
import { detectNewlyCompleted, indexAgents } from "./doneDetection";
import {
  DEFAULT_DONE_SOUND_ENABLED,
  DEFAULT_NOTIFY_WHILE_VIEWING,
  DONE_SOUND_ENABLED_KEY,
  NOTIFY_WHILE_VIEWING_KEY,
  notificationStorage,
} from "./settings";
import type { RootStackParamList } from "../navigation";

interface AgentDetailParams {
  agent?: { source_id?: string };
}

/**
 * Plays the completion chime when an agent transitions to "done".
 *
 * Polling only runs while the app is in the foreground (see `connection.tsx`),
 * so detected transitions are inherently foreground-only — matching the
 * product decision to defer background/push notifications. Respects the two
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
  const [enabledRaw] = useMMKVBoolean(DONE_SOUND_ENABLED_KEY, notificationStorage);
  const [notifyWhileViewingRaw] = useMMKVBoolean(NOTIFY_WHILE_VIEWING_KEY, notificationStorage);
  const enabled = enabledRaw ?? DEFAULT_DONE_SOUND_ENABLED;
  const notifyWhileViewing = notifyWhileViewingRaw ?? DEFAULT_NOTIFY_WHILE_VIEWING;
  const player = useAudioPlayer(doneSound);
  const prevMapRef = useRef<Map<string, DemoAgent>>(new Map());

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

  useEffect(() => {
    const agents = state.phase === "connected" ? state.data.agents : [];
    const newlyDone = detectNewlyCompleted(prevMapRef.current, agents);
    // Always advance the baseline so toggling the switch never backfills old transitions.
    prevMapRef.current = indexAgents(agents);

    if (!enabled || newlyDone.length === 0) return;

    if (!notifyWhileViewing) {
      const route = navigationRef.current?.getCurrentRoute();
      const viewingSourceId =
        route?.name === "AgentDetail"
          ? (route.params as AgentDetailParams | undefined)?.agent?.source_id
          : undefined;
      if (viewingSourceId) {
        const audible = newlyDone.filter((agent) => agent.source_id !== viewingSourceId);
        if (audible.length === 0) return;
      }
    }

    player.seekTo(0);
    player.play();
  }, [state, enabled, notifyWhileViewing, player, navigationRef]);

  return null;
}
