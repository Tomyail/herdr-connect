import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ServiceDiscovery from "@inthepocket/react-native-service-discovery";
import type { Service } from "@inthepocket/react-native-service-discovery";

import {
  interactionStateLabel,
  turnOutcomeLabel,
  type DemoAgent,
  type DemoAgentsResponse,
} from "./demo-contract";
import { devServerFallbackService, fetchDemoAgents, focusDemoAgent, serviceKey } from "./network";
import { AgentDetail } from "./AgentDetail";
import { Settings } from "./Settings";
import { SlideOver } from "./SlideOver";

const SERVICE_TYPE = "herdr-connect";
const DISCOVERY_WAIT_MS = 6_000;

async function ensureAndroidLocalNetworkPermission(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES;
  const result = await PermissionsAndroid.request(permission, {
    title: "允许发现附近的 Herdr daemon",
    message: "Herdr Connect 需要访问附近设备，以发现并连接同一局域网中的 Mac。",
    buttonPositive: "允许",
    buttonNegative: "暂不允许",
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("未获得附近设备权限");
  }
}

type ConnectionState =
  | { phase: "discovering" }
  | { phase: "not_found" }
  | { phase: "failed"; message: string }
  | { phase: "connected"; service: Service; data: DemoAgentsResponse };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "无法连接 daemon";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

type FocusPhase = "switching" | "switched" | "failed";
type Tab = "agents" | "settings";

const TABS: readonly { key: Tab; label: string }[] = [
  { key: "agents", label: "Agents" },
  { key: "settings", label: "设置" },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(({ key, label }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === key }}
          accessibilityLabel={`切换到${label}页`}
          onPress={() => onChange(key)}
          style={styles.tabItem}
        >
          <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
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

export default function App() {
  const [state, setState] = useState<ConnectionState>({ phase: "discovering" });
  const servicesRef = useRef(new Map<string, Service>());
  const selectedKeyRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const [focusResult, setFocusResult] = useState<{ sourceID: string; phase: FocusPhase }>();
  const [selectedAgent, setSelectedAgent] = useState<DemoAgent>();
  const [tab, setTab] = useState<Tab>("agents");

  const switchAgent = useCallback(async (service: Service, agent: DemoAgent) => {
    setFocusResult({ sourceID: agent.source_id, phase: "switching" });
    try {
      await focusDemoAgent(service, agent.source_id);
      setFocusResult({ sourceID: agent.source_id, phase: "switched" });
    } catch {
      setFocusResult({ sourceID: agent.source_id, phase: "failed" });
    }
  }, []);

  const clearDiscoveryTimer = useCallback(() => {
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = undefined;
  }, []);

  const connect = useCallback(
    async (service: Service) => {
      const key = serviceKey(service);
      selectedKeyRef.current = key;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      clearDiscoveryTimer();

      try {
        const data = await fetchDemoAgents(service, controller.signal);
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          setState({ phase: "connected", service, data });
        }
      } catch (error) {
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          setState({ phase: "failed", message: errorMessage(error) });
        }
      }
    },
    [clearDiscoveryTimer],
  );

  const beginNotFoundCountdown = useCallback(() => {
    clearDiscoveryTimer();
    discoveryTimerRef.current = setTimeout(() => {
      if (mountedRef.current && servicesRef.current.size === 0) {
        const sourceCode = NativeModules.SourceCode as
          | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
          | undefined;
        const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
        const fallback = devServerFallbackService(scriptURL);
        if (fallback) {
          void connect(fallback);
        } else {
          setState({ phase: "not_found" });
        }
      }
    }, DISCOVERY_WAIT_MS);
  }, [clearDiscoveryTimer, connect]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    servicesRef.current.clear();
    setState({ phase: "discovering" });
    beginNotFoundCountdown();

    try {
      await ServiceDiscovery.stopSearch(SERVICE_TYPE);
      await ServiceDiscovery.startSearch(SERVICE_TYPE);
    } catch (error) {
      if (mountedRef.current) setState({ phase: "failed", message: errorMessage(error) });
    }
  }, [beginNotFoundCountdown]);

  useEffect(() => {
    mountedRef.current = true;
    const foundListener = ServiceDiscovery.addEventListener("serviceFound", (service) => {
      const key = serviceKey(service);
      servicesRef.current.set(key, service);
      if (!selectedKeyRef.current) void connect(service);
    });
    const lostListener = ServiceDiscovery.addEventListener("serviceLost", (service) => {
      const key = serviceKey(service);
      servicesRef.current.delete(key);
      if (selectedKeyRef.current !== key) return;

      requestRef.current?.abort();
      selectedKeyRef.current = undefined;
      const nextService = servicesRef.current.values().next().value as Service | undefined;
      if (nextService) {
        void connect(nextService);
      } else {
        setState({ phase: "not_found" });
      }
    });

    beginNotFoundCountdown();
    void ensureAndroidLocalNetworkPermission()
      .then(() => ServiceDiscovery.startSearch(SERVICE_TYPE))
      .catch((error: unknown) => {
        if (mountedRef.current) setState({ phase: "failed", message: errorMessage(error) });
      });

    return () => {
      mountedRef.current = false;
      clearDiscoveryTimer();
      requestRef.current?.abort();
      foundListener.remove();
      lostListener.remove();
      void ServiceDiscovery.stopSearch(SERVICE_TYPE);
    };
  }, [beginNotFoundCountdown, clearDiscoveryTimer, connect]);

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
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.screen}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>HERDR CONNECT</Text>
              <Text style={styles.title}>{tab === "agents" ? "Agent 概览" : "设置"}</Text>
            </View>
            {tab === "agents" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="刷新 daemon 与 Agent 列表"
                onPress={() => void refresh()}
                style={({ pressed }) => [styles.refreshButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.refreshText}>刷新</Text>
              </Pressable>
            ) : null}
          </View>

          {tab === "settings" ? (
            <Settings service={connected?.service} data={connected?.data} />
          ) : (
            <>
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
                          setSelectedAgent(item);
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
            </>
          )}
        </View>
        <TabBar tab={tab} onChange={setTab} />
      </SafeAreaView>

      {connected && selectedAgent ? (
        <SlideOver onClosed={() => setSelectedAgent(undefined)}>
          {(close) => (
            <SafeAreaView style={styles.detailSafeArea}>
              <AgentDetail
                agent={selectedAgent}
                service={connected.service}
                onBack={close}
              />
            </SafeAreaView>
          )}
        </SlideOver>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F3F1EA" },
  safeArea: { flex: 1, backgroundColor: "#F3F1EA" },
  detailSafeArea: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  eyebrow: { color: "#73776E", fontSize: 11, fontWeight: "700", letterSpacing: 1.7, marginBottom: 5 },
  title: { color: "#171A16", fontSize: 32, fontWeight: "700", letterSpacing: -0.9 },
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
  tabBar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DAD8D0", backgroundColor: "#F3F1EA" },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabLabel: { color: "#8A8E86", fontSize: 14, fontWeight: "600" },
  tabLabelActive: { color: "#1E211D" },
  placeholder: { marginTop: 62, paddingHorizontal: 25, alignItems: "center" },
  placeholderTitle: { color: "#343831", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  placeholderText: { color: "#777B72", fontSize: 14, lineHeight: 21, textAlign: "center" },
});
