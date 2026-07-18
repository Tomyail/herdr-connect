import { DefaultTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ConnectionProvider } from "./connection";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { DoneSoundProvider } from "./notifications/DoneSoundProvider";
import { AgentsScreen } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentDetailScreen } from "./AgentDetail";
import { LanguageScreen } from "./LanguageScreen";
import { Ionicons, type IoniconName } from "./icons";
import type { RootStackParamList, TabParamList } from "./navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons: Record<keyof TabParamList, { active: IoniconName; inactive: IoniconName }> = {
  Agents: { active: "people", inactive: "people-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F3F1EA",
    card: "#F3F1EA",
    border: "#DAD8D0",
    primary: "#466447",
    text: "#171A16",
  },
};

function Tabs() {
  const { t } = useI18n();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#1E211D",
        tabBarInactiveTintColor: "#8A8E86",
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 2 },
        tabBarIcon: ({ color, focused, size }) => {
          const iconName = focused ? tabIcons[route.name].active : tabIcons[route.name].inactive;
          return <Ionicons name={iconName} size={focused ? size + 1 : size} color={color} />;
        },
        tabBarStyle: { backgroundColor: "#F3F1EA", borderTopColor: "#DAD8D0" },
      })}
    >
      <Tab.Screen name="Agents" component={AgentsScreen} options={{ title: t("tab.agents") }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t("tab.settings") }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <ConnectionProvider>
          <NavigationContainer ref={navigationRef} theme={theme}>
            <StatusBar style="dark" />
            <DoneSoundProvider navigationRef={navigationRef} />
            <Stack.Navigator
              screenOptions={{
                headerShadowVisible: false,
                headerStyle: { backgroundColor: "#F3F1EA" },
                headerTintColor: "#466447",
                contentStyle: { backgroundColor: "#F3F1EA" },
              }}
            >
              <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
              <Stack.Screen name="AgentDetail" component={AgentDetailScreen} />
              <Stack.Screen name="Language" component={LanguageScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </ConnectionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
