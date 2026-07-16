import { useCallback, useEffect, useRef, useState } from "react";
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
import type { Service } from "@inthepocket/react-native-service-discovery";

import type { DemoAgent } from "./demo-contract";
import {
  fetchDemoAgentHistory,
  sendDemoAgentMessage,
  type DemoAgentHistory,
} from "./network";

const HISTORY_REFRESH_MS = 2_000;

type LoadPhase = "loading" | "ready" | "failed";
type SendPhase = "idle" | "sending" | "sent" | "failed";

interface AgentDetailProps {
  agent: DemoAgent;
  service: Service;
  onBack: () => void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AgentDetail({ agent, service, onBack }: AgentDetailProps) {
  const [history, setHistory] = useState<DemoAgentHistory>();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendError, setSendError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);

  const loadHistory = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadPhase("loading");
    try {
      const next = await fetchDemoAgentHistory(service, agent.source_id);
      if (!mountedRef.current) return;
      setHistory(next);
      setLoadPhase("ready");
      setLoadError("");
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadPhase("failed");
      setLoadError(message(error, "无法读取历史"));
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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendPhase === "sending") return;
    setSendPhase("sending");
    setSendError("");
    try {
      await sendDemoAgentMessage(service, agent.source_id, text);
      if (!mountedRef.current) return;
      setDraft("");
      setSendPhase("sent");
      await loadHistory();
    } catch (error) {
      if (!mountedRef.current) return;
      setSendPhase("failed");
      setSendError(message(error, "发送失败"));
    }
  }, [agent.source_id, draft, loadHistory, sendPhase, service]);

  const title = agent.workspace_label || agent.display_name || "Agent";
  const subtitle = [agent.tab_label, agent.agent_name].filter(Boolean).join(" · ");
  const canSend = draft.trim().length > 0 && sendPhase !== "sending";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回 Agent 列表"
          hitSlop={10}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>‹ Agents</Text>
        </Pressable>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新历史"
          hitSlop={10}
          onPress={() => void loadHistory(true)}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          <Text style={styles.refreshText}>刷新</Text>
        </Pressable>
      </View>

      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>历史消息</Text>
        <Text style={styles.historyMeta}>
          {history?.truncated ? "近期截面" : "近期记录"}
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
            <ActivityIndicator color="#646B61" />
            <Text style={styles.stateText}>正在读取近期记录</Text>
          </View>
        ) : loadPhase === "failed" && !history ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : (
          <Text selectable style={styles.transcript}>
            {history?.text || "当前没有可显示的历史记录。"}
          </Text>
        )}
      </ScrollView>

      <View style={styles.composerArea}>
        {sendPhase === "failed" ? <Text style={styles.sendError}>{sendError}</Text> : null}
        {sendPhase === "sent" ? <Text style={styles.sentText}>已发送到桌面端</Text> : null}
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="发送给 Agent 的消息"
            blurOnSubmit={false}
            maxLength={4000}
            multiline
            onChangeText={(value) => {
              setDraft(value);
              if (sendPhase !== "sending") setSendPhase("idle");
            }}
            placeholder="输入内容发送到桌面端…"
            placeholderTextColor="#8A8E86"
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            disabled={!canSend}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendButtonDisabled,
              pressed && canSend && styles.sendButtonPressed,
            ]}
          >
            {sendPhase === "sending" ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>发送</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F3F1EA", paddingTop: 8 },
  header: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  backButton: { minWidth: 72, paddingVertical: 9 },
  backText: { color: "#466447", fontSize: 16, fontWeight: "600" },
  identity: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  title: { color: "#191C18", fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  subtitle: { color: "#777B72", fontSize: 11, marginTop: 2 },
  refreshButton: { minWidth: 72, alignItems: "flex-end", paddingVertical: 9 },
  refreshText: { color: "#466447", fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.55 },
  historyHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  historyTitle: { color: "#1B1E1A", fontSize: 21, fontWeight: "700", letterSpacing: -0.35 },
  historyMeta: { color: "#7A7E75", fontSize: 12 },
  history: { flex: 1, marginHorizontal: 16, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: "#DAD8D0" },
  historyContent: { flexGrow: 1, padding: 17, justifyContent: "flex-end" },
  transcript: { color: "#30342E", fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36 },
  stateText: { color: "#777B72", fontSize: 13 },
  errorText: { color: "#A34B43", fontSize: 13, textAlign: "center" },
  composerArea: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: "#D6D4CC", padding: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 112, color: "#1D201C", fontSize: 15, lineHeight: 20, paddingHorizontal: 8, paddingVertical: 9 },
  sendButton: { minWidth: 66, height: 40, borderRadius: 14, backgroundColor: "#1E211D", alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
  sendButtonDisabled: { backgroundColor: "#C7C9C3" },
  sendButtonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  sendButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  sendError: { color: "#A34B43", fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
  sentText: { color: "#4F744D", fontSize: 12, marginBottom: 6, paddingHorizontal: 4 },
});
