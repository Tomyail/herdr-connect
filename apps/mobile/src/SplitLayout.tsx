/**
 * Wide split-view shell, shown when the window width is at/above
 * {@link SPLIT_BREAKPOINT}.
 *
 * Agents destination: sidebar + agent list + agent detail (phase 2).
 * Settings destination: sidebar + category list + category detail (phase 3),
 *   with Language/Appearance pushed inside the detail column's own local
 *   nested stack, and Pairing presented as a full-app overlay (see App.tsx).
 *
 * Selection state (active destination + selected agent id) is owned above the
 * narrow/wide branch in App.tsx so it survives live resize across the
 * breakpoint.
 */

import { useMemo, useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, NavigationIndependentTree, useNavigationContainerRef, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AgentsScreenContent } from "./AgentsScreen";
import { LanguageScreen } from "./LanguageScreen";
import { AppearanceScreen } from "./AppearanceScreen";
import { VoiceLanguageScreen } from "./VoiceLanguageScreen";
import { SilenceThresholdScreen } from "./SilenceThresholdScreen";
import {
  useSettingsCategories,
  type SettingsCategoryKey,
  type SettingsNavigation,
} from "./Settings";
import { AgentDetailBody, AgentDetailTitleBlock, AgentDetailRefreshButton } from "./AgentDetail";
import { Ionicons } from "./icons";
import { useI18n } from "./i18n/I18nContext";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import { useConnection } from "./connection";
import type { ThemeColors } from "./theme/tokens";
import type { SidebarDestination } from "./navigation";
import { sidebarIcons } from "./navigation";
import type { Agent } from "./agent-contract";

/** Sidebar + lifted selection props owned above the narrow/wide branch. */
export interface SplitLayoutProps {
  activeDestination: SidebarDestination;
  onSelectDestination: (destination: SidebarDestination) => void;
  selectedAgentId: string | undefined;
  onSelectAgent: (agent: Agent) => void;
  /** Wide mode only: requested from the Discovery category, handled by App.tsx
   *  as a full-app Pairing overlay. */
  onRequestPairing: () => void;
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

function AgentDetailColumn({
  agentId,
  focused,
  onToggleFocus,
}: {
  agentId: string | undefined;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { state } = useConnection();
  const styles = useThemedStyles(createStyles);
  const connected = state.phase === "connected" ? state : undefined;
  const service = connected?.service;
  const agent = useMemo(
    () => (agentId ? connected?.data.agents.find((candidate) => candidate.source_id === agentId) : undefined),
    [agentId, connected],
  );

  // Focus toggle lives in the detail header: collapses the sidebar + list so the
  // transcript/composer fill the whole width; tap again to restore three columns.
  // expand = "expand back to three columns" (shown while focused),
  // contract = "collapse to focused" (shown while expanded).
  const focusA11y = focused ? t("detail.expandLayoutA11y") : t("detail.focusLayoutA11y");

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
                <View style={styles.inlineHeaderActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={focusA11y}
                    hitSlop={10}
                    onPress={onToggleFocus}
                    style={({ pressed }) => [styles.focusButton, pressed && styles.focusButtonPressed]}
                  >
                    <Ionicons name={focused ? "expand" : "contract"} size={22} color={colors.accent} />
                  </Pressable>
                  <AgentDetailRefreshButton onPress={config.onRefresh} />
                </View>
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

// ─── Settings three-column layout ──────────────────────────────────────────

/** Detail column's local nested stack: category content + Language/Appearance. */
type SettingsDetailStackParamList = {
  CategoryDetail: undefined;
  Language: undefined;
  Appearance: undefined;
  VoiceLanguage: undefined;
  SilenceThreshold: undefined;
};
const SettingsDetailStack = createNativeStackNavigator<SettingsDetailStackParamList>();

function SettingsCategoryList({
  categories,
  selectedKey,
  onSelect,
}: {
  categories: ReturnType<typeof useSettingsCategories>;
  selectedKey: SettingsCategoryKey;
  onSelect: (key: SettingsCategoryKey) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView edges={["top"]} style={styles.settingsListSafeArea}>
      <ScrollView style={styles.settingsList} contentContainerStyle={styles.settingsListContent}>
        {categories.map((category) => {
          const selected = category.key === selectedKey;
          return (
            <Pressable
              key={category.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onSelect(category.key)}
              style={({ pressed }) => [
                styles.categoryRow,
                selected && styles.categoryRowSelected,
                pressed && styles.categoryRowPressed,
              ]}
            >
              <View style={styles.categoryRowLeading}>
                <Ionicons name={category.icon} size={20} color={selected ? colors.accent : colors.textMuted} />
                <Text style={[styles.categoryRowLabel, selected && styles.categoryRowLabelSelected]}>
                  {t(category.labelKey)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The detail column's root screen: renders the selected category's content,
 * phone-width and centered (point 6). `navigation` routes Language/Appearance
 * into this column's local stack and Pairing to the full-app overlay.
 *
 * useSettingsCategories is the single source of truth for all Settings state
 * (MMKV switches / credentials / connection) — the list column builds its own
 * instance too, but those hooks are idempotent across instances and stay in
 * sync, so the two columns can never desync (point 3).
 */
function SettingsCategoryDetail({
  selectedKey,
  navigation,
}: {
  selectedKey: SettingsCategoryKey;
  navigation: SettingsNavigation;
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const { state } = useConnection();
  const categories = useSettingsCategories(state, navigation);
  const category = categories.find((candidate) => candidate.key === selectedKey);

  return (
    <SafeAreaView edges={["top", "right"]} style={styles.detailSafeArea}>
      <View style={styles.detailColumn}>
        <View style={styles.settingsDetailCentered}>
          <Text style={styles.settingsDetailTitle}>{t(category?.labelKey ?? "settings.screenTitle")}</Text>
          <ScrollView style={styles.settingsDetailScroll} contentContainerStyle={styles.settingsDetailContent}>
            {category?.render()}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

function SettingsDetailColumn({
  selectedCategory,
  onRequestPairing,
}: {
  selectedCategory: SettingsCategoryKey;
  onRequestPairing: () => void;
}) {
  const { theme, colors } = useTheme();
  const { t } = useI18n();
  const detailRef = useNavigationContainerRef<SettingsDetailStackParamList>();

  const navigationTheme = useMemo(() => {
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
  }, [colors, theme]);

  // Detail column navigation: Language/Appearance push on this column's local
  // stack; Pairing is the full-app overlay (lifted to App.tsx).
  const navigation = useMemo<SettingsNavigation>(
    () => ({
      onNavigateLanguage: () => detailRef.current?.navigate("Language"),
      onNavigateAppearance: () => detailRef.current?.navigate("Appearance"),
      onNavigateVoiceLanguage: () => detailRef.current?.navigate("VoiceLanguage"),
      onNavigateSilenceThreshold: () => detailRef.current?.navigate("SilenceThreshold"),
      onRequestPairing,
    }),
    [detailRef, onRequestPairing],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <NavigationIndependentTree>
        <NavigationContainer ref={detailRef} theme={navigationTheme}>
          <SettingsDetailStack.Navigator
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.accent,
              headerBackTitle: t("settings.screenTitle"),
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <SettingsDetailStack.Screen name="CategoryDetail" options={{ headerShown: false }}>
              {() => <SettingsCategoryDetail selectedKey={selectedCategory} navigation={navigation} />}
            </SettingsDetailStack.Screen>
            <SettingsDetailStack.Screen name="Language" component={LanguageScreen} />
            <SettingsDetailStack.Screen name="Appearance" component={AppearanceScreen} />
            <SettingsDetailStack.Screen name="VoiceLanguage" component={VoiceLanguageScreen} />
            <SettingsDetailStack.Screen name="SilenceThreshold" component={SilenceThresholdScreen} />
          </SettingsDetailStack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}

function SettingsColumns({ onRequestPairing }: { onRequestPairing: () => void }) {
  const styles = useThemedStyles(createStyles);
  // Default to General on first entering the wide Settings tab (point 2).
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategoryKey>("general");
  const { state } = useConnection();
  // List column needs only icons/labels; a no-op navigation is fine since the
  // list itself never triggers row navigation.
  const listCategories = useSettingsCategories(state, {
    onNavigateLanguage: () => {},
    onNavigateAppearance: () => {},
    onNavigateVoiceLanguage: () => {},
    onNavigateSilenceThreshold: () => {},
    onRequestPairing,
  });

  return (
    <View style={styles.agentsBody}>
      <View style={styles.listColumn}>
        <SettingsCategoryList
          categories={listCategories}
          selectedKey={selectedCategory}
          onSelect={setSelectedCategory}
        />
      </View>
      <View style={styles.detailColumnWrapper}>
        <SettingsDetailColumn selectedCategory={selectedCategory} onRequestPairing={onRequestPairing} />
      </View>
    </View>
  );
}

export function SplitLayout({
  activeDestination,
  onSelectDestination,
  selectedAgentId,
  onSelectAgent,
  onRequestPairing,
}: SplitLayoutProps) {
  const styles = useThemedStyles(createStyles);
  // Agents-only focus mode: collapses sidebar + list so the detail/transcript
  // spans the full width. Local, per-session state — intentionally not lifted
  // to App.tsx or persisted. Reset automatically when AppShell unmounts this
  // tree across a narrow/wide resize (phase 2 behavior).
  const [focused, setFocused] = useState(false);
  const toggleFocus = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFocused((value) => !value);
  };
  // Focus only applies on the Agents destination; Settings always needs the sidebar.
  const agentsFocused = activeDestination === "Agents" && focused;

  return (
    <View style={styles.shell}>
      {agentsFocused ? null : (
        <Sidebar active={activeDestination} onSelect={onSelectDestination} />
      )}
      {activeDestination === "Agents" ? (
        <View style={styles.agentsBody}>
          {agentsFocused ? null : (
            <View style={styles.listColumn}>
              <AgentsScreenContent onAgentPress={onSelectAgent} selectedAgentId={selectedAgentId} />
            </View>
          )}
          <View style={styles.detailColumnWrapper}>
            <AgentDetailColumn agentId={selectedAgentId} focused={agentsFocused} onToggleFocus={toggleFocus} />
          </View>
        </View>
      ) : (
        <SettingsColumns onRequestPairing={onRequestPairing} />
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
    inlineHeaderActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    focusButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    focusButtonPressed: { opacity: 0.5 },
    emptyDetail: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
    emptyDetailTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
    emptyDetailText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
    // Settings category list column
    settingsListSafeArea: { flex: 1, backgroundColor: colors.background },
    settingsList: { flex: 1 },
    settingsListContent: { paddingHorizontal: 16, paddingTop: 22, gap: 8 },
    categoryRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
    },
    categoryRowSelected: { borderColor: colors.selectedCardBorder, backgroundColor: colors.selectedCard },
    categoryRowPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
    categoryRowLeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    categoryRowLabel: { color: colors.textSecondary, fontSize: 16, fontWeight: "600" },
    categoryRowLabelSelected: { color: colors.textPrimary },
    // Settings detail column — phone-width content centered (point 6)
    settingsDetailCentered: { flex: 1, maxWidth: 520, width: "100%", alignSelf: "center", paddingHorizontal: 20 },
    settingsDetailTitle: { color: colors.textPrimary, fontSize: 32, fontWeight: "700", letterSpacing: -0.9, marginTop: 18, marginBottom: 22 },
    settingsDetailScroll: { flex: 1 },
    settingsDetailContent: { paddingBottom: 28 },
  });
