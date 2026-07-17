import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.eyebrow}>HERDR CONNECT</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  eyebrow: { color: "#73776E", fontSize: 11, fontWeight: "700", letterSpacing: 1.7, marginBottom: 5 },
  title: { color: "#171A16", fontSize: 32, fontWeight: "700", letterSpacing: -0.9 },
});
