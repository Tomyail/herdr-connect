import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "./connection";
import { useI18n } from "./i18n/I18nContext";
import { useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ScreenHeader } from "./ScreenHeader";
import { Settings } from "./Settings";

export function SettingsScreen() {
  const { state } = useConnection();
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader title={t("settings.screenTitle")} />
        <Settings connectionState={state} />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  });
