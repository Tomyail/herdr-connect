import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ConnectionProvider } from "./connection";
import { AgentsScreen } from "./AgentsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { AgentDetailScreen } from "./AgentDetail";
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
      <Tab.Screen name="Agents" component={AgentsScreen} options={{ title: "Agents" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "设置" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ConnectionProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="dark" />
          <Stack.Navigator
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: "#F3F1EA" },
              headerTintColor: "#466447",
              contentStyle: { backgroundColor: "#F3F1EA" },
            }}
          >
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="AgentDetail"
              component={AgentDetailScreen}
              options={{ headerBackTitle: "返回" }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </ConnectionProvider>
    </SafeAreaProvider>
  );
}
