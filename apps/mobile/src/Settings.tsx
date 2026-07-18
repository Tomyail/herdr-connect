import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Service } from "@inthepocket/react-native-service-discovery";

import appConfig from "../app.config";
import { useI18n } from "./i18n/I18nContext";
import type { AppLanguage } from "./i18n/locale";
import type { MessageKey } from "./i18n/messages";
import type { DemoAgentsResponse } from "./demo-contract";
import { Ionicons, type IoniconName } from "./icons";
import { preferredAddress } from "./network";
import type { RootStackParamList } from "./navigation";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

interface SettingsProps {
  service?: Service;
  data?: DemoAgentsResponse;
}

interface SettingsRow {
  icon: IoniconName;
  label: string;
  value: string;
  onPress?: () => void;
}

function languageValueKey(language: AppLanguage): MessageKey {
  switch (language) {
    case "system":
      return "settings.value.languageSystem";
    case "zh-Hans":
      return "language.option.zhHans";
    case "en":
      return "language.option.en";
  }
}

function SettingsCard({ title, rows }: { title: string; rows: SettingsRow[] }) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row, index) => {
          const content = (
            <>
              <View style={styles.rowLeading}>
                <Ionicons name={row.icon} size={17} color="#8A8E86" />
                <Text style={styles.rowLabel}>{row.label}</Text>
              </View>
              <View style={styles.rowTrailing}>
                <Text numberOfLines={1} style={styles.rowValue}>{row.value}</Text>
                {row.onPress ? (
                  <Ionicons name="chevron-forward" size={15} color="#B4B7B0" style={styles.chevron} />
                ) : null}
              </View>
            </>
          );
          const rowStyle = [styles.row, index === rows.length - 1 && styles.rowLast];
          return row.onPress ? (
            <Pressable
              key={row.label}
              accessibilityRole="button"
              onPress={row.onPress}
              style={({ pressed }) => [rowStyle, pressed && styles.rowPressed]}
            >
              {content}
            </Pressable>
          ) : (
            <View key={row.label} style={rowStyle}>
              {content}
            </View>
          );
        })}
      </View>
    </>
  );
}

export function Settings({ service, data }: SettingsProps) {
  const { t, language } = useI18n();
  const navigation = useNavigation<Navigation>();

  const connectionRows: SettingsRow[] = [
    { icon: "radio-outline", label: t("settings.row.status"), value: service ? t("settings.value.connected") : t("settings.value.notConnected") },
  ];
  if (service) {
    connectionRows.push(
      { icon: "desktop-outline", label: t("settings.row.daemon"), value: service.name },
      { icon: "globe-outline", label: t("settings.row.address"), value: `${preferredAddress(service.addresses) ?? t("common.unknown")}:${service.port}` },
    );
  }
  if (data) {
    connectionRows.push(
      { icon: "terminal-outline", label: t("settings.row.source"), value: data.source_name },
      { icon: "pulse-outline", label: t("settings.row.sourceStatus"), value: data.source_online ? t("settings.value.online") : t("settings.value.offline") },
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={styles.screen}
    >
      <SettingsCard
        title={t("settings.section.general")}
        rows={[
          {
            icon: "language-outline",
            label: t("settings.row.language"),
            value: t(languageValueKey(language)),
            onPress: () => navigation.navigate("Language"),
          },
        ]}
      />
      <SettingsCard title={t("settings.section.connection")} rows={connectionRows} />
      <SettingsCard
        title={t("settings.section.discovery")}
        rows={[
          { icon: "pricetag-outline", label: t("settings.row.serviceType"), value: "_herdr-connect._tcp" },
          { icon: "wifi-outline", label: t("settings.row.discoveryMethod"), value: t("settings.value.discoveryMethod") },
        ]}
      />
      <SettingsCard
        title={t("settings.section.about")}
        rows={[
          { icon: "phone-portrait-outline", label: t("settings.row.app"), value: appConfig.name },
          { icon: "information-circle-outline", label: t("settings.row.version"), value: appConfig.version ?? t("common.unknown") },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 28 },
  sectionTitle: { color: "#1B1E1A", fontSize: 21, fontWeight: "700", marginBottom: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DAD8D0",
    paddingHorizontal: 17,
    marginBottom: 26,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECEAE3",
  },
  rowLast: { borderBottomWidth: 0 },
  rowLeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowLabel: { color: "#777B72", fontSize: 14 },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  rowValue: { color: "#1D201C", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  chevron: { marginLeft: 2 },
  rowPressed: { opacity: 0.6 },
});
