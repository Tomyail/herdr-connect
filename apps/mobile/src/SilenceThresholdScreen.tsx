import { useLayoutEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "./i18n/I18nContext";
import type { MessageKey } from "./i18n/messages";
import { Ionicons } from "./icons";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import {
  silenceThresholdStorage,
  SILENCE_THRESHOLD_OPTIONS,
} from "./voice/silenceThreshold";

function formatOptionName(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SilenceThresholdScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<NativeStackNavigationProp<{ SilenceThreshold: undefined }, "SilenceThreshold">>();
  const current = silenceThresholdStorage.read();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("voice.silenceThreshold.title"),
      headerBackTitle: t("settings.screenTitle"),
    });
  }, [navigation, t]);

  const choose = (ms: number) => {
    silenceThresholdStorage.write(ms);
    // Re-render the list to reflect the new selection; the calling screen will
    // re-read the value on its next render anyway (MMKV is shared).
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {SILENCE_THRESHOLD_OPTIONS.map((ms) => {
          const selected = ms === current;
          const label = formatOptionName(ms);
          return (
            <Pressable
              key={ms}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => choose(ms)}
              style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
            >
              <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
              {selected ? <Ionicons name="checkmark" size={20} color={colors.accent} style={styles.check} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    list: { flex: 1 },
    listContent: { marginTop: 28, marginHorizontal: 20, backgroundColor: colors.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder, paddingHorizontal: 17, paddingVertical: 4 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    rowSelected: { backgroundColor: colors.selectedCard, borderRadius: 10 },
    rowPressed: { opacity: 0.6 },
    label: { color: colors.textPrimary, fontSize: 16, flexShrink: 1 },
    labelSelected: { color: colors.textPrimary, fontWeight: "600" },
    check: { marginRight: -2 },
  });
