import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "./connection";
import { ScreenHeader } from "./ScreenHeader";
import { Settings } from "./Settings";

export function SettingsScreen() {
  const { state } = useConnection();
  const connected = state.phase === "connected" ? state : undefined;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader title="设置" />
        <Settings service={connected?.service} data={connected?.data} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F1EA" },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
});
