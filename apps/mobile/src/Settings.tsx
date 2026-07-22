import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  DEFAULT_AUTO_SEND_VOICE,
  DONE_SOUND_ENABLED_KEY,
  NOTIFY_WHILE_VIEWING_KEY,
  LOCAL_NOTIFICATIONS_ENABLED_KEY,
  AUTO_SEND_VOICE_KEY,
  notificationStorage,
} from "./notifications/settings";
import { Ionicons, type IoniconName } from "./icons";
import { preferredAddress } from "./network";
import { loadCredentials, type DeviceCredentials } from "./credentials";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { appearanceLabelKey } from "./AppearanceScreen";
import { useVoiceLanguage, VOICE_LANG_SYSTEM } from "./voice/VoiceLanguageContext";
import { localeDisplay } from "./voice/config";
import type { ConnectionState } from "./connection";
import { useConnection } from "./connection";
import type { RootStackParamList } from "./navigation";

/** The five existing Settings sections, used as the category list in wide mode. */
export type SettingsCategoryKey = "general" | "notifications" | "connection" | "discovery" | "about";

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

/** Notifications section card (switches, not value rows). Presentational — the
 *  switch values/handlers are owned by {@link useSettingsCategories}. */
function NotificationsCard({
  title,
  labels,
  doneSound,
  whileViewing,
  localNotifications,
  autoSendVoice,
  onDoneSoundChange,
  onWhileViewingChange,
  onLocalNotificationsChange,
  onAutoSendVoiceChange,
}: {
  title: string;
  labels: { doneSound: string; whileViewing: string; localNotifications: string; autoSendVoice: string };
  doneSound: boolean;
  whileViewing: boolean;
  localNotifications: boolean;
  autoSendVoice: boolean;
  onDoneSoundChange: (value: boolean) => void;
  onWhileViewingChange: (value: boolean) => void;
  onLocalNotificationsChange: (value: boolean) => void;
  onAutoSendVoiceChange: (value: boolean) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        <SwitchRow
          icon="volume-high-outline"
          label={labels.doneSound}
          value={doneSound}
          onChange={onDoneSoundChange}
          last={false}
        />
        <SwitchRow
          icon="eye-outline"
          label={labels.whileViewing}
          value={whileViewing}
          onChange={onWhileViewingChange}
          last={false}
        />
        <SwitchRow
          icon="notifications-outline"
          label={labels.localNotifications}
          value={localNotifications}
          onChange={onLocalNotificationsChange}
          last={false}
        />
        <SwitchRow
          icon="mic-outline"
          label={labels.autoSendVoice}
          value={autoSendVoice}
          onChange={onAutoSendVoiceChange}
          last={true}
        />
      </View>
    </>
  );
}

/**
 * Navigation surface for Settings actions. Both render modes implement this so
 * the per-category row building stays navigation-agnostic:
 *
 * - narrow {@link SettingsScreen}: language/appearance/pairing push onto the
 *   shared root native-stack (covering the full phone screen).
 * - wide split detail column: language/appearance push onto the detail column's
 *   own local nested stack; pairing is lifted to a full-app overlay.
 */
export interface SettingsNavigation {
  onNavigateLanguage: () => void;
  onNavigateAppearance: () => void;
  onNavigateVoiceLanguage: () => void;
  onRequestPairing: () => void;
}

export interface SettingsCategory {
  key: SettingsCategoryKey;
  labelKey: MessageKey;
  icon: IoniconName;
  /** Renders this category's card(s). Memoized by the hook's own render cycle. */
  render: () => ReactNode;
}

/**
 * Builds all five Settings categories from a single set of hooks, so narrow and
 * wide modes can never desync: MMKV switches, credential state, connection
 * state, and the unpair handler each live in exactly one place (here). Both
 * render modes consume this same hook output.
 *
 * `navigation` lets each mode route Language/Appearance/Pairing the way it needs
 * to, without the row-building code knowing which mode it is in.
 */
export function useSettingsCategories(
  connectionState: ConnectionState,
  navigation: SettingsNavigation,
): SettingsCategory[] {
  const { t, language } = useI18n();
  const { appearance } = useTheme();
  const { unpair } = useConnection();
  const { choice: voiceChoice } = useVoiceLanguage();

  const connected = connectionState.phase === "connected" ? connectionState : undefined;
  const service: DiscoveredService | undefined = connected?.service;
  const data: AgentsResponse | undefined = connected?.data;

  // Load credentials eagerly so Settings always shows current pairing state
  // even when not connected (e.g. not_paired / fingerprint_mismatch). Single
  // source of truth — both modes read the same `creds` value.
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

  // Notifications switches — single MMKV subscription set shared by both modes.
  const [enabled, setEnabled] = useMMKVBoolean(DONE_SOUND_ENABLED_KEY, notificationStorage);
  const [whileViewing, setWhileViewing] = useMMKVBoolean(NOTIFY_WHILE_VIEWING_KEY, notificationStorage);
  const [localNotifications, setLocalNotifications] = useMMKVBoolean(
    LOCAL_NOTIFICATIONS_ENABLED_KEY,
    notificationStorage,
  );
  const [autoSendVoice, setAutoSendVoice] = useMMKVBoolean(AUTO_SEND_VOICE_KEY, notificationStorage);

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
      { icon: "qr-code-outline", label: t("settings.row.pairDevice"), value: "", onPress: navigation.onRequestPairing },
      { icon: "trash-outline", label: t("settings.row.unpairDevice"), value: "", onPress: () => void handleUnpair() },
    );
  } else {
    pairingRows.push(
      { icon: "finger-print-outline", label: t("settings.row.status"), value: t("settings.value.notPaired") },
      { icon: "qr-code-outline", label: t("settings.row.pairDevice"), value: "", onPress: navigation.onRequestPairing },
    );
  }

  return [
    {
      key: "general",
      labelKey: "settings.section.general",
      icon: "settings-outline",
      render: () => (
        <SettingsCard
          title={t("settings.section.general")}
          rows={[
            {
              icon: "language-outline",
              label: t("settings.row.language"),
              value: t(languageValueKey(language)),
              onPress: navigation.onNavigateLanguage,
            },
            {
              icon: "contrast-outline",
              label: t("settings.row.appearance"),
              value: t(appearanceLabelKey(appearance)),
              onPress: navigation.onNavigateAppearance,
            },
            {
              icon: "mic-outline",
              label: t("settings.row.voiceLanguage"),
              value: voiceChoice === VOICE_LANG_SYSTEM ? t("settings.value.voiceLanguageSystem") : localeDisplay(voiceChoice),
              onPress: navigation.onNavigateVoiceLanguage,
            },
          ]}
        />
      ),
    },
    {
      key: "notifications",
      labelKey: "settings.section.notifications",
      icon: "notifications-outline",
      render: () => (
        <NotificationsCard
          title={t("settings.section.notifications")}
          labels={{
            doneSound: t("settings.row.doneSound"),
            whileViewing: t("settings.row.notifyWhileViewing"),
            localNotifications: t("settings.row.localNotifications"),
            autoSendVoice: t("settings.row.autoSendVoice"),
          }}
          doneSound={enabled ?? DEFAULT_DONE_SOUND_ENABLED}
          whileViewing={whileViewing ?? DEFAULT_NOTIFY_WHILE_VIEWING}
          localNotifications={localNotifications ?? DEFAULT_LOCAL_NOTIFICATIONS_ENABLED}
          autoSendVoice={autoSendVoice ?? DEFAULT_AUTO_SEND_VOICE}
          onDoneSoundChange={setEnabled}
          onWhileViewingChange={setWhileViewing}
          onLocalNotificationsChange={handleLocalNotificationsChange}
          onAutoSendVoiceChange={setAutoSendVoice}
        />
      ),
    },
    {
      key: "connection",
      labelKey: "settings.section.connection",
      icon: "wifi-outline",
      render: () => <SettingsCard title={t("settings.section.connection")} rows={connectionRows} />,
    },
    {
      key: "discovery",
      labelKey: "settings.section.discovery",
      icon: "qr-code-outline",
      render: () => <SettingsCard title={t("settings.section.discovery")} rows={pairingRows} />,
    },
    {
      key: "about",
      labelKey: "settings.section.about",
      icon: "information-circle-outline",
      render: () => (
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
      ),
    },
  ];
}

type RootStackNavigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Narrow-mode Settings: all five categories in a single scroll, exactly as
 * before. Consumes the same {@link useSettingsCategories} hook as the wide
 * layout so behavior and data never diverge. The shared root native-stack is
 * the navigation target for Language/Appearance/Pairing (all cover the full
 * phone screen via push).
 */
export function Settings({ connectionState }: { connectionState: ConnectionState }) {
  const rootNavigation = useNavigation<RootStackNavigation>();
  const navigation = useMemo<SettingsNavigation>(
    () => ({
      onNavigateLanguage: () => rootNavigation.navigate("Language"),
      onNavigateAppearance: () => rootNavigation.navigate("Appearance"),
      onNavigateVoiceLanguage: () => rootNavigation.navigate("VoiceLanguage"),
      onRequestPairing: () => rootNavigation.navigate("Pairing"),
    }),
    [rootNavigation],
  );
  const categories = useSettingsCategories(connectionState, navigation);

  const styles = useThemedStyles(createStyles);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={styles.screen}
    >
      {categories.map((category) => (
        <View key={category.key}>{category.render()}</View>
      ))}
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
