import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import type { Service } from "@inthepocket/react-native-service-discovery";

import type { DemoAgent } from "./demo-contract";
import {
  fetchDemoAgentHistory,
  sendDemoAgentMessage,
  type DemoAgentHistory,
} from "./network";
import { useConnection } from "./connection";
import { useRecentCompletions } from "./notifications/RecentCompletions";
import { useI18n } from "./i18n/I18nContext";
import { toErrorCode, toErrorStatus, type NetworkErrorCode } from "./i18n/errors";
import { agentStatus } from "./agent-status";
import { AgentBrandIcon } from "./AgentBrandIcon";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ICON_SIZE, Ionicons } from "./icons";
import type { RootStackParamList } from "./navigation";

const HISTORY_REFRESH_MS = 2_000;

type LoadPhase = "loading" | "ready" | "failed";
type SendPhase = "idle" | "sending" | "sent" | "failed";

type Props = NativeStackScreenProps<RootStackParamList, "AgentDetail">;

interface Failure {
  code: NetworkErrorCode;
  status?: number;
}

export function AgentDetailScreen({ route, navigation }: Props) {
  const { state, switchAgent } = useConnection();
  const { clearCompleted } = useRecentCompletions();
  const styles = useThemedStyles(createStyles);
  const service = state.phase === "connected" ? state.service : undefined;
  const agents = state.phase === "connected" ? state.data.agents : [];
  // Prefer the live snapshot of the routed agent so the header and switcher
  // reflect fresh state; fall back to the route param until the next poll.
  const paramAgent = route.params.agent;
  const agent = agents.find((candidate) => candidate.source_id === paramAgent.source_id) ?? paramAgent;
  const [switcherHeight, setSwitcherHeight] = useState(0);

  useEffect(() => {
    if (!service && navigation.canGoBack()) navigation.goBack();
  }, [navigation, service]);

  // Switching in place: update the route param (keeps notify-while-viewing
  // accurate), focus the desktop, and let the key-remount reset local state.
  const selectAgent = useCallback(
    (next: DemoAgent) => {
      if (!service || next.source_id === agent.source_id) return;
      clearCompleted([next.source_id]);
      navigation.setParams({ agent: next });
      void switchAgent(service, next);
    },
    [agent.source_id, clearCompleted, navigation, service, switchAgent],
  );

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
      <AgentDetail
        key={agent.source_id}
        agent={agent}
        service={service}
        navigation={navigation}
        keyboardOffsetExtra={switcherHeight}
      />
    </View>
  );
}

function AgentSwitcher({
  agents,
  currentId,
  onSelect,
}: {
  agents: readonly DemoAgent[];
  currentId: string;
  onSelect: (agent: DemoAgent) => void;
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

function AgentDetail({
  agent,
  service,
  navigation,
  keyboardOffsetExtra,
}: {
  agent: DemoAgent;
  service: Service;
  navigation: Props["navigation"];
  /** Height of the persistent switcher strip above this subtree. */
  keyboardOffsetExtra: number;
}) {
  const { t, tError } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [history, setHistory] = useState<DemoAgentHistory>();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadError, setLoadError] = useState<Failure>();
  const [draft, setDraft] = useState("");
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendError, setSendError] = useState<Failure>();
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);
  const headerHeight = useHeaderHeight();

  const loadHistory = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadPhase("loading");
    try {
      const next = await fetchDemoAgentHistory(service, agent.source_id);
      if (!mountedRef.current) return;
      setHistory(next);
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

  const title = agent.workspace_label || agent.display_name || "Agent";
  const subtitle = [agent.tab_label, agent.agent_name].filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackTitle: t("detail.back"),
      headerTitle: () => (
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ),
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("detail.refreshA11y")}
          hitSlop={10}
          onPress={() => void loadHistory(true)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="refresh" size={ICON_SIZE} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [colors, loadHistory, navigation, styles, subtitle, t, title]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendPhase === "sending") return;
    setSendPhase("sending");
    setSendError(undefined);
    try {
      await sendDemoAgentMessage(service, agent.source_id, text);
      if (!mountedRef.current) return;
      setDraft("");
      setSendPhase("sent");
      await loadHistory();
    } catch (error) {
      if (!mountedRef.current) return;
      setSendPhase("failed");
      setSendError({ code: toErrorCode(error, "send_failed"), status: toErrorStatus(error) });
    }
  }, [agent.source_id, draft, loadHistory, sendPhase, service]);

  const canSend = draft.trim().length > 0 && sendPhase !== "sending";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight + keyboardOffsetExtra}
      style={styles.screen}
    >
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>{t("detail.historyTitle")}</Text>
        <Text style={styles.historyMeta}>
          {history?.truncated ? t("detail.historyMeta.truncated") : t("detail.historyMeta.recent")}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.historyContent}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
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
          <Text selectable style={styles.transcript}>
            {history?.text || t("detail.emptyHistory")}
          </Text>
        )}
      </ScrollView>

      <View style={styles.composerArea}>
        {sendPhase === "failed" && sendError ? <Text style={styles.sendError}>{tError(sendError.code, { status: sendError.status })}</Text> : null}
        {sendPhase === "sent" ? <Text style={styles.sentText}>{t("detail.sentToDesktop")}</Text> : null}
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel={t("detail.inputA11y")}
            blurOnSubmit={false}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("detail.sendA11y")}
            disabled={!canSend}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendButtonDisabled,
              pressed && canSend && styles.sendButtonPressed,
            ]}
          >
            {sendPhase === "sending" ? (
              <ActivityIndicator color={colors.onAction} size="small" />
            ) : (
              <Text style={[styles.sendButtonText, !canSend && styles.sendButtonTextDisabled]}>{t("detail.send")}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
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
    history: { flex: 1, marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    historyContent: { flexGrow: 1, padding: 17, justifyContent: "flex-end" },
    transcript: { color: colors.transcript, fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
    centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36 },
    stateText: { color: colors.textSecondary, fontSize: 13 },
    errorText: { color: colors.danger, fontSize: 13, textAlign: "center" },
    composerArea: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: colors.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder, padding: 8 },
    input: { flex: 1, minHeight: 40, maxHeight: 112, color: colors.textPrimary, fontSize: 15, lineHeight: 20, paddingHorizontal: 8, paddingVertical: 9 },
    sendButton: { minWidth: 66, height: 40, borderRadius: 14, backgroundColor: colors.actionBg, alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
    sendButtonDisabled: { backgroundColor: colors.actionDisabledBg },
    sendButtonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
    sendButtonText: { color: colors.onAction, fontSize: 14, fontWeight: "700" },
    sendButtonTextDisabled: { color: colors.onActionDisabled },
    sendError: { color: colors.danger, fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
    sentText: { color: colors.success, fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
  });
