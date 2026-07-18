import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";

export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const styles = useThemedStyles(createStyles);
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
    eyebrow: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.7, marginBottom: 5 },
    title: { color: colors.textPrimary, fontSize: 32, fontWeight: "700", letterSpacing: -0.9 },
  });
