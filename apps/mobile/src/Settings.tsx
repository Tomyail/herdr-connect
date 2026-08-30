import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { useMMKVBoolean, useMMKVString } from "react-native-mmkv";
import type { DiscoveredService } from "./discovery";

import appConfig from "../app.config";

const PROJECT_URL = "https://github.com/Tomyail/herdr-connect";
import { useI18n } from "./i18n/I18nContext";
import type { AppLanguage } from "./i18n/locale";
import type { MessageKey } from "./i18n/messages";
import type { AgentsResponse } from "./agent-contract";
import {
  DEFAULT_DONE_SOUND_ENABLED,
  DEFAULT_SENT_SOUND_ENABLED,
  DEFAULT_NOTIFY_WHILE_VIEWING,
  DEFAULT_LOCAL_NOTIFICATIONS_ENABLED,
  DEFAULT_AUTO_SEND_VOICE,
  DONE_SOUND_ENABLED_KEY,
  SENT_SOUND_ENABLED_KEY,
  NOTIFY_WHILE_VIEWING_KEY,
  LOCAL_NOTIFICATIONS_ENABLED_KEY,
  AUTO_SEND_VOICE_KEY,
  notificationStorage,
} from "./notifications/settings";
import { Ionicons, type IoniconName } from "./icons";
import { preferredAddress } from "./network";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { appearanceLabelKey } from "./AppearanceScreen";
import { useVoiceLanguage, VOICE_LANG_SYSTEM } from "./voice/VoiceLanguageContext";
import { localeDisplay } from "./voice/config";
import { silenceThresholdStorage } from "./voice/silenceThreshold";
import { displayInstanceLabel } from "./instance-alias";
import { readInstanceAlias, writeInstanceAlias, aliasKeyFor, instanceAliasStorage } from "./instance-alias-storage";
import type { DeviceCredentials } from "./paired-instances";
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
  sentSound,
  whileViewing,
  localNotifications,
  autoSendVoice,
  onDoneSoundChange,
  onSentSoundChange,
  onWhileViewingChange,
  onLocalNotificationsChange,
  onAutoSendVoiceChange,
}: {
  title: string;
  labels: { doneSound: string; sentSound: string; whileViewing: string; localNotifications: string; autoSendVoice: string };
  doneSound: boolean;
  sentSound: boolean;
  whileViewing: boolean;
  localNotifications: boolean;
  autoSendVoice: boolean;
  onDoneSoundChange: (value: boolean) => void;
  onSentSoundChange: (value: boolean) => void;
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
          icon="paper-plane-outline"
          label={labels.sentSound}
          value={sentSound}
          onChange={onSentSoundChange}
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
  onNavigateSilenceThreshold: () => void;
  onRequestPairing: () => void;
}

export interface SettingsCategory {
  key: SettingsCategoryKey;
  labelKey: MessageKey;
  icon: IoniconName;
  /** Renders this category's card(s). Memoized by the hook's own render cycle. */
  render: () => ReactNode;
}

// ─── 实例管理(#55) ───────────────────────────────────────────────────────────

/** 重命名弹窗(跨平台 prompt:Alert.prompt 仅 iOS,自建 Modal)。 */
function RenameInstanceModal({
  fingerprint,
  initial,
  onClose,
}: {
  fingerprint: string;
  initial: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState(initial);
  const save = () => {
    // 空白串 = 清除别名(回退指纹尾 8 位),与 normalizeInstanceAlias 一致。
    writeInstanceAlias(fingerprint, draft);
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.renameOverlay} onPress={onClose}>
        <Pressable style={styles.renameSheet}>
          <Text style={styles.renameTitle}>{t("instance.renameTitle")}</Text>
          <TextInput
            style={styles.renameInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("pairing.aliasPlaceholder")}
            placeholderTextColor={colors.textFaint}
            maxLength={64}
            autoFocus
            selectTextOnFocus
          />
          <View style={styles.renameActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.renameAction, pressed && styles.rowPressed]}
            >
              <Text style={styles.renameActionCancel}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={save}
              style={({ pressed }) => [styles.renameAction, pressed && styles.rowPressed]}
            >
              <Text style={styles.renameActionSave}>{t("instance.renameSave")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 单个已配对实例行:别名 + 可达/离线徽标 + 当前标记;点按弹管理菜单。 */
function InstanceRow({
  instance,
  isActive,
  reachable,
  last,
  onMenu,
}: {
  instance: DeviceCredentials;
  isActive: boolean;
  reachable: boolean;
  last: boolean;
  onMenu: (instance: DeviceCredentials, label: string) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // 响应式别名:重命名/配对后 MMKV 同 key 变更自动重渲染。
  const [alias] = useMMKVString(aliasKeyFor(instance.fingerprint), instanceAliasStorage);
  const label = displayInstanceLabel(alias, instance.fingerprint);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={isActive ? { selected: true } : undefined}
      onPress={() => onMenu(instance, label)}
      style={({ pressed }) => [styles.instanceRow, last && styles.rowLast, pressed && styles.rowPressed]}
    >
      <View style={styles.rowLeading}>
        <View style={[styles.instanceDot, reachable ? styles.instanceDotReachable : styles.instanceDotOffline]} />
        <View style={styles.instanceCopy}>
          <Text numberOfLines={1} style={styles.instanceLabel}>{label}</Text>
          <Text style={styles.instanceStatus}>
            {reachable ? t("instance.status.reachable") : t("instance.status.offline")}
          </Text>
        </View>
      </View>
      {isActive ? (
        <View style={styles.instanceActiveMark}>
          <Text style={styles.instanceActiveText}>{t("settings.value.active")}</Text>
          <Ionicons name="checkmark-circle" size={15} color={colors.accent} />
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} style={styles.chevron} />
      )}
    </Pressable>
  );
}

/**
 * 已配对实例管理卡片(#55):别名 + 可达/离线徽标(并行会话状态)+ 点按菜单
 * (切换/重命名/忘记)。忘记 = 删除本地凭据与别名 + DELETE /v1/device 吊销
 * token;吊销失败明确提示三选(仅本地删除/重试/取消),不静默——编排决策
 * 见 instance-revocation.ts,执行见 ConnectionProvider.forgetInstance。
 */
function PairedInstancesCard() {
  const { t, tError } = useI18n();
  const styles = useThemedStyles(createStyles);
  const { instances, activeFingerprint, switchInstance, forgetInstance, instanceStates } = useConnection();
  const [renaming, setRenaming] = useState<{ fingerprint: string; initial: string } | null>(null);

  if (instances.length === 0) return null;

  const openMenu = (instance: DeviceCredentials, label: string) => {
    const isActive = instance.fingerprint === activeFingerprint;
    const buttons: Array<{ text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }> = [];
    if (!isActive) {
      buttons.push({
        text: t("instance.switchTo"),
        onPress: () => void switchInstance(instance.fingerprint),
      });
    }
    buttons.push(
      {
        text: t("instance.rename"),
        onPress: () =>
          setRenaming({ fingerprint: instance.fingerprint, initial: readInstanceAlias(instance.fingerprint) ?? "" }),
      },
      {
        text: t("instance.forget"),
        style: "destructive",
        onPress: () => confirmForget(instance.fingerprint, label),
      },
      { text: t("common.cancel"), style: "cancel" },
    );
    Alert.alert(label, undefined, buttons);
  };

  const confirmForget = (fingerprint: string, label: string) => {
    Alert.alert(
      t("instance.forgetConfirmTitle", { name: label }),
      t("instance.forgetConfirmBody"),
      [
        { text: t("instance.forgetAction"), style: "destructive", onPress: () => void runForgetInstance(fingerprint) },
        { text: t("common.cancel"), style: "cancel" },
      ],
    );
  };

  const runForgetInstance = async (fingerprint: string) => {
    const result = await forgetInstance(fingerprint);
    switch (result.outcome) {
      case "forgotten":
        Alert.alert(t("instance.section"), t("instance.forgotten"));
        return;
      case "not_found":
        // 幂等重入(已被鉴权终态移除等):无需提示。
        return;
      case "revocation_unavailable":
      case "revocation_failed": {
        // 不静默:交用户裁决——仅本地删除 / 重试 / 取消。
        const detail =
          result.outcome === "revocation_failed" ? `\n\n${tError(result.code)}` : "";
        Alert.alert(t("instance.revocationFailedTitle"), `${t("instance.revocationFailedBody")}${detail}`, [
          {
            text: t("instance.removeLocally"),
            style: "destructive",
            onPress: () => void forgetInstance(fingerprint, { localOnly: true }),
          },
          { text: t("instance.retry"), onPress: () => void runForgetInstance(fingerprint) },
          { text: t("common.cancel"), style: "cancel" },
        ]);
        return;
      }
    }
  };

  return (
    <>
      <Text style={styles.sectionTitle}>{t("instance.section")}</Text>
      <View style={styles.card}>
        {instances.map((instance, index) => (
          <InstanceRow
            key={instance.fingerprint}
            instance={instance}
            isActive={instance.fingerprint === activeFingerprint}
            reachable={instanceStates[instance.fingerprint]?.phase === "connected"}
            last={index === instances.length - 1}
            onMenu={openMenu}
          />
        ))}
      </View>
      {renaming ? (
        <RenameInstanceModal
          fingerprint={renaming.fingerprint}
          initial={renaming.initial}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </>
  );
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
  const { instances, activeFingerprint } = useConnection();
  const { choice: voiceChoice } = useVoiceLanguage();

  const connected = connectionState.phase === "connected" ? connectionState : undefined;
  const service: DiscoveredService | undefined = connected?.service;
  const data: AgentsResponse | undefined = connected?.data;

  // 实例列表来自 ConnectionProvider（配对/解绑/切换后自动同步）；这里不再
  // 单独读凭据存储，单一数据源避免与连接层不一致。

  // Notifications switches — single MMKV subscription set shared by both modes.
  const [enabled, setEnabled] = useMMKVBoolean(DONE_SOUND_ENABLED_KEY, notificationStorage);
  const [sentSound, setSentSound] = useMMKVBoolean(SENT_SOUND_ENABLED_KEY, notificationStorage);
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
  // #55:已配对实例列表升级为独立管理卡片(别名/徽标/切换/重命名/忘记,
  // 见 PairedInstancesCard);本卡只保留配对入口与设备名。
  const activeInstance = instances.find((instance) => instance.fingerprint === activeFingerprint);
  const pairingRows: SettingsRow[] = [];
  if (instances.length === 0) {
    pairingRows.push(
      { icon: "finger-print-outline", label: t("settings.row.status"), value: t("settings.value.notPaired") },
    );
  }
  pairingRows.push(
    { icon: "qr-code-outline", label: t("settings.row.pairDevice"), value: "", onPress: navigation.onRequestPairing },
  );
  if (activeInstance) {
    pairingRows.push(
      { icon: "phone-portrait-outline", label: t("settings.row.deviceName"), value: activeInstance.deviceName },
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
            {
              icon: "time-outline",
              label: t("settings.row.silenceThreshold"),
              value: t("settings.value.silenceThreshold", { n: (silenceThresholdStorage.read() / 1000).toFixed(1) }),
              onPress: navigation.onNavigateSilenceThreshold,
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
            sentSound: t("settings.row.sentSound"),
            whileViewing: t("settings.row.notifyWhileViewing"),
            localNotifications: t("settings.row.localNotifications"),
            autoSendVoice: t("settings.row.autoSendVoice"),
          }}
          doneSound={enabled ?? DEFAULT_DONE_SOUND_ENABLED}
          sentSound={sentSound ?? DEFAULT_SENT_SOUND_ENABLED}
          whileViewing={whileViewing ?? DEFAULT_NOTIFY_WHILE_VIEWING}
          localNotifications={localNotifications ?? DEFAULT_LOCAL_NOTIFICATIONS_ENABLED}
          autoSendVoice={autoSendVoice ?? DEFAULT_AUTO_SEND_VOICE}
          onDoneSoundChange={setEnabled}
          onSentSoundChange={setSentSound}
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
      render: () => (
        <>
          <PairedInstancesCard />
          <SettingsCard title={t("settings.section.discovery")} rows={pairingRows} />
        </>
      ),
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
      onNavigateSilenceThreshold: () => rootNavigation.navigate("SilenceThreshold"),
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
    // ── 实例管理卡片(#55) ──
    instanceRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    instanceCopy: { flexShrink: 1 },
    instanceLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
    instanceStatus: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    instanceDot: { width: 9, height: 9, borderRadius: 5 },
    instanceDotReachable: { backgroundColor: colors.statusDotConnected },
    instanceDotOffline: { backgroundColor: colors.textFaint },
    instanceActiveMark: { flexDirection: "row", alignItems: "center", gap: 4 },
    instanceActiveText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
    // ── 重命名弹窗 ──
    renameOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.32)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    renameSheet: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      padding: 20,
      width: "100%",
      maxWidth: 360,
    },
    renameTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", marginBottom: 14 },
    renameInput: {
      color: colors.textPrimary,
      fontSize: 15,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
    },
    renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: 18, marginTop: 16 },
    renameAction: { paddingVertical: 6, paddingHorizontal: 8 },
    renameActionCancel: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
    renameActionSave: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  });
