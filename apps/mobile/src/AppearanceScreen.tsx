import { useLayoutEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "./i18n/I18nContext";
import type { MessageKey } from "./i18n/messages";
import { Ionicons } from "./icons";
import { APPEARANCE_CHOICES, type AppearanceChoice } from "./theme/appearance";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import type { RootStackParamList } from "./navigation";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Appearance">;

/** Message key for an appearance option's display label. */
export function appearanceLabelKey(choice: AppearanceChoice): MessageKey {
  switch (choice) {
    case "system":
      return "appearance.option.system";
    case "light":
      return "appearance.option.light";
    case "dark":
      return "appearance.option.dark";
  }
}

export function AppearanceScreen() {
  const { t } = useI18n();
  const { appearance, colors, setAppearance } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<Navigation>();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("appearance.title"),
      headerBackTitle: t("settings.screenTitle"),
    });
  }, [navigation, t]);

  const choose = (next: AppearanceChoice) => {
    setAppearance(next);
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <View style={styles.list}>
        {APPEARANCE_CHOICES.map((value, index) => {
          const selected = appearance === value;
          const label = t(appearanceLabelKey(value));
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => choose(value)}
              style={({ pressed }) => [
                styles.row,
                index === APPEARANCE_CHOICES.length - 1 && styles.rowLast,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.label}>{label}</Text>
              {selected ? (
                <Ionicons name="checkmark" size={20} color={colors.accent} style={styles.check} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    list: {
      marginTop: 28,
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      paddingHorizontal: 17,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 50,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    rowLast: { borderBottomWidth: 0 },
    rowPressed: { opacity: 0.6 },
    label: { color: colors.textPrimary, fontSize: 16 },
    check: { marginRight: -2 },
  });
