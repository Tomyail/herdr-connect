import { useMemo } from "react";
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

import { ConnectionProvider } from "./connection";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { ThemeProvider, useTheme } from "./theme/ThemeContext";
import { DoneSoundProvider } from "./notifications/DoneSoundProvider";
import { RecentCompletionsProvider } from "./notifications/RecentCompletions";
import { AgentsScreen } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentDetailScreen } from "./AgentDetail";
import { LanguageScreen } from "./LanguageScreen";
import { AppearanceScreen } from "./AppearanceScreen";
import { Ionicons, type IoniconName } from "./icons";
import type { RootStackParamList, TabParamList } from "./navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons: Record<keyof TabParamList, { active: IoniconName; inactive: IoniconName }> = {
  Agents: { active: "people", inactive: "people-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};

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

function ThemedNavigation() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { theme, colors } = useTheme();

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

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <ConnectionProvider>
            <RecentCompletionsProvider>
              <ThemedNavigation />
            </RecentCompletionsProvider>
          </ConnectionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
