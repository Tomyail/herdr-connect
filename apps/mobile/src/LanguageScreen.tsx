import { useLayoutEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "./i18n/I18nContext";
import type { AppLanguage } from "./i18n/locale";
import type { MessageKey } from "./i18n/messages";
import { Ionicons } from "./icons";
import type { RootStackParamList } from "./navigation";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Language">;

const OPTIONS: AppLanguage[] = ["system", "zh-Hans", "en"];

/** Message key for a language option's display label. zh-Hans/English keep their own script. */
function optionLabelKey(language: AppLanguage): MessageKey {
  switch (language) {
    case "system":
      return "language.option.system";
    case "zh-Hans":
      return "language.option.zhHans";
    case "en":
      return "language.option.en";
  }
}

export function LanguageScreen() {
  const { t, language, setLanguage } = useI18n();
  const navigation = useNavigation<Navigation>();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("language.title"),
      headerBackTitle: t("settings.screenTitle"),
    });
  }, [navigation, t]);

  const choose = (next: AppLanguage) => {
    setLanguage(next);
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <View style={styles.list}>
        {OPTIONS.map((value, index) => {
          const selected = language === value;
          const label = t(optionLabelKey(value));
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => choose(value)}
              style={({ pressed }) => [
                styles.row,
                index === OPTIONS.length - 1 && styles.rowLast,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.label}>{label}</Text>
              {selected ? (
                <Ionicons name="checkmark" size={20} color="#466447" style={styles.check} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F1EA" },
  list: {
    marginTop: 28,
    marginHorizontal: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DAD8D0",
    paddingHorizontal: 17,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 50,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECEAE3",
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { opacity: 0.6 },
  label: { color: "#1D201C", fontSize: 16 },
  check: { marginRight: -2 },
});
