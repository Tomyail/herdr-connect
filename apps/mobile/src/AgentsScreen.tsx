import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { type Agent } from "./agent-contract";
import { agentStatus } from "./agent-status";
import { AgentBrandIcon } from "./AgentBrandIcon";
import { Ionicons } from "./icons";
import { useConnection, type FocusPhase } from "./connection";
import { useRecentCompletions } from "./notifications/RecentCompletions";
import { useI18n } from "./i18n/I18nContext";
import type { MessageKey } from "./i18n/messages";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ScreenHeader } from "./ScreenHeader";
import type { RootStackParamList } from "./navigation";

// Status text/tone mapping lives in agent-status.ts, shared with AgentDetail's switcher.

const FOCUS_FEEDBACK: Record<FocusPhase, { textKey: MessageKey; icon?: "checkmark-circle" | "alert-circle"; color?: "success" | "danger" }> = {
  switching: { textKey: "agents.focus.switching" },
  switched: { textKey: "agents.focus.switched", icon: "checkmark-circle", color: "success" },
  failed: { textKey: "agents.focus.failed", icon: "alert-circle", color: "danger" },
};

function StatusPill({ agent, justCompleted }: { agent: Agent; justCompleted: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { textKey, tone } = agentStatus(agent, justCompleted);
  const color = colors[tone];
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1F` }]}>
      <View style={[styles.statusPillDot, { backgroundColor: color }]} />
      <Text style={[styles.statusPillText, { color }]}>{t(textKey)}</Text>
    </View>
  );
}

function AgentRow({
  agent,
  focusPhase,
  justCompleted,
  selected,
  onPress,
}: {
  agent: Agent;
  focusPhase?: FocusPhase;
  justCompleted: boolean;
  /** Wide split layout only: this row is the one currently shown in the detail column. */
  selected?: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const title = agent.workspace_label || agent.display_name || t("agents.row.unnamed");
  const feedback = focusPhase ? FOCUS_FEEDBACK[focusPhase] : undefined;
  const feedbackColor = feedback?.color ? colors[feedback.color] : undefined;
  const switchA11y = t("agents.row.switchA11y", { title, tab: agent.tab_label ?? "" });
  const a11yLabel = justCompleted ? `${switchA11y}, ${t("agents.row.justCompleted")}` : switchA11y;
  // Persistent selection (wide layout) and the transient "just switched" feedback
  // are independent and compose: a row can be the selected one AND briefly show
  // the switched/switching/failed feedback at the same time.
  const highlighted = selected || focusPhase === "switched";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.agentCardPressed, highlighted && styles.agentCardSelected]}
    >
      <View style={styles.agentAvatar}>
        <AgentBrandIcon name={agent.agent_name} size={20} color={colors.textPrimary} />
        {justCompleted ? <View style={styles.completedBadge} /> : null}
      </View>
      <View style={styles.agentBody}>
        <View style={styles.agentHeading}>
          <Text numberOfLines={1} style={styles.agentName}>{title}</Text>
          <StatusPill agent={agent} justCompleted={justCompleted} />
        </View>
        {agent.tab_label || feedback ? (
          <View style={styles.agentSubtitleRow}>
            {agent.tab_label ? <Text numberOfLines={1} style={styles.tabName}>{agent.tab_label}</Text> : null}
            {feedback?.icon ? <Ionicons name={feedback.icon} size={13} color={feedbackColor} /> : null}
            {feedback ? <Text style={[styles.feedbackText, feedbackColor != null && { color: feedbackColor }]}>{t(feedback.textKey)}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Reusable agent-list content. Takes a resolved `onAgentPress` callback so it
 * has no navigation dependency and renders identically inside the narrow
 * bottom-tab shell (where the wrapper pushes `AgentDetail`) and inside the
 * wide split-view list column (where the wrapper updates shared selection).
 *
 * `selectedAgentId` is only meaningful in the wide layout (the detail column
 * shows one agent persistently); the narrow wrapper has no such concept and
 * leaves it undefined so no row gets a persistent selected treatment there.
 */
export function AgentsScreenContent({
  onAgentPress,
  selectedAgentId,
}: {
  onAgentPress: (agent: Agent) => void;
  selectedAgentId?: string;
}) {
  const { state, focusResult, refresh, switchAgent, streamStatus } = useConnection();
  const { completedIds, clearCompleted } = useRecentCompletions();
  const { t, tError, formatTime } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const connected = state.phase === "connected" ? state : undefined;
  const statusTitleKey: MessageKey =
    state.phase === "discovering"
      ? "agents.status.discovering"
      : state.phase === "not_found"
        ? "agents.status.notFound"
        : state.phase === "not_paired"
          ? "agents.status.notPaired"
          : state.phase === "revoked"
            ? "agents.status.revoked"
            : state.phase === "fingerprint_mismatch"
              ? "agents.status.fingerprintMismatch"
              : state.phase === "daemon_outdated"
                ? "agents.status.daemonOutdated"
                : state.phase === "app_outdated"
                  ? "agents.status.appOutdated"
                  : state.phase === "failed"
                    ? "agents.status.failed"
                    : "agents.status.connected";
  const statusDetail =
    state.phase === "discovering"
      ? t("agents.detail.discovering")
      : state.phase === "not_found"
        ? t("agents.detail.notFound")
        : state.phase === "not_paired"
          ? t("agents.detail.notPaired")
          : state.phase === "revoked"
            ? t("agents.detail.revoked")
            : state.phase === "fingerprint_mismatch"
              ? t("agents.detail.fingerprintMismatch")
              : state.phase === "daemon_outdated"
                ? t("agents.detail.daemonOutdated")
                : state.phase === "app_outdated"
                  ? t("agents.detail.appOutdated")
                  : state.phase === "failed"
                    ? tError(state.code, { status: state.status })
                    : `${state.data.source_name} · ${state.service.name}`;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader
          title={t("agents.screenTitle")}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agents.refreshA11y")}
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.buttonPressed]}
            >
              <Ionicons name="refresh" size={20} color={colors.onAction} />
            </Pressable>
          }
        />

        <View style={[styles.statusCard, connected && styles.statusConnected]}>
          <View style={[styles.statusDot, connected && styles.statusDotConnected]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{t(statusTitleKey)}</Text>
            <Text style={styles.statusDetail}>{statusDetail}</Text>
          </View>
          {state.phase === "discovering" ? <ActivityIndicator color={colors.spinner} /> : null}
          {connected ? (
            <Text style={[styles.streamPill, streamStatus === "live" ? styles.streamPillLive : styles.streamPillPolling]}>
              {streamStatus === "live" ? t("connection.live") : t("connection.polling")}
            </Text>
          ) : null}
        </View>

        {connected ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.sectionTitle}>{t("tab.agents")}</Text>
              <Text style={styles.summaryText}>
                {connected.data.source_online ? t("agents.summary.sourceOnline") : t("agents.summary.sourceOffline")} · {t("agents.summary.count", { count: connected.data.agents.length })} · {formatTime(connected.data.refreshed_at)}
              </Text>
            </View>
            <FlatList
              data={connected.data.agents}
              keyExtractor={(agent) => agent.source_id}
              renderItem={({ item }) => (
                <AgentRow
                  agent={item}
                  focusPhase={focusResult?.sourceID === item.source_id ? focusResult.phase : undefined}
                  justCompleted={completedIds.has(item.source_id)}
                  selected={selectedAgentId === item.source_id}
                  onPress={() => {
                    clearCompleted([item.source_id]);
                    onAgentPress(item);
                    void switchAgent(connected.service, item);
                  }}
                />
              )}
              contentContainerStyle={
                connected.data.agents.length === 0 ? styles.emptyList : styles.list
              }
              ListEmptyComponent={<Text style={styles.emptyText}>{t("agents.empty")}</Text>}
              showsVerticalScrollIndicator={false}
            />
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>{t("agents.placeholder.title")}</Text>
            <Text style={styles.placeholderText}>{t("agents.placeholder.text")}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/** Narrow-mode screen: pushes `AgentDetail` onto the root stack when a row is tapped. */
export function AgentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onAgentPress = useCallback(
    (agent: Agent) => navigation.navigate("AgentDetail", { agent }),
    [navigation],
  );
  return <AgentsScreenContent onAgentPress={onAgentPress} />;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
    refreshButton: { backgroundColor: colors.actionBg, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    buttonPressed: { opacity: 0.72 },
    statusCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.statusCard, borderRadius: 18, padding: 16, marginBottom: 28 },
    statusConnected: { backgroundColor: colors.statusCardConnected },
    statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.statusDot, marginRight: 12 },
    statusDotConnected: { backgroundColor: colors.statusDotConnected },
    statusCopy: { flex: 1 },
    statusTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 3 },
    statusDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    streamPill: { fontSize: 11, fontWeight: "700", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, overflow: "hidden", letterSpacing: 0.2 },
    streamPillLive: { color: colors.success, backgroundColor: colors.statusCard },
    streamPillPolling: { color: colors.textSecondary, backgroundColor: colors.statusCard },
    summaryRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
    sectionTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "700" },
    summaryText: { color: colors.textSecondary, fontSize: 12 },
    list: { paddingBottom: 28, gap: 10 },
    emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { color: colors.textSecondary, fontSize: 15 },
    agentCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    agentCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
    agentCardSelected: { borderColor: colors.selectedCardBorder, backgroundColor: colors.selectedCard },
    agentAvatar: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.separator, alignItems: "center", justifyContent: "center" },
    completedBadge: { position: "absolute", top: -3, right: -3, width: 11, height: 11, borderRadius: 5.5, backgroundColor: colors.statusDotConnected, borderWidth: 2, borderColor: colors.card },
    agentBody: { flex: 1 },
    agentHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    agentName: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", flexShrink: 1 },
    agentSubtitleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
    tabName: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
    feedbackText: { color: colors.textSecondary, fontSize: 12 },
    statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3.5 },
    statusPillDot: { width: 6, height: 6, borderRadius: 3 },
    statusPillText: { fontSize: 11, fontWeight: "600" },
    placeholder: { marginTop: 62, paddingHorizontal: 25, alignItems: "center" },
    placeholderTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 8 },
    placeholderText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
  });
