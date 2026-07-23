import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import type { DiscoveredService } from "./discovery";

import type { Agent } from "./agent-contract";
import {
  fetchAgentHistory,
  interruptAgent,
  sendAgentMessage,
  type AgentHistory,
} from "./network";
import { useConnection } from "./connection";
import { useRecentCompletions } from "./notifications/RecentCompletions";
import { useI18n } from "./i18n/I18nContext";
import { toErrorCode, toErrorStatus, type NetworkErrorCode } from "./i18n/errors";
import { agentStatus } from "./agent-status";
import { AgentBrandIcon } from "./AgentBrandIcon";
import { HistoryMarkdown } from "./HistoryMarkdown";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ICON_SIZE, Ionicons } from "./icons";
import type { RootStackParamList } from "./navigation";
import { isHistoryNearBottom, isSameHistoryContent } from "./history-scroll";
import { resolveComposerAction } from "./composerAction";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useMMKVBoolean } from "react-native-mmkv";
import {
  AUTO_SEND_VOICE_KEY,
  DEFAULT_AUTO_SEND_VOICE,
  DEFAULT_SENT_SOUND_ENABLED,
  SENT_SOUND_ENABLED_KEY,
  notificationStorage,
} from "./notifications/settings";
import { useVoiceLanguage } from "./voice/VoiceLanguageContext";
import { resolveVoiceLang, loadSupportedVoiceLocales } from "./voice/config";
import { silenceThresholdStorage } from "./voice/silenceThreshold";
import {
  cReducer,
  INITIAL_STATE,
  isContinuousVoiceAgentReady,
  type CPhase,
} from "./voice/continuousReducer";
import { VoiceWaveform } from "./voice/VoiceWaveform";
import {
  actionForContinuousModePress,
  actionForMicPress,
} from "./voice/continuousControls";
import { restorePlaybackAudioMode } from "./audioMode";
import { playSoundFromStart } from "./notifications/doneSoundPlayback";
import sentSound from "../assets/sounds/sent.mp3";

const HISTORY_REFRESH_MS = 2_000;
const VOICE_VOLUME_INTERVAL_MS = 100;
const VOICE_WAVEFORM_BAR_COUNT = 24;

type LoadPhase = "loading" | "ready" | "failed";
type SendPhase = "idle" | "sending" | "sent" | "failed";
type VoiceModeNotice = { kind: "enabled" | "disabled"; id: number };
// 叫停状态机与 SendPhase 同构但不共用：发消息与叫停是两个独立动作，各自的
// “已发送 / 已叫停”提示和错误不应互相覆盖。
type InterruptPhase = "idle" | "sending" | "sent" | "failed";

type Props = NativeStackScreenProps<RootStackParamList, "AgentDetail">;

interface Failure {
  code: NetworkErrorCode;
  status?: number;
}

/**
 * Header config produced by {@link AgentDetailBody} so each render mode can
 * surface the same title/subtitle/refresh affordance in its own chrome — the
 * wide inline header consumes this shape directly, while the narrow
 * native-stack header reads the refresh action through a ref.
 */
export interface AgentDetailHeaderConfig {
  title: string;
  subtitle: string;
  onRefresh: () => void;
}

interface VoiceInputOptions {
  /** Current draft text (the shared composer state). */
  draft: string;
  /** Replace the draft (same setter used by manual typing). */
  setDraft: (value: string | ((prev: string) => string)) => void;
  /** TextInput ref — tapped to dismiss the keyboard when mic is pressed. */
  inputRef: React.RefObject<TextInput | null>;
  /** Fires every time a speech recognition result arrives (partial or final).
   *  The orchestrator uses this for silence detection. */
  onResultActivity?: () => void;
  /** Fires when the recognition engine emits an "end" event (system auto-end
   *  or user stop). The orchestrator uses this to distinguish the two cases. */
  onVoiceEnd?: (userStopped: boolean) => void;
  /** Fires the send action once recognition completes (used by the orchestrator). */
  onAutoSend?: () => void;
}

interface VoiceInputValue {
  /** True while the recognizer is actively listening. */
  listening: boolean;
  /** Toggle recognition on/off, requesting permissions on first start. */
  toggleVoice: () => void;
  /** Last error message, shown briefly above the composer; cleared on retry. */
  errorMessage: string | null;
  /** Reset internal draft bookkeeping and discard native results still arriving
   *  from the current session after an automatic send has begun. */
  resetDraftRefs: (to?: string) => void;
  /** Rolling real-time microphone levels used by the listening waveform. */
  volumeSamples: readonly Animated.Value[];
}

/**
 * On-device streaming speech recognition wired into the shared `draft` state.
 * Partial results update the TextInput live WITHOUT focusing it, so the system
 * keyboard never opens during voice input. Recognition is fully local (iOS
 * SFSpeechRecognizer / Android SpeechRecognizer via expo-speech-recognition) —
 * no audio leaves the device.
 *
 * Streaming model: the draft is treated as `baseRef.current + liveTranscript`.
 * `baseRef` is whatever was in the box when listening started (so you can
 * dictate after already-typed text). When a final result lands, its transcript
 * is folded into the base and the live part resets; partials overwrite only
 * the live tail, so the box always shows coherent text.
 */
function useVoiceInput({ draft, setDraft, inputRef, onResultActivity, onVoiceEnd, onAutoSend }: VoiceInputOptions): VoiceInputValue {
  const { t } = useI18n();
  const { choice: voiceChoice } = useVoiceLanguage();
  const [listening, setListening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Native speech events are module-global and can arrive after the Agent
  // detail that started them has unmounted. Only process events while this
  // hook owns an active session; otherwise an old Agent's delayed end/start
  // event can make the newly mounted Agent appear to be listening.
  const voiceMountedRef = useRef(true);
  const sessionActiveRef = useRef(false);
  const startAttemptRef = useRef(0);
  const volumeSamples = useRef(
    Array.from({ length: VOICE_WAVEFORM_BAR_COUNT }, () => new Animated.Value(0)),
  ).current;
  const volumeHistoryRef = useRef<number[]>(Array(VOICE_WAVEFORM_BAR_COUNT).fill(0));
  // Text captured as finalized while listening; partial results append after it.
  const baseRef = useRef("");
  const liveRef = useRef("");
  // stop() is asynchronous: iOS can still deliver a final/partial result before
  // its end event. Auto-send resets the draft first, so ignore those trailing
  // results until that session has fully ended; manual stop leaves this false.
  const discardPendingResultsRef = useRef(false);
  // Distinguishes a user-initiated stop (toggle off) from a system auto-end
  // (iOS ~60s cap / Android silence timeout). On auto-end we restart so the
  // user can keep talking across the system boundary without re-tapping the mic.
  const userStoppedRef = useRef(false);
  // Guard against runaway auto-restart loops when the system repeatedly
  // triggers "end" without a corresponding "start" (e.g. audio session
  // interruption). After MAX_AUTO_RESTARTS consecutive auto-restarts we
  // surrender and show an error instead of silently hammering the engine.
  const MAX_AUTO_RESTARTS = 3;
  const restartCountRef = useRef(0);
  // lang is computed async in start() and cached here so the auto-restart in
  // the "end" handler can re-use it without re-running the async work.
  const langRef = useRef("en-US");

  // Keep draft = base + live whenever the live transcript changes.
  const commitLive = useCallback(() => {
    setDraft(baseRef.current + liveRef.current);
  }, [setDraft]);

  const resetVolumeSamples = useCallback(() => {
    volumeHistoryRef.current.fill(0);
    volumeSamples.forEach((sample) => sample.setValue(0));
  }, [volumeSamples]);

  const restoreAudioAfterRecognition = useCallback(() => {
    void restorePlaybackAudioMode().catch((error) => {
      console.warn("[voice] failed to restore playback audio mode:", error);
    });
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (!sessionActiveRef.current) return;
    setListening(true);
    setErrorMessage(null);
    // A genuine start resets the auto-restart counter.
    restartCountRef.current = 0;
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!sessionActiveRef.current || discardPendingResultsRef.current) return;
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      // Fold the finalized segment into the base; reset the live tail.
      baseRef.current = baseRef.current + transcript;
      liveRef.current = "";
    } else {
      liveRef.current = transcript;
    }
    commitLive();
    onResultActivity?.();
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (!sessionActiveRef.current) return;
    // Both native implementations report roughly -2...10 and document values
    // below zero as inaudible. Keep a short rolling history so adjacent bars
    // visualize recent real samples instead of moving in lockstep.
    const normalized = Math.min(1, Math.max(0, event.value) / 10);
    const history = [...volumeHistoryRef.current.slice(1), normalized];
    volumeHistoryRef.current = history;
    volumeSamples.forEach((sample, index) => {
      Animated.timing(sample, {
        toValue: history[index] ?? 0,
        duration: VOICE_VOLUME_INTERVAL_MS,
        isInteraction: false,
        useNativeDriver: true,
      }).start();
    });
  });

  useSpeechRecognitionEvent("end", () => {
    if (!sessionActiveRef.current) return;
    if (discardPendingResultsRef.current) {
      // Auto-send already captured the text. Never let a trailing native result
      // or partial restore that sent text into the now-empty composer.
      baseRef.current = "";
      liveRef.current = "";
      discardPendingResultsRef.current = false;
    } else if (liveRef.current) {
      // Manual/system stop: preserve a last partial that never became final.
      baseRef.current = baseRef.current + liveRef.current;
      liveRef.current = "";
      commitLive();
    }
    const wasUserStopped = userStoppedRef.current;
    if (wasUserStopped) {
      // The owner tapped stop — finish listening for real.
      sessionActiveRef.current = false;
      userStoppedRef.current = false;
      resetVolumeSamples();
      setListening(false);
      restoreAudioAfterRecognition();
    }
    // Notify the orchestrator so it can decide whether to auto-send or restart.
    onVoiceEnd?.(wasUserStopped);
    if (!wasUserStopped) {
      // System auto-ended mid-session (iOS time cap / Android silence). Restart
      // immediately so dictation continues seamlessly until the owner stops it.
      restartCountRef.current += 1;
      if (restartCountRef.current > MAX_AUTO_RESTARTS) {
        sessionActiveRef.current = false;
        resetVolumeSamples();
        setListening(false);
        userStoppedRef.current = false;
        restoreAudioAfterRecognition();
        setErrorMessage(t("detail.voice.error"));
        console.warn("[voice] auto-restart limit reached, stopping");
        return;
      }
      try {
        ExpoSpeechRecognitionModule.start({
          lang: langRef.current,
          interimResults: true,
          continuous: true,
          volumeChangeEventOptions: { enabled: true, intervalMillis: VOICE_VOLUME_INTERVAL_MS },
        });
      } catch (error) {
        sessionActiveRef.current = false;
        resetVolumeSamples();
        setListening(false);
        restoreAudioAfterRecognition();
        setErrorMessage(t("detail.voice.error"));
        console.warn("[voice] auto-restart failed:", error);
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!sessionActiveRef.current) return;
    if (event.error === "no-speech") {
      // No speech was detected at all — a strong signal the owner has stopped
      // talking. Treat this as an intentional stop so the orchestrator exits
      // the continuous loop rather than auto-restarting.
      sessionActiveRef.current = false;
      userStoppedRef.current = true;
      resetVolumeSamples();
      setListening(false);
      restoreAudioAfterRecognition();
      onVoiceEnd?.(true);
      return;
    }
    sessionActiveRef.current = false;
    resetVolumeSamples();
    setListening(false);
    restoreAudioAfterRecognition();
    setErrorMessage(`${t("detail.voice.error")} (${event.error})`);
    console.warn("[voice] recognition error:", event.error, event.message);
  });

  const start = useCallback(async () => {
    const attempt = ++startAttemptRef.current;
    setErrorMessage(null);
    try {
      // requestPermissionsAsync covers both mic + speech recognition on iOS/Android.
      const status = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!voiceMountedRef.current || attempt !== startAttemptRef.current) return;
      if (!status.granted) {
        Alert.alert(
          t("detail.voice.permissionTitle"),
          t("detail.voice.permissionMessage"),
          [
            { text: t("detail.interruptConfirm.cancel"), style: "cancel" },
            { text: t("detail.voice.permissionGrant"), onPress: () => void ExpoSpeechRecognitionModule.requestPermissionsAsync() },
          ],
          { cancelable: true },
        );
        // Permission denied during auto-restart — tell the orchestrator to
        // exit so we don't silently get stuck in "listening" phase.
        sessionActiveRef.current = false;
        setListening(false);
        onVoiceEnd?.(true);
        return;
      }
      baseRef.current = draft;
      liveRef.current = "";
      discardPendingResultsRef.current = false;
      userStoppedRef.current = false;
      // Dismiss the keyboard if the user had been typing before tapping the
      // mic — a focused-but-now-non-editable TextInput won't let go of the
      // keyboard on its own. Keyboard.dismiss() + blur() is the reliable
      // combination on both iOS and Android.
      Keyboard.dismiss();
      inputRef.current?.blur();
      // Resolve the recognizer locale against the device's supported list so a
      // script-based tag (e.g. zh-Hans from the system locale) is mapped to the
      // region form the engine accepts (zh-CN), avoiding language-not-supported.
      const { locales } = await loadSupportedVoiceLocales();
      if (!voiceMountedRef.current || attempt !== startAttemptRef.current) return;
      const lang = resolveVoiceLang(voiceChoice, locales);
      langRef.current = lang;
      sessionActiveRef.current = true;
      resetVolumeSamples();
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        // Keep the recognizer running across silence gaps so the owner can say
        // multiple sentences in one session. On iOS the system still caps at
        // ~60s; the "end" handler auto-restarts to bridge across that cap.
        continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: VOICE_VOLUME_INTERVAL_MS },
      });
    } catch (error) {
      sessionActiveRef.current = false;
      if (!voiceMountedRef.current || attempt !== startAttemptRef.current) return;
      resetVolumeSamples();
      setListening(false);
      restoreAudioAfterRecognition();
      setErrorMessage(t("detail.voice.error"));
      console.warn("[voice] failed to start:", error);
    }
  }, [draft, inputRef, onVoiceEnd, resetVolumeSamples, restoreAudioAfterRecognition, t, voiceChoice]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  // When the component is unmounted (e.g. on agent switch via key={}), cancel
  // any async start still in flight, relinquish ownership before delayed native
  // events arrive, and tear down the native recognition session.
  useEffect(() => {
    voiceMountedRef.current = true;
    return () => {
      voiceMountedRef.current = false;
      startAttemptRef.current += 1;
      sessionActiveRef.current = false;
      userStoppedRef.current = true;
      resetVolumeSamples();
      ExpoSpeechRecognitionModule.stop();
    };
  }, [resetVolumeSamples]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      void stop();
    } else {
      void start();
    }
  }, [listening, start, stop]);

  const resetDraftRefs = useCallback((to: string = "") => {
    baseRef.current = to;
    liveRef.current = "";
    discardPendingResultsRef.current = true;
  }, []);

  return { listening, toggleVoice, errorMessage, resetDraftRefs, volumeSamples };
}

function useSentSound() {
  const [enabledRaw] = useMMKVBoolean(SENT_SOUND_ENABLED_KEY, notificationStorage);
  const enabled = enabledRaw ?? DEFAULT_SENT_SOUND_ENABLED;
  const player = useAudioPlayer(sentSound);

  return useCallback(() => {
    if (!enabled) return;
    void playSoundFromStart(player, restorePlaybackAudioMode).catch((error) => {
      console.warn("[sent-sound] playback failed:", error);
    });
  }, [enabled, player]);
}

function AgentHistorySection({
  hasNewContent,
  history,
  isNearBottomRef,
  loadError,
  loadPhase,
  positionedHistoryRef,
  scrollRef,
  setHasNewContent,
}: {
  hasNewContent: boolean;
  history?: AgentHistory;
  isNearBottomRef: React.RefObject<boolean>;
  loadError?: Failure;
  loadPhase: LoadPhase;
  positionedHistoryRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<ScrollView | null>;
  setHasNewContent: (value: boolean) => void;
}) {
  const { t, tError } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>{t("detail.historyTitle")}</Text>
        <Text style={styles.historyMeta}>
          {history?.truncated ? t("detail.historyMeta.truncated") : t("detail.historyMeta.recent")}
        </Text>
      </View>

      <View style={styles.historyFrame}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.historyContent}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => {
            if (!history) return;
            if (!positionedHistoryRef.current) {
              positionedHistoryRef.current = true;
              scrollRef.current?.scrollToEnd({ animated: false });
            } else if (isNearBottomRef.current) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const nearBottom = isHistoryNearBottom({
              contentHeight: contentSize.height,
              offsetY: contentOffset.y,
              viewportHeight: layoutMeasurement.height,
            });
            isNearBottomRef.current = nearBottom;
            if (nearBottom) setHasNewContent(false);
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.history}
        >
          {loadPhase === "loading" && !history ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.spinner} />
              <Text style={styles.stateText}>{t("detail.loadingHistory")}</Text>
            </View>
          ) : loadPhase === "failed" && !history ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>{loadError ? tError(loadError.code, { status: loadError.status }) : tError("history_read")}</Text>
            </View>
          ) : (
            <HistoryMarkdown
              text={history?.text || t("detail.emptyHistory")}
              styles={{
                base: styles.transcript,
                header: [styles.transcript, styles.transcriptHeader],
                bold: [styles.transcript, styles.transcriptBold],
                code: [styles.transcript, styles.transcriptCode],
              }}
            />
          )}
        </ScrollView>
        {hasNewContent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("detail.newContent")}
            onPress={() => {
              isNearBottomRef.current = true;
              setHasNewContent(false);
              scrollRef.current?.scrollToEnd({ animated: true });
            }}
            style={({ pressed }) => [styles.newContentButton, pressed && styles.newContentButtonPressed]}
          >
            <Text style={styles.newContentText}>{t("detail.newContent")}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function AgentComposer({
  canInterrupt,
  canSend,
  countdown,
  cPhase,
  continuousEnabled,
  draft,
  handleContinuousModePress,
  handleMicPress,
  inputRef,
  interrupt,
  interruptError,
  interruptPhase,
  send,
  sendError,
  sendPhase,
  setDraft,
  setSendPhase,
  voice,
  voiceModeNotice,
  onVoiceModeNoticeDismiss,
}: {
  canInterrupt: boolean;
  canSend: boolean;
  countdown: number | null;
  cPhase: CPhase;
  continuousEnabled: boolean;
  draft: string;
  handleContinuousModePress: () => void;
  handleMicPress: () => void;
  inputRef: React.RefObject<TextInput | null>;
  interrupt: () => Promise<void>;
  interruptError?: Failure;
  interruptPhase: InterruptPhase;
  send: () => Promise<void>;
  sendError?: Failure;
  sendPhase: SendPhase;
  setDraft: VoiceInputOptions["setDraft"];
  setSendPhase: (phase: SendPhase) => void;
  voice: VoiceInputValue;
  voiceModeNotice: VoiceModeNotice | null;
  onVoiceModeNoticeDismiss: (id: number) => void;
}) {
  const { t, tError } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const voiceModeNoticeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!voiceModeNotice) return;
    const noticeId = voiceModeNotice.id;
    voiceModeNoticeOpacity.stopAnimation();
    voiceModeNoticeOpacity.setValue(1);
    const holdTimer = setTimeout(() => {
      Animated.timing(voiceModeNoticeOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onVoiceModeNoticeDismiss(noticeId);
      });
    }, 2700);
    return () => {
      clearTimeout(holdTimer);
      voiceModeNoticeOpacity.stopAnimation();
    };
  }, [onVoiceModeNoticeDismiss, voiceModeNotice, voiceModeNoticeOpacity]);

  const composerAction = resolveComposerAction({
    canInterrupt,
    canSend,
    interruptPending: interruptPhase === "sending",
    sendPending: sendPhase === "sending",
    voiceListening: voice.listening,
  });

  return (
    <View style={styles.composerArea}>
      <View style={styles.composerFeedbackSlot}>
        {voiceModeNotice ? (
          <Animated.Text
            numberOfLines={2}
            style={[
              styles.voiceModeNoticeText,
              styles.composerFeedbackText,
              { opacity: voiceModeNoticeOpacity },
            ]}
          >
            {t(
              voiceModeNotice.kind === "enabled"
                ? "detail.voice.continuousModeEnabled"
                : "detail.voice.continuousModeDisabled",
            )}
          </Animated.Text>
        ) : interruptPhase === "failed" && interruptError ? (
          <Text numberOfLines={2} style={[styles.sendError, styles.composerFeedbackText]}>
            {tError(interruptError.code, { status: interruptError.status })}
          </Text>
        ) : interruptPhase === "sent" ? (
          <Text style={[styles.sentText, styles.composerFeedbackText]}>
            {t("detail.interruptSent")}
          </Text>
        ) : sendPhase === "failed" && sendError ? (
          <Text numberOfLines={2} style={[styles.sendError, styles.composerFeedbackText]}>
            {tError(sendError.code, { status: sendError.status })}
          </Text>
        ) : sendPhase === "sent" ? (
          <Text style={[styles.sentText, styles.composerFeedbackText]}>
            {t("detail.sentToDesktop")}
          </Text>
        ) : null}
      </View>
      {voice.errorMessage ? <Text style={styles.sendError}>{voice.errorMessage}</Text> : null}
      <View style={styles.composer}>
        <View style={styles.inputColumn}>
          <TextInput
            accessibilityLabel={t("detail.inputA11y")}
            ref={inputRef}
            blurOnSubmit={false}
            editable={!voice.listening}
            maxLength={4000}
            multiline
            onChangeText={(value) => {
              setDraft(value);
              if (sendPhase !== "sending") setSendPhase("idle");
            }}
            placeholder={t("detail.inputPlaceholder")}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={draft}
          />
          <View style={styles.voiceWaveformSlot}>
            {voice.listening ? (
              <VoiceWaveform
                accessibilityLabel={t("detail.voice.listening")}
                samples={voice.volumeSamples}
              />
            ) : null}
          </View>
        </View>
        <View
          accessibilityRole="none"
          style={[
            styles.voiceControl,
            (voice.listening || cPhase !== "idle") && styles.voiceControlActive,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cPhase === "countingDown" ? t("voice.countdownA11y", { n: countdown ?? 0 }) : voice.listening ? t("detail.voice.stopA11y") : t("detail.voice.startA11y")}
            accessibilityState={voice.listening ? { expanded: true } : undefined}
            hitSlop={{ top: 8, bottom: 8, left: 8 }}
            onPress={handleMicPress}
            style={({ pressed }) => [
              styles.voiceControlSegment,
              styles.voiceMicSegment,
              (voice.listening || cPhase !== "idle") && styles.voiceMicSegmentActive,
              pressed && styles.voiceControlSegmentPressed,
            ]}
          >
            {cPhase === "countingDown" && countdown != null ? (
              <Text style={[styles.voiceButtonText, { color: colors.accent }]}>{countdown}</Text>
            ) : (
              <Ionicons name={voice.listening ? "stop" : "mic"} size={22} color={voice.listening || cPhase !== "idle" ? colors.accent : colors.textSecondary} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={t("detail.voice.continuousModeA11y")}
            accessibilityState={{ checked: continuousEnabled }}
            hitSlop={{ top: 8, bottom: 8, right: 8 }}
            onPress={handleContinuousModePress}
            style={({ pressed }) => [
              styles.voiceControlSegment,
              styles.voiceModeSegment,
              continuousEnabled && styles.voiceModeSegmentActive,
              pressed && styles.voiceControlSegmentPressed,
            ]}
          >
            <Ionicons
              name={continuousEnabled ? "repeat" : "repeat-outline"}
              size={21}
              color={continuousEnabled ? colors.accent : colors.textMuted}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            composerAction.mode === "interrupt" ? "detail.interruptA11y" : "detail.sendA11y",
          )}
          disabled={composerAction.disabled}
          onPress={() => {
            if (composerAction.mode === "interrupt") void interrupt();
            else void send();
          }}
          style={({ pressed }) => [
            styles.sendButton,
            composerAction.mode === "interrupt" && styles.composerActionInterrupt,
            composerAction.mode === "send" && composerAction.disabled && styles.sendButtonDisabled,
            composerAction.mode === "interrupt" && composerAction.disabled && styles.composerActionInterruptDisabled,
            pressed && !composerAction.disabled &&
              (composerAction.mode === "interrupt"
                ? styles.composerActionInterruptPressed
                : styles.sendButtonPressed),
          ]}
        >
          {composerAction.pending ? (
            <ActivityIndicator
              color={composerAction.mode === "interrupt" ? colors.onDanger : colors.onAction}
              size="small"
            />
          ) : (
            <Text
              style={[
                composerAction.mode === "interrupt"
                  ? styles.composerActionInterruptText
                  : styles.sendButtonText,
                composerAction.disabled &&
                  (composerAction.mode === "interrupt"
                    ? styles.composerActionInterruptTextDisabled
                    : styles.sendButtonTextDisabled),
              ]}
            >
              {t(composerAction.mode === "interrupt" ? "detail.interrupt" : "detail.send")}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function useAgentHistory(agent: Agent, service: DiscoveredService) {
  const [history, setHistory] = useState<AgentHistory>();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadError, setLoadError] = useState<Failure>();
  const [hasNewContent, setHasNewContent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const isNearBottomRef = useRef(true);
  const positionedHistoryRef = useRef(false);
  const displayedHistoryRef = useRef(false);
  const mountedRef = useRef(true);

  const loadHistory = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadPhase("loading");
    try {
      const next = await fetchAgentHistory(service, agent.source_id);
      if (!mountedRef.current) return;
      setHistory((current) => (isSameHistoryContent(current, next) ? current : next));
      setLoadPhase("ready");
      setLoadError(undefined);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadPhase("failed");
      setLoadError({ code: toErrorCode(error, "history_read"), status: toErrorStatus(error) });
    }
  }, [agent.source_id, service]);

  useEffect(() => {
    mountedRef.current = true;
    void loadHistory(true);
    const timer = setInterval(() => void loadHistory(), HISTORY_REFRESH_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!history) return;
    const hadHistory = displayedHistoryRef.current;
    displayedHistoryRef.current = true;
    if (hadHistory && !isNearBottomRef.current) setHasNewContent(true);
  }, [history]);

  return {
    hasNewContent,
    history,
    isNearBottomRef,
    loadError,
    loadHistory,
    loadPhase,
    mountedRef,
    positionedHistoryRef,
    scrollRef,
    setHasNewContent,
  };
}

function useAgentMessaging({
  agent,
  isNearBottomRef,
  loadHistory,
  mountedRef,
  service,
  setHasNewContent,
  onSent,
}: {
  agent: Agent;
  isNearBottomRef: React.RefObject<boolean>;
  loadHistory: (showLoading?: boolean) => Promise<void>;
  mountedRef: React.RefObject<boolean>;
  service: DiscoveredService;
  setHasNewContent: (value: boolean) => void;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendError, setSendError] = useState<Failure>();
  const [interruptPhase, setInterruptPhase] = useState<InterruptPhase>("idle");
  const [interruptError, setInterruptError] = useState<Failure>();

  const resetInterruptFeedback = useCallback(() => {
    setInterruptPhase("idle");
    setInterruptError(undefined);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendPhase === "sending") return;
    resetInterruptFeedback();
    setSendPhase("sending");
    setSendError(undefined);
    try {
      await sendAgentMessage(service, agent.source_id, text);
      if (!mountedRef.current) return;
      onSent();
      setDraft("");
      setSendPhase("sent");
      isNearBottomRef.current = true;
      setHasNewContent(false);
      await loadHistory();
    } catch (error) {
      if (!mountedRef.current) return;
      setSendPhase("failed");
      setSendError({ code: toErrorCode(error, "send_failed"), status: toErrorStatus(error) });
    }
  }, [agent.source_id, draft, isNearBottomRef, loadHistory, mountedRef, onSent, resetInterruptFeedback, sendPhase, service, setHasNewContent]);

  const interrupt = useCallback(async () => {
    if (interruptPhase === "sending") return;
    Alert.alert(
      t("detail.interruptConfirm.title"),
      t("detail.interruptConfirm.body"),
      [
        { text: t("detail.interruptConfirm.cancel"), style: "cancel" },
        {
          text: t("detail.interruptConfirm.confirm"),
          style: "destructive",
          onPress: async () => {
            setSendPhase("idle");
            setSendError(undefined);
            setInterruptPhase("sending");
            setInterruptError(undefined);
            try {
              await interruptAgent(service, agent.source_id);
              if (!mountedRef.current) return;
              setInterruptPhase("sent");
              await loadHistory();
            } catch (error) {
              if (!mountedRef.current) return;
              setInterruptPhase("failed");
              setInterruptError({ code: toErrorCode(error, "interrupt_failed"), status: toErrorStatus(error) });
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [agent.source_id, interruptPhase, loadHistory, mountedRef, service, t]);

  return {
    // Keep the combined action in its danger/interrupt presentation while the
    // request is pending; the button itself handles the temporary disabled state.
    canInterrupt: agent.interaction_state === "working",
    canSend: draft.trim().length > 0 && sendPhase !== "sending",
    draft,
    interrupt,
    interruptError,
    interruptPhase,
    resetInterruptFeedback,
    send,
    sendError,
    sendPhase,
    setDraft,
    setSendPhase,
  };
}

/**
 * Shared agent-detail body: transcript + composer + the send/interrupt state
 * machine. It owns no navigation and reads no header-height context, so it runs
 * identically inside a native-stack screen (narrow) and inside a split-view
 * column (wide).
 *
 * The wide header is delegated through {@link renderHeader}; the narrow header
 * receives only the current refresh action through {@link refreshRef}.
 */
export function AgentDetailBody({
  agent,
  service,
  keyboardOffsetExtra,
  renderHeader,
  refreshRef,
}: {
  agent: Agent;
  service: DiscoveredService;
  /** Extra height to subtract from the keyboard offset (persistent switcher strip / inline header height). */
  keyboardOffsetExtra: number;
  /** Renders the header chrome for the current mode; receives the live title/subtitle/refresh. */
  renderHeader: (config: AgentDetailHeaderConfig) => ReactNode;
  /** Lets the narrow native-stack header trigger this body's current refresh action. */
  refreshRef?: React.RefObject<(() => void) | null>;
}) {
  const styles = useThemedStyles(createStyles);
  const {
    hasNewContent,
    history,
    isNearBottomRef,
    loadError,
    loadHistory,
    loadPhase,
    mountedRef,
    positionedHistoryRef,
    scrollRef,
    setHasNewContent,
  } = useAgentHistory(agent, service);
  const playSentSound = useSentSound();
  const {
    canInterrupt,
    canSend,
    draft,
    interrupt,
    interruptError,
    interruptPhase,
    resetInterruptFeedback,
    send,
    sendError,
    sendPhase,
    setDraft,
    setSendPhase,
  } = useAgentMessaging({
    agent,
    isNearBottomRef,
    loadHistory,
    mountedRef,
    service,
    setHasNewContent,
    onSent: playSentSound,
  });

  const title = agent.workspace_label || agent.display_name || "Agent";
  const subtitle = [agent.tab_label, agent.agent_name].filter(Boolean).join(" · ");
  const refresh = useCallback(() => void loadHistory(true), [loadHistory]);

  useLayoutEffect(() => {
    if (!refreshRef) return;
    refreshRef.current = refresh;
    return () => {
      refreshRef.current = null;
    };
  }, [refresh, refreshRef]);

  // Voice input shares the draft state; the recognizer streams partial results
  // into the TextInput value WITHOUT focusing it, so the keyboard stays hidden.
  const inputRef = useRef<TextInput>(null);

  // ═══ Continuous voice orchestrator (useReducer state machine) ═══
  const [continuousMode, setContinuousMode] = useMMKVBoolean(
    AUTO_SEND_VOICE_KEY,
    notificationStorage,
  );
  const continuousEnabled = continuousMode ?? DEFAULT_AUTO_SEND_VOICE;
  const [voiceModeNotice, setVoiceModeNotice] = useState<VoiceModeNotice | null>(null);
  const voiceModeNoticeIdRef = useRef(0);
  const dismissVoiceModeNotice = useCallback((id: number) => {
    setVoiceModeNotice((current) => (current?.id === id ? null : current));
  }, []);
  const showVoiceModeNotice = useCallback((kind: VoiceModeNotice["kind"]) => {
    voiceModeNoticeIdRef.current += 1;
    setVoiceModeNotice({ kind, id: voiceModeNoticeIdRef.current });
  }, []);
  const [cState, dispatch] = useReducer(cReducer, INITIAL_STATE);
  const cPhase = cState.phase;
  const countdown = cState.countdown;

  // Refs for timers and voice hook access (declared before effects).
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const voiceToggleRef = useRef<() => void>(() => {});
  const voiceResetDraftRefsRef = useRef<(to?: string) => void>(() => {});
  const { choice: storedVoiceChoice } = useVoiceLanguage();
  const voiceChoiceRef = useRef(storedVoiceChoice);
  voiceChoiceRef.current = storedVoiceChoice;

  // userStoppedRef stays in useVoiceInput — the orchestrator no longer needs
  // its own copy. The voice hook tells us about intentional stops via
  // onVoiceEnd(true), and the reducer handles the phase transition.

  const cancelAllTimers = useCallback(() => {
    if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = undefined; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = undefined; }
  }, []);

  // ── Effects: one per concern, driven purely by cState ──

  // Rule 1 (idle→listening): user start triggers voice.toggleVoice() in
  // handleMicPress; this effect just starts the silence timer once we land
  // in "listening".
  // Rule 2: silence detection — only fires if countdown != null (which the
  // reducer only sets to 3 when entering countingDown).
  useEffect(() => {
    if (!continuousEnabled || cPhase !== "listening") return;
    const threshold = silenceThresholdStorage.read();
    const recurring = setInterval(() => {
      if (draft.trim().length > 0 && Date.now() - cState.lastActivityAt >= threshold) {
        dispatch({ type: "SILENCE_DETECTED" });
      }
    }, threshold);
    silenceTimerRef.current = recurring;
    return () => {
      clearInterval(recurring);
      silenceTimerRef.current = undefined;
    };
  }, [continuousEnabled, cPhase, cState.lastActivityAt, draft]);

  // Rule 3/4: countdown → tick every 1s; when it hits 0, stop engine & send.
  useEffect(() => {
    if (!continuousEnabled || cPhase !== "countingDown") return;
    if (countdown !== null && countdown <= 0) {
      cancelAllTimers();
      // Rule 4: stop engine + clear refs SYNCHRONOUSLY, then fire-and-forget send.
      voiceResetDraftRefsRef.current();
      voiceToggleRef.current(); // listening=true → stop() → userStoppedRef=true → end → onVoiceEnd(true)
      dispatch({ type: "COUNTDOWN_DONE" });
      // Read draft via ref to avoid adding it to the effect's dependency
      // array — we want the interval to keep ticking without being torn down
      // by unrelated draft changes.
      const text = draft.trim();
      if (text.length > 0) {
        resetInterruptFeedback();
        void (async () => {
          try {
            await sendAgentMessage(service, agent.source_id, text);
            if (!mountedRef.current) return;
            playSentSound();
            setDraft("");
            setSendPhase("sent");
            isNearBottomRef.current = true;
            setHasNewContent(false);
            await loadHistory();
          } catch (_err) { /* fall through */ }
        })();
      }
      return;
    }
    countdownTimerRef.current = setInterval(() => {
      dispatch({ type: "COUNTDOWN_TICK" });
    }, 1000);
    return () => {
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = undefined; }
    };
  }, [agent.source_id, cancelAllTimers, continuousEnabled, countdown, cPhase, draft, isNearBottomRef, loadHistory, mountedRef, playSentSound, resetInterruptFeedback, service, setDraft, setHasNewContent, setSendPhase]);

  // Rule 5: agent state watcher for "waitingForAgent".
  const interactionState = agent.interaction_state;
  useEffect(() => {
    if (!continuousEnabled || cPhase !== "waitingForAgent") return;
    if (interactionState === "working") {
      dispatch({ type: "AGENT_WORKING" });
    } else if (isContinuousVoiceAgentReady(interactionState)) {
      dispatch({ type: "AGENT_READY" });
    }
  }, [continuousEnabled, cPhase, interactionState]);

  // When we (re-)enter "listening" (either from idle-start or from
  // waitingForAgent→listening), restart the voice engine.
  const prevPhaseRef = useRef<CPhase>("idle");
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = cPhase;
    if (!continuousEnabled) return;
    if (cPhase === "listening" && prev !== "listening") {
      // The engine may already be running (idle→listening via handleMicPress
      // already called toggleVoice). Only restart if coming from waitingForAgent.
      if (prev === "waitingForAgent") {
        voiceToggleRef.current(); // listening=false → start()
      }
    }
    // Do not clear timers merely because the phase is not listening:
    // countingDown owns an active interval. Each timer-producing effect
    // cleans up its own timer when its phase changes.
  }, [continuousEnabled, cPhase]);

  // Rule 7: unmount → full cleanup (voice hook unmount effect handles engine stop).
  useEffect(() => () => { cancelAllTimers(); dispatch({ type: "RESET" }); }, [cancelAllTimers]);

  // ── Callbacks bridging voice hook ↔ reducer ──

  // Every recognition result → update silence timestamp + abort countdown.
  const handleResultActivity = useCallback(() => {
    dispatch({ type: "RESULT_ACTIVITY", at: Date.now() });
  }, []);

  // Voice hook end event. userStopped=true only when voice.toggleVoice()
  // called stop() (the only path that sets userStoppedRef in the hook).
  // The reducer ignores system auto-ends (userStopped=false) — the voice
  // hook's own auto-restart logic handles those.
  const handleVoiceEnd = useCallback((userStopped: boolean) => {
    if (!continuousEnabled) return;
    if (!userStopped) return;
    // The engine was stopped intentionally. If the stop wasn't preceded by a
    // COUNTDOWN_DONE or USER_STOP dispatch (e.g. no-speech or permission
    // denied while listening), exit to idle now.
    cancelAllTimers();
    if (cPhase === "listening" || cPhase === "countingDown") {
      dispatch({ type: "USER_STOP" });
    }
  }, [continuousEnabled, cancelAllTimers, cPhase]);

  // ── Voice input hook ─────────────────────────────────────────
  const voice = useVoiceInput({
    draft,
    setDraft,
    inputRef,
    onResultActivity: handleResultActivity,
    onVoiceEnd: handleVoiceEnd,
  });

  // Must be after voice + cancelAllTimers so it can reference both.
  const stopContinuousSession = useCallback(() => {
    dispatch({ type: "USER_STOP" });
    cancelAllTimers();
    if (voice.listening) {
      void voice.toggleVoice(); // stop engine via proper path
    }
  }, [cancelAllTimers, voice]);

  const handleMicPress = useCallback(() => {
    const action = actionForMicPress({
      continuousEnabled,
      phase: cPhase,
      listening: voice.listening,
    });
    if (action === "startContinuousSession") {
      dispatch({ type: "USER_START" });
      void voice.toggleVoice(); // listening=false → start()
    } else if (action === "stopContinuousSession") {
      stopContinuousSession();
    } else {
      // Starts or stops a manual recording. Stopping preserves the recognized
      // draft for review, including a recording that began before mode changed.
      void voice.toggleVoice();
    }
  }, [continuousEnabled, cPhase, stopContinuousSession, voice]);

  const handleContinuousModePress = useCallback(() => {
    void Haptics.selectionAsync().catch((error) => {
      console.warn("[voice] mode-selection haptic failed:", error);
    });

    const action = actionForContinuousModePress({
      continuousEnabled,
      listening: voice.listening,
    });
    if (sendPhase === "sent") setSendPhase("idle");
    if (action === "enableContinuousMode") {
      // Selecting a mode never starts recognition or sends an existing draft.
      setContinuousMode(true);
      showVoiceModeNotice("enabled");
      return;
    }

    setContinuousMode(false);
    showVoiceModeNotice("disabled");
    dispatch({ type: "USER_STOP" });
    cancelAllTimers();
    if (action === "disableContinuousModeAndStop") {
      void voice.toggleVoice();
    }
  }, [cancelAllTimers, continuousEnabled, sendPhase, setContinuousMode, setSendPhase, showVoiceModeNotice, voice]);

  // Backfill the refs for the effects that run before voice is declared.
  voiceToggleRef.current = voice.toggleVoice;
  voiceResetDraftRefsRef.current = voice.resetDraftRefs;

  const headerConfig: AgentDetailHeaderConfig = { title, subtitle, onRefresh: refresh };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={keyboardOffsetExtra}
      style={styles.screen}
    >
      {renderHeader(headerConfig)}
      <AgentHistorySection
        hasNewContent={hasNewContent}
        history={history}
        isNearBottomRef={isNearBottomRef}
        loadError={loadError}
        loadPhase={loadPhase}
        positionedHistoryRef={positionedHistoryRef}
        scrollRef={scrollRef}
        setHasNewContent={setHasNewContent}
      />
      <AgentComposer
        canInterrupt={canInterrupt}
        canSend={canSend}
        countdown={countdown}
        cPhase={cPhase}
        continuousEnabled={continuousEnabled}
        draft={draft}
        handleContinuousModePress={handleContinuousModePress}
        handleMicPress={handleMicPress}
        inputRef={inputRef}
        interrupt={interrupt}
        interruptError={interruptError}
        interruptPhase={interruptPhase}
        send={send}
        sendError={sendError}
        sendPhase={sendPhase}
        setDraft={setDraft}
        setSendPhase={setSendPhase}
        voice={voice}
        voiceModeNotice={voiceModeNotice}
        onVoiceModeNoticeDismiss={dismissVoiceModeNotice}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * Presentational title/subtitle block, shared by the narrow native-stack header
 * (as `headerTitle`) and the wide inline header view so the two can never drift.
 */
export function AgentDetailTitleBlock({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.identity}>
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/** Refresh affordance shared by both header modes. */
export function AgentDetailRefreshButton({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("detail.refreshA11y")}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Ionicons name="refresh" size={ICON_SIZE} color={colors.accent} />
    </Pressable>
  );
}

export function AgentDetailScreen({ route, navigation }: Props) {
  const { state, switchAgent } = useConnection();
  const { clearCompleted } = useRecentCompletions();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const headerHeight = useHeaderHeight();
  const service = state.phase === "connected" ? state.service : undefined;
  const agents = state.phase === "connected" ? state.data.agents : [];
  // Prefer the live snapshot of the routed agent so the header and switcher
  // reflect fresh state; fall back to the route param until the next poll.
  const paramAgent = route.params.agent;
  const agent = agents.find((candidate) => candidate.source_id === paramAgent.source_id) ?? paramAgent;
  const [switcherHeight, setSwitcherHeight] = useState(0);
  const bodyRefreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!service && navigation.canGoBack()) navigation.goBack();
  }, [navigation, service]);

  // Switching in place: update the route param (keeps notify-while-viewing
  // accurate), focus the desktop, and let the key-remount reset local state.
  const selectAgent = useCallback(
    (next: Agent) => {
      if (!service || next.source_id === agent.source_id) return;
      clearCompleted([next.source_id]);
      navigation.setParams({ agent: next });
      void switchAgent(service, next);
    },
    [agent.source_id, clearCompleted, navigation, service, switchAgent],
  );

  const title = agent.workspace_label || agent.display_name || "Agent";
  const subtitle = [agent.tab_label, agent.agent_name].filter(Boolean).join(" · ");
  const refreshBody = useCallback(() => bodyRefreshRef.current?.(), []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackTitle: t("detail.back"),
      headerTitle: () => <AgentDetailTitleBlock title={title} subtitle={subtitle} />,
      headerRight: () => <AgentDetailRefreshButton onPress={refreshBody} />,
    });
  }, [navigation, refreshBody, subtitle, t, title]);

  if (!service) return null;
  // The switcher lives outside the keyed subtree so it survives switches
  // without flicker; only the history/composer state below it resets.
  return (
    <View style={styles.screen}>
      {agents.length > 1 ? (
        <View onLayout={(event) => setSwitcherHeight(event.nativeEvent.layout.height)}>
          <AgentSwitcher agents={agents} currentId={agent.source_id} onSelect={selectAgent} />
        </View>
      ) : null}
      <AgentDetailBody
        key={agent.source_id}
        agent={agent}
        service={service}
        keyboardOffsetExtra={headerHeight + switcherHeight}
        // The narrow mode renders its header in the native-stack bar, not inline.
        renderHeader={() => null}
        refreshRef={bodyRefreshRef}
      />
    </View>
  );
}

function AgentSwitcher({
  agents,
  currentId,
  onSelect,
}: {
  agents: readonly Agent[];
  currentId: string;
  onSelect: (agent: Agent) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { completedIds } = useRecentCompletions();
  const scrollRef = useRef<ScrollView>(null);
  const viewportWidth = useRef(0);
  const chipLayouts = useRef(new Map<string, { x: number; width: number }>());
  const positioned = useRef(false);

  const centerChip = useCallback((id: string, animated: boolean) => {
    const layout = chipLayouts.current.get(id);
    if (!layout || viewportWidth.current === 0) return;
    const target = Math.max(0, layout.x - (viewportWidth.current - layout.width) / 2);
    scrollRef.current?.scrollTo({ x: target, animated });
  }, []);

  // Smoothly follow selection changes; the initial position is set from the
  // selected chip's first onLayout below (layouts aren't known yet on mount).
  useEffect(() => {
    if (positioned.current) centerChip(currentId, true);
  }, [centerChip, currentId]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.switcher}
      contentContainerStyle={styles.switcherContent}
      onLayout={(event) => {
        viewportWidth.current = event.nativeEvent.layout.width;
      }}
    >
      {agents.map((candidate) => {
        const selected = candidate.source_id === currentId;
        const { tone } = agentStatus(candidate, completedIds.has(candidate.source_id));
        const title = candidate.workspace_label || candidate.display_name;
        const label = candidate.tab_label || title;
        return (
          <Pressable
            key={candidate.source_id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={t("agents.row.switchA11y", { title, tab: candidate.tab_label ?? "" })}
            onPress={() => onSelect(candidate)}
            onLayout={(event) => {
              chipLayouts.current.set(candidate.source_id, event.nativeEvent.layout);
              if (selected && !positioned.current) {
                positioned.current = true;
                centerChip(candidate.source_id, false);
              }
            }}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.chipPressed]}
          >
            <View style={[styles.chipDot, { backgroundColor: colors[tone] }]} />
            <AgentBrandIcon
              name={candidate.agent_name}
              size={14}
              color={selected ? colors.textPrimary : colors.textSecondary}
            />
            <Text numberOfLines={1} style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    switcher: { flexGrow: 0 },
    switcherContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, gap: 8 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
    },
    chipSelected: { borderWidth: 1, borderColor: colors.selectedCardBorder, backgroundColor: colors.selectedCard },
    chipPressed: { opacity: 0.7 },
    chipDot: { width: 7, height: 7, borderRadius: 3.5 },
    chipLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", maxWidth: 110 },
    chipLabelSelected: { color: colors.textPrimary },
    identity: { alignItems: "center", maxWidth: 220 },
    title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
    subtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    pressed: { opacity: 0.55 },
    historyHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
    historyTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "700", letterSpacing: -0.35 },
    historyMeta: { color: colors.textSecondary, fontSize: 12 },
    historyFrame: { flex: 1, marginHorizontal: 16 },
    history: { flex: 1, backgroundColor: colors.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    historyContent: { flexGrow: 1, padding: 17, justifyContent: "flex-end" },
    transcript: { color: colors.transcript, fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
    transcriptHeader: { color: colors.textPrimary, fontWeight: "700" },
    transcriptBold: { color: colors.textPrimary, fontWeight: "700" },
    transcriptCode: { backgroundColor: colors.separator },
    newContentButton: { position: "absolute", alignSelf: "center", bottom: 12, minHeight: 34, justifyContent: "center", borderRadius: 17, backgroundColor: colors.actionBg, paddingHorizontal: 15 },
    newContentButtonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
    newContentText: { color: colors.onAction, fontSize: 12, fontWeight: "700" },
    centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36 },
    stateText: { color: colors.textSecondary, fontSize: 13 },
    errorText: { color: colors.danger, fontSize: 13, textAlign: "center" },
    composerArea: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
    composerFeedbackSlot: { height: 34, justifyContent: "flex-start", marginBottom: 6 },
    composerFeedbackText: { marginBottom: 0, lineHeight: 16 },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: colors.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder, padding: 8 },
    inputColumn: { flex: 1, minWidth: 0, minHeight: 44, position: "relative" },
    input: { width: "100%", minHeight: 44, maxHeight: 112, color: colors.textPrimary, fontSize: 15, lineHeight: 20, paddingHorizontal: 8, paddingTop: 9, paddingBottom: 14 },
    voiceWaveformSlot: { position: "absolute", left: 0, right: 0, bottom: 0, height: 13, overflow: "hidden" },
    voiceControl: {
      height: 44,
      flexDirection: "row",
      overflow: "hidden",
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
    },
    voiceControlActive: { borderColor: colors.accent },
    voiceControlSegment: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    voiceMicSegment: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.cardBorder,
    },
    voiceMicSegmentActive: { backgroundColor: colors.selectedCard },
    voiceModeSegment: { backgroundColor: colors.card },
    voiceModeSegmentActive: { backgroundColor: colors.selectedCard },
    voiceButtonText: { fontSize: 16, fontWeight: "700" },
    voiceControlSegmentPressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
    sendButton: { minWidth: 66, height: 44, borderRadius: 14, backgroundColor: colors.actionBg, alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
    sendButtonDisabled: { backgroundColor: colors.actionDisabledBg },
    sendButtonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
    sendButtonText: { color: colors.onAction, fontSize: 14, fontWeight: "700" },
    sendButtonTextDisabled: { color: colors.onActionDisabled },
    composerActionInterrupt: { backgroundColor: colors.danger },
    composerActionInterruptDisabled: { backgroundColor: colors.dangerDisabledBg },
    composerActionInterruptPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
    composerActionInterruptText: { color: colors.onDanger, fontSize: 14, fontWeight: "700" },
    composerActionInterruptTextDisabled: { color: colors.onActionDisabled },
    sendError: { color: colors.danger, fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
    sentText: { color: colors.success, fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
    voiceModeNoticeText: { color: colors.accent, fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
  });
