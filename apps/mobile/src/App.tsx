import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ConnectionProvider, useConnection } from "./connection";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { ThemeProvider, useTheme } from "./theme/ThemeContext";
import { DoneSoundProvider } from "./notifications/DoneSoundProvider";
import { RecentCompletionsProvider } from "./notifications/RecentCompletions";
import { AgentsScreen } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentDetailScreen } from "./AgentDetail";
import { LanguageScreen } from "./LanguageScreen";
import { AppearanceScreen } from "./AppearanceScreen";
import { PairingScreen } from "./PairingScreen";
import { SplitLayout } from "./SplitLayout";
import { useIsWideLayout } from "./layout";
import { Ionicons } from "./icons";
import type { RootStackParamList, TabParamList, SidebarDestination } from "./navigation";
import { sidebarIcons } from "./navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons = sidebarIcons;

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
    const root = navigationRef.current?.getRootState();
    const focused = root?.routes[root.index ?? 0];
    const params = (focused?.params ?? {}) as { agent?: { source_id?: string } };
    if (focused?.name === "AgentDetail" && params.agent?.source_id === selectedAgentId) return;
    const connected = connection.phase === "connected" ? connection : undefined;
    const agent = connected?.data.agents.find((candidate) => candidate.source_id === selectedAgentId);
    if (agent) {
      navigationRef.current?.navigate("AgentDetail", { agent });
    }
    // Intentionally excludes `connection`: we only want to restore once when the
    // narrow tree becomes ready with a prior selection, not re-push on every
    // connection refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReady, activeDestination, selectedAgentId]);

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
        <Stack.Screen name="Pairing" component={PairingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function AppShell() {
  const isWide = useIsWideLayout();
  // Lifted above the narrow/wide branch so selection survives live resize.
  const [activeDestination, setActiveDestination] = useState<SidebarDestination>("Agents");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);

  const handleSelectAgentWide = useCallback((sourceId: string | undefined) => {
    setSelectedAgentId(sourceId);
  }, []);

  if (isWide) {
    return (
      <SplitLayout
        activeDestination={activeDestination}
        onSelectDestination={setActiveDestination}
        selectedAgentId={selectedAgentId}
        onSelectAgent={(agent) => setSelectedAgentId(agent.source_id)}
      />
    );
  }

  return (
    <ThemedNavigation
      activeDestination={activeDestination}
      selectedAgentId={selectedAgentId}
      onSelectAgent={handleSelectAgentWide}
      onSelectDestination={setActiveDestination}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <ConnectionProvider>
            <RecentCompletionsProvider>
              <AppShell />
            </RecentCompletionsProvider>
          </ConnectionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
