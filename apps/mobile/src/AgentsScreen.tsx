import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { type DemoAgent, type InteractionState } from "./demo-contract";
import { Ionicons } from "./icons";
import { useConnection, type FocusPhase } from "./connection";
import { useI18n } from "./i18n/I18nContext";
import type { MessageKey } from "./i18n/messages";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ScreenHeader } from "./ScreenHeader";
import type { RootStackParamList } from "./navigation";

function interactionKey(state: InteractionState): MessageKey {
  switch (state) {
    case "working":
      return "interaction.working";
    case "blocked":
      return "interaction.blocked";
    case "ready_input":
      return "interaction.ready_input";
    case "unknown":
      return "interaction.unknown";
  }
}

const FOCUS_FEEDBACK: Record<FocusPhase, { textKey: MessageKey; icon?: "checkmark-circle" | "alert-circle"; color?: "success" | "danger" }> = {
  switching: { textKey: "agents.focus.switching" },
  switched: { textKey: "agents.focus.switched", icon: "checkmark-circle", color: "success" },
  failed: { textKey: "agents.focus.failed", icon: "alert-circle", color: "danger" },
};

function AgentRow({ agent, focusPhase, onPress }: { agent: DemoAgent; focusPhase?: FocusPhase; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const title = agent.workspace_label || agent.display_name || t("agents.row.unnamed");
  const feedback = focusPhase ? FOCUS_FEEDBACK[focusPhase] : undefined;
  const feedbackColor = feedback?.color ? colors[feedback.color] : undefined;
  const switchA11y = t("agents.row.switchA11y", { title, tab: agent.tab_label ?? "" });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={switchA11y}
      onPress={onPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.agentCardPressed, focusPhase === "switched" && styles.agentCardSelected]}
    >
      <View style={styles.agentHeading}>
        <Text numberOfLines={1} style={styles.agentName}>{title}</Text>
        {agent.tab_label ? <Text numberOfLines={1} style={styles.tabName}>{agent.tab_label}</Text> : null}
      </View>
      {agent.agent_name || feedback ? (
        <View style={styles.agentKindRow}>
          {agent.agent_name ? <Text style={styles.agentKind}>{agent.agent_name}</Text> : null}
          {agent.agent_name && feedback ? <Text style={styles.agentKind}> · </Text> : null}
          {feedback?.icon ? <Ionicons name={feedback.icon} size={13} color={feedbackColor} style={styles.feedbackIcon} /> : null}
          {feedback ? <Text style={[styles.agentKind, feedbackColor != null && { color: feedbackColor }]}>{t(feedback.textKey)}</Text> : null}
        </View>
      ) : null}
      <View style={styles.agentFacts}>
        <Text style={styles.factLabel}>{t("agents.fact.interaction")}</Text>
        <Text style={styles.factValue}>{t(interactionKey(agent.interaction_state))}</Text>
      </View>
    </Pressable>
  );
}

export function AgentsScreen() {
  const { state, focusResult, refresh, switchAgent } = useConnection();
  const { t, tError, formatTime } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const connected = state.phase === "connected" ? state : undefined;
  const statusTitleKey: MessageKey =
    state.phase === "discovering"
      ? "agents.status.discovering"
      : state.phase === "not_found"
        ? "agents.status.notFound"
        : state.phase === "failed"
          ? "agents.status.failed"
          : "agents.status.connected";
  const statusDetail =
    state.phase === "discovering"
      ? t("agents.detail.discovering")
      : state.phase === "not_found"
        ? t("agents.detail.notFound")
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
                  onPress={() => {
                    navigation.navigate("AgentDetail", { agent: item });
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
    summaryRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
    sectionTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "700" },
    summaryText: { color: colors.textSecondary, fontSize: 12 },
    list: { paddingBottom: 28, gap: 10 },
    emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { color: colors.textSecondary, fontSize: 15 },
    agentCard: { backgroundColor: colors.card, borderRadius: 18, padding: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    agentCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
    agentCardSelected: { borderColor: colors.selectedCardBorder, backgroundColor: colors.selectedCard },
    agentHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    agentName: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", flex: 1 },
    tabName: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginLeft: 14, maxWidth: "46%" },
    agentKindRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
    agentKind: { color: colors.textSecondary, fontSize: 13 },
    feedbackIcon: { marginRight: 3 },
    agentFacts: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 15 },
    factLabel: { color: colors.textMuted, fontSize: 12 },
    factValue: { color: colors.textPrimary, fontSize: 12, fontWeight: "600", marginRight: 8 },
    placeholder: { marginTop: 62, paddingHorizontal: 25, alignItems: "center" },
    placeholderTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 8 },
    placeholderText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
  });
