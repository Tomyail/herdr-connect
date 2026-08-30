import { createElement, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Modal, Pressable, View } from "react-native";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationIndependentTree,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ConnectionProvider, useConnection } from "./connection";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { getScreenshotLaunchOptions } from "screenshot-launch-options";
import { ThemeProvider, useTheme } from "./theme/ThemeContext";
import type { DoneSoundProvider as DoneSoundProviderComponent } from "./notifications/DoneSoundProvider";
import { RecentCompletionsProvider } from "./notifications/RecentCompletions";
import { AgentsScreen } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentDetailScreen } from "./AgentDetail";
import { LanguageScreen } from "./LanguageScreen";
import { AppearanceScreen } from "./AppearanceScreen";
import { VoiceLanguageScreen } from "./VoiceLanguageScreen";
import { SilenceThresholdScreen } from "./SilenceThresholdScreen";
import { PairingScreen } from "./PairingScreen";
import { VoiceLanguageProvider } from "./voice/VoiceLanguageContext";
import { SplitLayout } from "./SplitLayout";
import { useIsWideLayout } from "./layout";
import { initialInstanceUiState, instanceUiReducer } from "./instance-ui-state";
import { AgentFilterProvider } from "./AgentFilterContext";
import type { AgentListFilter } from "./agent-filter";
import { Ionicons } from "./icons";
import type { RootStackParamList, TabParamList, SidebarDestination } from "./navigation";
import { sidebarIcons } from "./navigation";
import type { Agent } from "./agent-contract";
import { AppStoreScreenshotScene } from "./AppStoreScreenshotScene";
import { parseScreenshotScene, type ScreenshotSceneName } from "./screenshot-fixtures";
import type { AppLanguage } from "./i18n/locale";

const screenshotLaunchOptions = __DEV__ ? getScreenshotLaunchOptions() : undefined;
const screenshotScene: ScreenshotSceneName | undefined = parseScreenshotScene(screenshotLaunchOptions?.scene);
const screenshotLanguage: AppLanguage = screenshotLaunchOptions?.locale === "zh-Hans" ? "zh-Hans" : "en";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons = sidebarIcons;

type DoneSoundProviderProps = ComponentProps<typeof DoneSoundProviderComponent>;

/**
 * Keep expo-notifications out of Debug screenshot scenes. The production-only
 * provider is loaded lazily when AppShell actually renders it; importing it at
 * module load would make Expo Dev Client emit a simulator registration error
 * into the screenshot even though the screenshot scene never uses it.
 */
function DoneSoundProvider(props: DoneSoundProviderProps) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const module = require("./notifications/DoneSoundProvider") as {
    DoneSoundProvider: typeof DoneSoundProviderComponent;
  };
  return createElement(module.DoneSoundProvider, props);
}

function Tabs() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 2 },
        tabBarIcon: ({ color, focused, size }) => {
          const iconName = focused ? tabIcons[route.name].active : tabIcons[route.name].inactive;
          return <Ionicons name={iconName} size={focused ? size + 1 : size} color={color} />;
        },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.cardBorder },
      })}
    >
      <Tab.Screen name="Agents" component={AgentsScreen} options={{ title: t("tab.agents") }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t("tab.settings") }} />
    </Tab.Navigator>
  );
}

/**
 * Read the shared selection state out of the narrow native-stack + tab tree so
 * it survives a live resize into the wide split layout (and vice-versa).
 *
 * - activeDestination: whichever of Agents/Settings the tab bar has focused.
 * - selectedAgentId: the agent on the currently-pushed AgentDetail route, if any.
 */
function ThemedNavigation({
  activeDestination,
  selectedAgentId,
  onSelectAgent,
  onSelectDestination,
}: {
  activeDestination: SidebarDestination;
  selectedAgentId: string | undefined;
  onSelectAgent: (sourceId: string | undefined) => void;
  onSelectDestination: (destination: SidebarDestination) => void;
}) {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { theme, colors } = useTheme();
  const { state: connection } = useConnection();
  const [navReady, setNavReady] = useState(false);

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
  }, [theme, colors]);

  // Mirror the narrow tree into the shared selection state. This keeps the
  // selected agent id + active destination in sync so a live resize into the
  // wide layout shows the same agent/destination.
  const handleStateChange = useCallback(() => {
    const root = navigationRef.current?.getRootState();
    if (!root) return;

    // Active tab (Agents/Settings) lives under the "Tabs" route.
    const tabsRoute = root.routes.find((route) => route.name === "Tabs");
    const tabState = tabsRoute?.state;
    const activeTabName = tabState && tabState.index != null ? tabState.routes[tabState.index]?.name : undefined;
    if (activeTabName === "Agents" || activeTabName === "Settings") {
      onSelectDestination(activeTabName);
    }

    // Selected agent lives on the focused root route when it's AgentDetail.
    const focused = root.routes[root.index ?? 0];
    const params = (focused?.params ?? {}) as { agent?: { source_id?: string } };
    const focusedAgentId = focused?.name === "AgentDetail" ? params.agent?.source_id : undefined;
    onSelectAgent(focusedAgentId);
  }, [navigationRef, onSelectAgent, onSelectDestination]);

  // Wide → narrow transition: when the narrow tree remounts after a resize,
  // restore both pieces of prior selection so the user lands where they were:
  //   - switch the tab to whichever of Agents/Settings was active in the sidebar
  //   - if an agent was selected, push its AgentDetail
  // Runs once the navigator is ready. Same single-source-of-truth state used
  // for the agent id is used here for the destination.
  //
  // The same effect also serves instance focus switches (#54): the lifted
  // selection is swapped to the remembered snapshot of the newly focused
  // instance, and this effect reconciles the navigation tree with it. When the
  // new instance's snapshot references an agent whose data is not connected
  // yet, we wait for the next `connection` update instead of dropping the
  // restore — parallel sessions usually make the data already available, so
  // switches complete without any visible loading. Re-running on connection
  // updates is safe: when the tree already shows the target route this is a
  // no-op, and when the user navigated away `handleStateChange` mirrors that
  // back into the lifted state first.
  useEffect(() => {
    if (!navReady) return;

    const tabsRoute = navigationRef.current?.getRootState()?.routes.find((route) => route.name === "Tabs");
    const activeTabName = tabsRoute?.state && tabsRoute.state.index != null
      ? tabsRoute.state.routes[tabsRoute.state.index]?.name
      : undefined;
    if (activeTabName !== activeDestination) {
      // RootStackParamList["Tabs"] is typed as `undefined`, but React Navigation
      // accepts nested-screen params at runtime; cast to satisfy the type.
      navigationRef.current?.navigate("Tabs", { screen: activeDestination } as never);
    }

    if (!selectedAgentId) return;
    const connected = connection.phase === "connected" ? connection : undefined;
    const agent = connected?.data.agents.find((candidate) => candidate.source_id === selectedAgentId);
    if (!agent) return; // 目标 Agent 数据未就绪:等下一个 connection 更新再恢复
    const root = navigationRef.current?.getRootState();
    const focused = root?.routes[root.index ?? 0];
    const params = (focused?.params ?? {}) as { agent?: { source_id?: string } };
    if (focused?.name === "AgentDetail" && params.agent?.source_id === selectedAgentId) return;
    navigationRef.current?.navigate("AgentDetail", { agent });
  }, [navReady, activeDestination, selectedAgentId, connection]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onStateChange={handleStateChange}
      onReady={() => setNavReady(true)}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <DoneSoundProvider navigationRef={navigationRef} />
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.accent,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="AgentDetail" component={AgentDetailScreen} />
        <Stack.Screen name="Language" component={LanguageScreen} />
        <Stack.Screen name="Appearance" component={AppearanceScreen} />
        <Stack.Screen name="VoiceLanguage" component={VoiceLanguageScreen} />
        <Stack.Screen name="SilenceThreshold" component={SilenceThresholdScreen} />
        <Stack.Screen name="Pairing" component={PairingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function AppShell() {
  const isWide = useIsWideLayout();
  const { activeFingerprint, instances } = useConnection();
  // Lifted above the narrow/wide branch so selection survives live resize.
  // Per-instance UI memory (#54): the reducer keeps a snapshot per paired
  // installation (destination + selected agent). Switching the active instance
  // swaps the lifted selection to the remembered snapshot — navigating back to
  // exactly where the user left that instance, with no reload.
  const [ui, dispatch] = useReducer(instanceUiReducer, undefined, () => initialInstanceUiState);
  const activeDestination = ui.destination;
  const selectedAgentId = ui.selectedAgentId;
  // undefined = focus not resolved yet (cold start): the first resolution
  // applies the remembered/default snapshot without remembering anything.
  const previousFocusRef = useRef<string | null | undefined>(undefined);
  // Wide mode only: Pairing is a focused, one-time task that must cover the
  // whole app (sidebar + columns included), so it is presented as a full-screen
  // overlay above <SplitLayout>. Narrow mode keeps its existing push-based
  // Pairing on the root stack, which already covers the full phone screen.
  const [pairingRequested, setPairingRequested] = useState(false);

  // 焦点切换:活动实例变化时记忆旧焦点界面、恢复新焦点记忆。
  useEffect(() => {
    const previous = previousFocusRef.current;
    previousFocusRef.current = activeFingerprint;
    if (previous === activeFingerprint) return;
    dispatch({
      type: "focusSwitch",
      previousFingerprint: previous ?? null,
      nextFingerprint: activeFingerprint,
    });
  }, [activeFingerprint]);

  // 实例集合收缩时清理对应记忆槽(解绑/鉴权失效后防泄漏)。
  useEffect(() => {
    dispatch({ type: "prune", liveFingerprints: instances.map((instance) => instance.fingerprint) });
  }, [instances]);

  const handleSelectAgentWide = useCallback((sourceId: string | undefined) => {
    dispatch({ type: "selectedAgent", selectedAgentId: sourceId });
  }, []);
  const handleSelectDestination = useCallback((destination: SidebarDestination) => {
    dispatch({ type: "destination", destination });
  }, []);
  // Agents 列表过滤(issue #56 状态维 / #57 workspace 维):同样属于每实例
  // 记忆,经 context 暴露给列表页(宽窄两树共同挂载点),切换实例时随
  // 快照记忆/恢复。
  const handleAgentFilter = useCallback((agentFilter: AgentListFilter) => {
    dispatch({ type: "agentFilter", agentFilter });
  }, []);
  const requestPairing = useCallback(() => setPairingRequested(true), []);
  const dismissPairing = useCallback(() => setPairingRequested(false), []);
  const openCompletedAgentWide = useCallback((agent: Agent) => {
    dispatch({ type: "destination", destination: "Agents" });
    dispatch({ type: "selectedAgent", selectedAgentId: agent.source_id });
  }, []);

  return (
    <AgentFilterProvider agentFilter={ui.agentFilter} setAgentFilter={handleAgentFilter}>
      {isWide ? (
        <>
          <DoneSoundProvider
            viewingSourceId={activeDestination === "Agents" ? selectedAgentId : undefined}
            onOpenAgent={openCompletedAgentWide}
          />
          <SplitLayout
            activeDestination={activeDestination}
            onSelectDestination={handleSelectDestination}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(agent) => dispatch({ type: "selectedAgent", selectedAgentId: agent.source_id })}
            onRequestPairing={requestPairing}
          />
          <PairingOverlay visible={pairingRequested} onDismiss={dismissPairing} />
        </>
      ) : (
        <ThemedNavigation
          activeDestination={activeDestination}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgentWide}
          onSelectDestination={handleSelectDestination}
        />
      )}
    </AgentFilterProvider>
  );
}

/**
 * Full-screen Pairing presentation for wide mode. Uses RN's native <Modal> for
 * guaranteed full-screen coverage (covers sidebar + category list + detail
 * column). PairingScreen is hosted inside its own NavigationIndependentTree +
 * native-stack as the sole root route (there is no Entry screen) so its
 * `useNavigation`/`navigation.setOptions` keep working untouched. Because
 * Pairing is the root, PairingScreen's own `if (canGoBack()) goBack()` is a
 * no-op here — so the overlay is closed in two explicit ways instead, both
 * ending in `onDismiss` (which unmounts the whole Modal in a single step, with
 * no intermediate blank frame):
 *   - the header's left × button (configured at the Stack level below), and
 *   - PairingScreen's `onSuccess` callback (passed as a prop), invoked right
 *     after a successful pairing so the success experience matches the narrow
 *     push-based flow.
 */
type PairingOverlayStackParamList = {
  Pairing: undefined;
};
const PairingOverlayStack = createNativeStackNavigator<PairingOverlayStackParamList>();

function PairingOverlay({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { theme, colors } = useTheme();
  const overlayRef = useNavigationContainerRef<PairingOverlayStackParamList>();
  const { t } = useI18n();
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

  // Header left button for the Pairing screen: closes the whole overlay. We set
  // it at the Stack level so PairingScreen's own setOptions (which only sets
  // title + headerBackTitle) can't clobber it. Pairing is the root route, so
  // there's no Entry screen to pop through — closing happens in one step with
  // no intermediate blank frame.
  const screenOptions = useMemo(
    () => ({
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.accent,
      contentStyle: { backgroundColor: colors.background },
      headerBackTitleVisible: false,
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("detail.back")}
          hitSlop={12}
          onPress={onDismiss}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Ionicons name="close" size={28} color={colors.accent} />
        </Pressable>
      ),
    }),
    [colors.accent, colors.background, onDismiss, t],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <NavigationIndependentTree>
          <NavigationContainer ref={overlayRef} theme={navigationTheme}>
            <PairingOverlayStack.Navigator initialRouteName="Pairing" screenOptions={screenOptions}>
              <PairingOverlayStack.Screen name="Pairing">
                {() => <PairingScreen onSuccess={onDismiss} />}
              </PairingOverlayStack.Screen>
            </PairingOverlayStack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </View>
    </Modal>
  );
}

function AppContent() {
  if (screenshotScene) {
    return <AppStoreScreenshotScene scene={screenshotScene} />;
  }

  return (
    <ConnectionProvider>
      <RecentCompletionsProvider>
        <AppShell />
      </RecentCompletionsProvider>
    </ConnectionProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider initialAppearance={screenshotScene ? "light" : undefined}>
        <I18nProvider
          initialLanguage={screenshotScene ? screenshotLanguage : undefined}
          fixedTimeLabel={screenshotScene ? (screenshotLanguage === "zh-Hans" ? "09:41" : "9:41 AM") : undefined}
        >
          <VoiceLanguageProvider>
            <AppContent />
          </VoiceLanguageProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
