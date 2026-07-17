import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { interactionStateLabel, turnOutcomeLabel, type DemoAgent } from "./demo-contract";
import { useConnection, type FocusPhase } from "./connection";
import { ScreenHeader } from "./ScreenHeader";
import type { RootStackParamList } from "./navigation";

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function AgentRow({ agent, focusPhase, onPress }: { agent: DemoAgent; focusPhase?: FocusPhase; onPress: () => void }) {
  const title = agent.workspace_label || agent.display_name || "未命名 Agent";
  const agentDetail = [
    agent.agent_name,
    focusPhase === "switching" ? "切换中…" : focusPhase === "switched" ? "已切换" : focusPhase === "failed" ? "切换失败" : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`切换到 ${title}${agent.tab_label ? ` ${agent.tab_label}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.agentCardPressed, focusPhase === "switched" && styles.agentCardSelected]}
    >
      <View style={styles.agentHeading}>
        <Text numberOfLines={1} style={styles.agentName}>{title}</Text>
        {agent.tab_label ? <Text numberOfLines={1} style={styles.tabName}>{agent.tab_label}</Text> : null}
      </View>
      {agentDetail ? <Text style={[styles.agentKind, focusPhase === "failed" && styles.agentKindFailed]}>{agentDetail}</Text> : null}
      <View style={styles.agentFacts}>
        <Text style={styles.factLabel}>交互状态</Text>
        <Text style={styles.factValue}>{interactionStateLabel(agent.interaction_state)}</Text>
        <Text style={styles.factLabel}>回合结果</Text>
        <Text style={styles.factValue}>{turnOutcomeLabel(agent.turn_outcome)}</Text>
      </View>
    </Pressable>
  );
}

export function AgentsScreen() {
  const { state, focusResult, refresh, switchAgent } = useConnection();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const connected = state.phase === "connected" ? state : undefined;
  const statusTitle =
    state.phase === "discovering"
      ? "正在发现 daemon"
      : state.phase === "not_found"
        ? "未发现 daemon"
        : state.phase === "failed"
          ? "连接失败"
          : "已连接";
  const statusDetail =
    state.phase === "discovering"
      ? "请确保 iPhone 与 daemon 位于同一局域网"
      : state.phase === "not_found"
        ? "检查 daemon 是否已启动并广播服务"
        : state.phase === "failed"
          ? state.message
          : `${state.data.source_name} · ${state.service.name}`;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader
          title="Agent 概览"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新 daemon 与 Agent 列表"
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.refreshText}>刷新</Text>
            </Pressable>
          }
        />

        <View style={[styles.statusCard, connected && styles.statusConnected]}>
          <View style={[styles.statusDot, connected && styles.statusDotConnected]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{statusTitle}</Text>
            <Text style={styles.statusDetail}>{statusDetail}</Text>
          </View>
          {state.phase === "discovering" ? <ActivityIndicator color="#646B61" /> : null}
        </View>

        {connected ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.sectionTitle}>Agents</Text>
              <Text style={styles.summaryText}>
                {connected.data.source_online ? "来源在线" : "来源离线"} · {connected.data.agents.length} 个 · {formatTime(connected.data.refreshed_at)}
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
              ListEmptyComponent={<Text style={styles.emptyText}>当前没有 Agent</Text>}
              showsVerticalScrollIndicator={false}
            />
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>等待本地连接</Text>
            <Text style={styles.placeholderText}>
              发现服务后会自动选择一个 daemon，并读取最新的 Agent 状态。
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F1EA" },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  refreshButton: { backgroundColor: "#1E211D", borderRadius: 18, paddingHorizontal: 17, paddingVertical: 10 },
  buttonPressed: { opacity: 0.72 },
  refreshText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  statusCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#E8E5DC", borderRadius: 18, padding: 16, marginBottom: 28 },
  statusConnected: { backgroundColor: "#DFE9DA" },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#9A7B57", marginRight: 12 },
  statusDotConnected: { backgroundColor: "#467347" },
  statusCopy: { flex: 1 },
  statusTitle: { color: "#20231F", fontSize: 16, fontWeight: "700", marginBottom: 3 },
  statusDetail: { color: "#666B62", fontSize: 13, lineHeight: 18 },
  summaryRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { color: "#1B1E1A", fontSize: 21, fontWeight: "700" },
  summaryText: { color: "#74786F", fontSize: 12 },
  list: { paddingBottom: 28, gap: 10 },
  emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: "#777B73", fontSize: 15 },
  agentCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: "#DAD8D0" },
  agentCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  agentCardSelected: { borderColor: "#6F916B", backgroundColor: "#F4F8F1" },
  agentHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  agentName: { color: "#191C18", fontSize: 17, fontWeight: "700", flex: 1 },
  tabName: { color: "#666B62", fontSize: 12, fontWeight: "600", marginLeft: 14, maxWidth: "46%" },
  agentKind: { color: "#777B72", fontSize: 13, marginTop: 5 },
  agentKindFailed: { color: "#A34B43" },
  agentFacts: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 15 },
  factLabel: { color: "#858981", fontSize: 12 },
  factValue: { color: "#32362F", fontSize: 12, fontWeight: "600", marginRight: 8 },
  placeholder: { marginTop: 62, paddingHorizontal: 25, alignItems: "center" },
  placeholderTitle: { color: "#343831", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  placeholderText: { color: "#777B72", fontSize: 14, lineHeight: 21, textAlign: "center" },
});
