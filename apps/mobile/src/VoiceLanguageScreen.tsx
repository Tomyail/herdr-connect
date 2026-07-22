import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "./i18n/I18nContext";
import { Ionicons } from "./icons";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { useVoiceLanguage, VOICE_LANG_SYSTEM } from "./voice/VoiceLanguageContext";
import { loadSupportedVoiceLocales, localeDisplay } from "./voice/config";

export function VoiceLanguageScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<NativeStackNavigationProp<{ VoiceLanguage: undefined }, "VoiceLanguage">>();
  const { choice, setChoice } = useVoiceLanguage();
  const [supported, setSupported] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    void loadSupportedVoiceLocales().then((result) => setSupported(result.locales));
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("voice.language.title"),
      headerBackTitle: t("settings.screenTitle"),
    });
  }, [navigation, t]);

  const choose = (lang: string) => {
    setChoice(lang);
    if (navigation.canGoBack()) navigation.goBack();
  };

  const options: string[] = [VOICE_LANG_SYSTEM, ...(supported ?? [])];

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {options.map((value) => {
          const selected = value === choice;
          const label = value === VOICE_LANG_SYSTEM ? t("voice.language.system") : localeDisplay(value);
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => choose(value)}
              style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
            >
              <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
              {selected ? <Ionicons name="checkmark" size={20} color={colors.accent} style={styles.check} /> : null}
            </Pressable>
          );
        })}
        {supported === undefined ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.spinner} />
          </View>
        ) : null}
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
    loading: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
  });
