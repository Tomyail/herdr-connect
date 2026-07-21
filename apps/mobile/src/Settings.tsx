import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { useMMKVBoolean } from "react-native-mmkv";
import type { DiscoveredService } from "./discovery";

import appConfig from "../app.config";

const PROJECT_URL = "https://github.com/Tomyail/herdr-connect";
import { useI18n } from "./i18n/I18nContext";
import type { AppLanguage } from "./i18n/locale";
import type { MessageKey } from "./i18n/messages";
import type { AgentsResponse } from "./agent-contract";
import {
  DEFAULT_DONE_SOUND_ENABLED,
  DEFAULT_NOTIFY_WHILE_VIEWING,
  DEFAULT_LOCAL_NOTIFICATIONS_ENABLED,
  DONE_SOUND_ENABLED_KEY,
  NOTIFY_WHILE_VIEWING_KEY,
  LOCAL_NOTIFICATIONS_ENABLED_KEY,
  notificationStorage,
} from "./notifications/settings";
import { Ionicons, type IoniconName } from "./icons";
import { preferredAddress } from "./network";
import { loadCredentials, type DeviceCredentials } from "./credentials";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { appearanceLabelKey } from "./AppearanceScreen";
import type { RootStackParamList } from "./navigation";
import type { ConnectionState } from "./connection";
import { useConnection } from "./connection";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

interface SettingsProps {
  connectionState: ConnectionState;
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
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row, index) => {
          const content = (
            <>
              <View style={styles.rowLeading}>
                <Ionicons name={row.icon} size={17} color={colors.textMuted} />
                <Text style={styles.rowLabel}>{row.label}</Text>
              </View>
              <View style={styles.rowTrailing}>
                <Text numberOfLines={1} style={styles.rowValue}>{row.value}</Text>
                {row.onPress ? (
                  <Ionicons name="chevron-forward" size={15} color={colors.textFaint} style={styles.chevron} />
                ) : null}
              </View>
            </>
          );
          const rowStyle = [styles.row, index === rows.length - 1 && styles.rowLast];
          return row.onPress ? (
            <Pressable
              accessibilityRole="button"
              key={row.label}
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

function SwitchRow({
  icon,
  label,
  value,
  onChange,
  last,
}: {
  icon: IoniconName;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowLeading}>
        <Ionicons name={icon} size={17} color={colors.textMuted} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch
        accessibilityRole="switch"
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
        thumbColor={colors.switchThumb}
      />
    </View>
  );
}

function NotificationsCard() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [enabled, setEnabled] = useMMKVBoolean(DONE_SOUND_ENABLED_KEY, notificationStorage);
  const [whileViewing, setWhileViewing] = useMMKVBoolean(NOTIFY_WHILE_VIEWING_KEY, notificationStorage);
  const [localNotifications, setLocalNotifications] = useMMKVBoolean(
    LOCAL_NOTIFICATIONS_ENABLED_KEY,
    notificationStorage,
  );

  const handleLocalNotificationsChange = useCallback(
    async (newValue: boolean) => {
      setLocalNotifications(newValue);
      if (newValue) {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === "undetermined") {
          await Notifications.requestPermissionsAsync().catch((error) => {
            console.warn("[Settings] requestPermissionsAsync failed:", error);
          });
        }
      }
    },
    [setLocalNotifications],
  );

  return (
    <>
      <Text style={styles.sectionTitle}>{t("settings.section.notifications")}</Text>
      <View style={styles.card}>
        <SwitchRow
          icon="volume-high-outline"
          label={t("settings.row.doneSound")}
          value={enabled ?? DEFAULT_DONE_SOUND_ENABLED}
          onChange={setEnabled}
          last={false}
        />
        <SwitchRow
          icon="eye-outline"
          label={t("settings.row.notifyWhileViewing")}
          value={whileViewing ?? DEFAULT_NOTIFY_WHILE_VIEWING}
          onChange={setWhileViewing}
          last={false}
        />
        <SwitchRow
          icon="notifications-outline"
          label={t("settings.row.localNotifications")}
          value={localNotifications ?? DEFAULT_LOCAL_NOTIFICATIONS_ENABLED}
          onChange={handleLocalNotificationsChange}
          last={true}
        />
      </View>
    </>
  );
}

export function Settings({ connectionState }: SettingsProps) {
  const { t, language } = useI18n();
  const { appearance } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<Navigation>();
  const { unpair } = useConnection();

  const connected = connectionState.phase === "connected" ? connectionState : undefined;
  const service: DiscoveredService | undefined = connected?.service;
  const data: AgentsResponse | undefined = connected?.data;

  // Load credentials eagerly so the Settings screen always shows current pairing
  // state even when not connected (e.g. not_paired / fingerprint_mismatch).
  const [creds, setCreds] = useState<DeviceCredentials | null>(null);
  const reloadCreds = useCallback(async () => {
    const c = await loadCredentials();
    setCreds(c);
  }, []);
  useEffect(() => {
    void reloadCreds();
  }, [reloadCreds]);

  const handleUnpair = useCallback(async () => {
    await unpair();
    setCreds(null);
  }, [unpair]);

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

  // Pairing section — separate card so the connection card stays about the live
  // daemon link while this one is about the persistent pairing identity.
  const pairingRows: SettingsRow[] = [];
  if (creds) {
    pairingRows.push(
      { icon: "finger-print-outline", label: t("settings.row.fingerprint"), value: creds.fingerprint.slice(-8) },
      { icon: "phone-portrait-outline", label: t("settings.row.deviceName"), value: creds.deviceName },
    );
    pairingRows.push(
      { icon: "qr-code-outline", label: t("settings.row.pairDevice"), value: "", onPress: () => navigation.navigate("Pairing") },
      { icon: "trash-outline", label: t("settings.row.unpairDevice"), value: "", onPress: () => void handleUnpair() },
    );
  } else {
    pairingRows.push(
      { icon: "finger-print-outline", label: t("settings.row.status"), value: t("settings.value.notPaired") },
      { icon: "qr-code-outline", label: t("settings.row.pairDevice"), value: "", onPress: () => navigation.navigate("Pairing") },
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
          {
            icon: "contrast-outline",
            label: t("settings.row.appearance"),
            value: t(appearanceLabelKey(appearance)),
            onPress: () => navigation.navigate("Appearance"),
          },
        ]}
      />
      <NotificationsCard />
      <SettingsCard title={t("settings.section.connection")} rows={connectionRows} />
      <SettingsCard title={t("settings.section.discovery")} rows={pairingRows} />
      <SettingsCard
        title={t("settings.section.about")}
        rows={[
          { icon: "phone-portrait-outline", label: t("settings.row.app"), value: appConfig.name },
          { icon: "information-circle-outline", label: t("settings.row.version"), value: appConfig.version ?? t("common.unknown") },
          {
            icon: "logo-github",
            label: t("settings.row.project"),
            value: "",
            onPress: () => void Linking.openURL(PROJECT_URL),
          },
        ]}
      />
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { paddingBottom: 28 },
    sectionTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "700", marginBottom: 12 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
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
      borderBottomColor: colors.separator,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLeading: { flexDirection: "row", alignItems: "center", gap: 9 },
    rowLabel: { color: colors.textSecondary, fontSize: 14 },
    rowTrailing: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
    rowValue: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", flexShrink: 1 },
    chevron: { marginLeft: 2 },
    rowPressed: { opacity: 0.6 },
  });
