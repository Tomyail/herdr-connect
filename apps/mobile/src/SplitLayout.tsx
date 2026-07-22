/**
 * Wide split-view shell, shown when the window width is at/above
 * {@link SPLIT_BREAKPOINT}. Three regions:
 *
 *   ┌─────────┬───────────────┬──────────────────────┐
 *   │ sidebar │  agent list   │  agent detail        │
 *   │ Agents  │  (AgentsScreen│  (AgentDetailBody or │
 *   │ Settings│   reused)     │   empty state)       │
 *   └─────────┴───────────────┴──────────────────────┘
 *
 * - Sidebar replaces the bottom tab bar visually; the same destinations and
 *   icons are used (see {@link sidebarIcons}), just arranged vertically.
 * - Selection state (active destination + selected agent id) is owned above
 *   the narrow/wide branch in App.tsx so it survives live resize across the
 *   breakpoint: dragging a Stage Manager window narrower keeps the same agent
 *   open, just switched from a split pane to a pushed screen and back.
 * - Settings keeps its exact existing screen for now (rendered inside a local
 *   stack so its `navigation.navigate("Pairing"|"Language"|"Appearance")`
 *   calls keep working). A real 3-column Settings redesign is phase 3.
 */

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, NavigationIndependentTree, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AgentsScreenContent } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { LanguageScreen } from "./LanguageScreen";
import { AppearanceScreen } from "./AppearanceScreen";
import { PairingScreen } from "./PairingScreen";
import { AgentDetailBody, AgentDetailTitleBlock, AgentDetailRefreshButton } from "./AgentDetail";
import { Ionicons } from "./icons";
import { useI18n } from "./i18n/I18nContext";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import type { SidebarDestination } from "./navigation";
import { sidebarIcons } from "./navigation";
import type { Agent } from "./agent-contract";
import { useConnection } from "./connection";

/** Sidebar + active-destination props lifted above the narrow/wide branch. */
export interface SplitLayoutProps {
  activeDestination: SidebarDestination;
  onSelectDestination: (destination: SidebarDestination) => void;
  selectedAgentId: string | undefined;
  onSelectAgent: (agent: Agent) => void;
}

function Sidebar({
  active,
  onSelect,
}: {
  active: SidebarDestination;
  onSelect: (destination: SidebarDestination) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const destinations: ReadonlyArray<SidebarDestination> = ["Agents", "Settings"];

  return (
    <SafeAreaView edges={["top", "left"]} style={styles.sidebarSafeArea}>
      <View style={styles.sidebar}>
        <Text style={styles.sidebarEyebrow}>HERDR CONNECT</Text>
        {destinations.map((destination) => {
          const selected = destination === active;
          const iconName = selected ? sidebarIcons[destination].active : sidebarIcons[destination].inactive;
          const label = destination === "Agents" ? t("tab.agents") : t("tab.settings");
          return (
            <Pressable
              key={destination}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onSelect(destination)}
              style={({ pressed }) => [styles.sidebarItem, selected && styles.sidebarItemSelected, pressed && styles.sidebarItemPressed]}
            >
              <Ionicons name={iconName} size={22} color={selected ? colors.accent : colors.tabBarInactive} />
              <Text style={[styles.sidebarItemLabel, selected && styles.sidebarItemLabelSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function EmptyDetail() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.emptyDetail}>
      <Ionicons name="chatbubbles-outline" size={56} color={colors.textFaint} />
      <Text style={styles.emptyDetailTitle}>{t("detail.empty.title")}</Text>
      <Text style={styles.emptyDetailText}>{t("detail.empty.text")}</Text>
    </View>
  );
}

function AgentDetailColumn({ agentId }: { agentId: string | undefined }) {
  const { state } = useConnection();
  const styles = useThemedStyles(createStyles);
  const connected = state.phase === "connected" ? state : undefined;
  const service = connected?.service;
  const agent = useMemo(
    () => (agentId ? connected?.data.agents.find((candidate) => candidate.source_id === agentId) : undefined),
    [agentId, connected],
  );

  return (
    <SafeAreaView edges={["top", "right"]} style={styles.detailSafeArea}>
      <View style={styles.detailColumn}>
        {service && agent ? (
          <AgentDetailBody
            key={agent.source_id}
            agent={agent}
            service={service}
            keyboardOffsetExtra={0}
            renderHeader={(config) => (
              <View style={styles.inlineHeader}>
                <AgentDetailTitleBlock title={config.title} subtitle={config.subtitle} />
                <AgentDetailRefreshButton onPress={config.onRefresh} />
              </View>
            )}
          />
        ) : (
          <EmptyDetail />
        )}
      </View>
    </SafeAreaView>
  );
}

// Settings is hosted inside its own local stack so the existing SettingsScreen
// (and its `navigation.navigate("Pairing"|"Language"|"Appearance")` calls) keep
// working unchanged in the wide layout. Phase 3 will redesign this column.
type SettingsStackParamList = {
  Settings: undefined;
  Language: undefined;
  Appearance: undefined;
  Pairing: undefined;
};
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function SettingsColumn() {
  const { theme, colors } = useTheme();
  const navigationTheme = useMemo(
    () => {
      const base = theme === "dark" ? DarkTheme : DefaultTheme;
      return {
        ...base,
        colors: {
          ...base.colors,
          background: colors.background,
          card: colors.background,
          border: colors.cardBorder,
          primary: colors.accent,
          text: colors.textPrimary,
        },
      };
    },
    [colors, theme],
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <NavigationIndependentTree>
        <NavigationContainer theme={navigationTheme}>
          <SettingsStack.Navigator
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <SettingsStack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
          <SettingsStack.Screen name="Language" component={LanguageScreen} />
          <SettingsStack.Screen name="Appearance" component={AppearanceScreen} />
          <SettingsStack.Screen name="Pairing" component={PairingScreen} />
        </SettingsStack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}

export function SplitLayout({
  activeDestination,
  onSelectDestination,
  selectedAgentId,
  onSelectAgent,
}: SplitLayoutProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.shell}>
      <Sidebar active={activeDestination} onSelect={onSelectDestination} />
      {activeDestination === "Agents" ? (
        <View style={styles.agentsBody}>
          {/* The full AgentsScreen content is reused as the list column.
              Selection is routed through onSelectAgent into the shared
              selection state in App.tsx instead of pushing onto a stack. */}
          <View style={styles.listColumn}>
            <AgentsScreenContent onAgentPress={onSelectAgent} selectedAgentId={selectedAgentId} />
          </View>
          <View style={styles.detailColumnWrapper}>
            <AgentDetailColumn agentId={selectedAgentId} />
          </View>
        </View>
      ) : (
        <SettingsColumn />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    shell: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
    sidebarSafeArea: { flex: 0, backgroundColor: colors.background },
    sidebar: { width: 220, paddingTop: 14, paddingHorizontal: 14, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.cardBorder },
    sidebarEyebrow: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.7, marginBottom: 18, marginTop: 6 },
    sidebarItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 4 },
    sidebarItemSelected: { backgroundColor: colors.selectedCard },
    sidebarItemPressed: { opacity: 0.72 },
    sidebarItemLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
    sidebarItemLabelSelected: { color: colors.textPrimary },
    agentsBody: { flex: 1, flexDirection: "row" },
    listColumn: { width: 340, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.cardBorder, backgroundColor: colors.background },
    detailColumnWrapper: { flex: 1, backgroundColor: colors.background },
    detailSafeArea: { flex: 1, backgroundColor: colors.background },
    detailColumn: { flex: 1 },
    inlineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
    emptyDetail: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
    emptyDetailTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
    emptyDetailText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
  });
