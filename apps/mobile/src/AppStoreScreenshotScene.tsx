import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AgentDetailBody, AgentDetailRefreshButton, AgentDetailTitleBlock } from "./AgentDetail";
import { AgentFilterProvider } from "./AgentFilterContext";
import { AgentsScreenContent } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { ConnectionFixtureProvider } from "./connection";
import { NO_FILTER } from "./agent-filter";
import { useThemedStyles } from "./theme/ThemeContext";
import { useI18n } from "./i18n/I18nContext";
import type { ThemeColors } from "./theme/tokens";
import { RecentCompletionsProvider } from "./notifications/RecentCompletions";
import { SplitLayout } from "./SplitLayout";
import { useIsWideLayout } from "./layout";
import {
  createScreenshotConnection,
  createScreenshotHistory,
  screenshotAgent,
  screenshotService,
  type ScreenshotSceneName,
} from "./screenshot-fixtures";

/**
 * The actual app shell rendered with a stable in-memory connection snapshot.
 * This is intentionally a UI harness, not a second product surface: the list,
 * split layout, detail body, filters, and theme all come from production code.
 */
type ScreenshotNavigationParamList = {
  Settings: undefined;
};

const ScreenshotStack = createNativeStackNavigator<ScreenshotNavigationParamList>();

export function AppStoreScreenshotScene({ scene }: { scene: ScreenshotSceneName }) {
  const connection = useMemo(() => createScreenshotConnection(), []);
  const [agentFilter, setAgentFilter] = useState(NO_FILTER);
  const styles = useThemedStyles(createStyles);
  const { locale } = useI18n();
  const history = useMemo(() => createScreenshotHistory(locale), [locale]);

  return (
    <ConnectionFixtureProvider value={connection}>
      <View
        accessible
        accessibilityLabel="app-store-screenshot-ready"
        style={styles.root}
      >
        <AgentFilterProvider agentFilter={agentFilter} setAgentFilter={setAgentFilter}>
          <RecentCompletionsProvider>
            <StatusBar style="dark" />
            <ScreenshotSceneBody scene={scene} history={history} />
          </RecentCompletionsProvider>
        </AgentFilterProvider>
      </View>
    </ConnectionFixtureProvider>
  );
}

function ScreenshotSceneBody({
  scene,
  history,
}: {
  scene: ScreenshotSceneName;
  history: ReturnType<typeof createScreenshotHistory>;
}) {
  const isWide = useIsWideLayout();
  const agent = screenshotAgent();
  const service = screenshotService();
  const noOp = useCallback(() => {}, []);
  const noOpAgent = useCallback(() => {}, []);

  if (isWide) {
    return (
      <SplitLayout
        activeDestination={scene === "settings" ? "Settings" : "Agents"}
        onSelectDestination={noOp}
        selectedAgentId={scene === "detail" ? agent.source_id : undefined}
        onSelectAgent={noOpAgent}
        onRequestPairing={noOp}
        screenshotHistory={scene === "detail" ? history : undefined}
      />
    );
  }

  if (scene === "detail") {
    return <ScreenshotDetail history={history} />;
  }

  if (scene === "settings") {
    return <ScreenshotSettings />;
  }

  return <AgentsScreenContent onAgentPress={noOpAgent} onStartPairing={noOp} />;
}

/** Narrow detail scene; wide devices use the production SplitLayout above. */
function ScreenshotDetail({ history }: { history: ReturnType<typeof createScreenshotHistory> }) {
  const styles = useThemedStyles(createStyles);
  const agent = screenshotAgent();
  const service = screenshotService();
  const title = agent.workspace_label || agent.display_name;
  const subtitle = [agent.tab_label, agent.agent_name].filter(Boolean).join(" · ");

  return (
    <SafeAreaView edges={["top"]} style={styles.detailSafeArea}>
      <AgentDetailBody
        agent={agent}
        service={service}
        keyboardOffsetExtra={0}
        initialHistory={history}
        renderHeader={({ onRefresh }) => (
          <View style={styles.detailHeader}>
            <AgentDetailTitleBlock title={title} subtitle={subtitle} />
            <AgentDetailRefreshButton onPress={onRefresh} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/**
 * SettingsScreen uses React Navigation for its language/appearance routes even
 * though the screenshot scene bypasses the app's normal root navigator. Keep a
 * tiny independent stack around the production screen so the fixture remains
 * identical on a narrow device without making the screenshot harness depend on
 * a real connection or persisted navigation state.
 */
function ScreenshotSettings() {
  return (
    <NavigationIndependentTree>
      <NavigationContainer>
        <ScreenshotStack.Navigator screenOptions={{ headerShown: false }}>
          <ScreenshotStack.Screen name="Settings" component={SettingsScreen} />
        </ScreenshotStack.Navigator>
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    detailSafeArea: { flex: 1, backgroundColor: colors.background },
    detailHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 6,
    },
  });
