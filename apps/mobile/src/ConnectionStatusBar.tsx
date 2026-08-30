/**
 * 连接状态条 + 实例总控(issue #55 后续 UX 调整)。
 *
 * 替代 AgentsScreen 原有的绿色"已连接"状态卡、header 角落的实例切换器
 * 胶囊、以及 Settings 的"发现/配对"section——所有配对管理与切换集中到
 * 这一处:
 *
 * - 显示焦点实例的连接相位(标题/详情文案由 AgentsScreen 组装传入)、
 *   状态点(discovering 显示 spinner)、connected 时的 live/polling 徽标;
 * - 已配对实例 ≥ 1 时整条可点,打开菜单:
 *   · 实例行:点按 = 切换活动实例(并行会话,零等待);行尾 ⋯ = 管理
 *     (切换到/重命名/忘记,Alert 菜单——自 Settings 迁入);
 *   · 底部"配对新实例"行,进入配对流程(onStartPairing 由挂载方注入:
 *     窄屏 root-stack push,宽屏全屏 overlay);
 * - 未配对(0 实例)时,整条即配对入口:点击直接进入配对流程。
 * - 忘记 = 删除本地凭据与别名 + DELETE /v1/device 吊销 token,失败明确
 *   提示三选(仅本地删除/重试/取消)——编排决策见 instance-revocation.ts,
 *   执行见 ConnectionProvider.forgetInstance。
 */

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useMMKVString } from "react-native-mmkv";

import { useConnection } from "./connection";
import type { DeviceCredentials } from "./paired-instances";
import { displayInstanceLabel } from "./instance-alias";
import { aliasKeyFor, instanceAliasStorage, readInstanceAlias, writeInstanceAlias } from "./instance-alias-storage";
import { useI18n } from "./i18n/I18nContext";
import { Ionicons } from "./icons";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";

/** 徽标二元语义:会话 connected = 可达;其余相位(discovering/not_found/
 *  failed/终态)对用户都表现为"现在拿不到它的数据" = 离线。 */
function isReachable(phase: string | undefined): boolean {
  return phase === "connected";
}

/** 单个实例行的别名文本(响应式:重命名/配对后 MMKV 同 key 变更自动重渲)。 */
function InstanceLabel({
  fingerprint,
  style,
}: {
  fingerprint: string;
  style: StyleProp<TextStyle>;
}) {
  const [alias] = useMMKVString(aliasKeyFor(fingerprint), instanceAliasStorage);
  return (
    <Text numberOfLines={1} style={style}>
      {displayInstanceLabel(alias, fingerprint)}
    </Text>
  );
}

/** 重命名弹窗(跨平台 prompt:Alert.prompt 仅 iOS,自建 Modal)。自 Settings 迁入。 */
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
              style={({ pressed }) => [styles.renameAction, pressed && styles.renamePressed]}
            >
              <Text style={styles.renameActionCancel}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={save}
              style={({ pressed }) => [styles.renameAction, pressed && styles.renamePressed]}
            >
              <Text style={styles.renameActionSave}>{t("instance.renameSave")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ConnectionStatusBar({
  statusTitle,
  statusDetail,
  phase,
  streamStatus,
  onStartPairing,
}: {
  /** 焦点实例相位标题(已配对文案,如"已连接"/"正在发现")。 */
  statusTitle: string;
  /** 相位详情文案(实例名/错误说明等)。 */
  statusDetail: string;
  /** 焦点实例当前相位,仅判 connected(绿)与 discovering(spinner)。 */
  phase: string;
  /** 焦点实例的流状态,connected 时显示 live/polling 徽标。 */
  streamStatus: "live" | "polling";
  /** 进入配对流程:窄屏 push 到 Pairing,宽屏全屏 overlay。 */
  onStartPairing: () => void;
}) {
  const { t, tError } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { instances, activeFingerprint, switchInstance, forgetInstance, instanceStates } = useConnection();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ fingerprint: string; initial: string } | null>(null);
  /** 切换在途标记:防连点。 */
  const switchingRef = useRef(false);

  const connected = phase === "connected";
  const discovering = phase === "discovering";
  const paired = instances.length >= 1 && !!activeFingerprint;

  useEffect(() => {
    // 实例集合清空(全部忘记/解绑)时收起菜单;状态条本身退化为配对入口。
    if (open && instances.length < 1) setOpen(false);
  }, [instances.length, open]);

  const handleSelect = (fingerprint: string) => {
    setOpen(false);
    if (fingerprint === activeFingerprint || switchingRef.current) return;
    switchingRef.current = true;
    void switchInstance(fingerprint).finally(() => {
      switchingRef.current = false;
    });
  };

  // ── 实例管理(切换/重命名/忘记),自 Settings.PairedInstancesCard 迁入 ──

  const openInstanceMenu = (instance: DeviceCredentials, label: string) => {
    const isActive = instance.fingerprint === activeFingerprint;
    const buttons: Array<{ text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }> = [];
    if (!isActive) {
      buttons.push({
        text: t("instance.switchTo"),
        onPress: () => handleSelect(instance.fingerprint),
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

  const startPairing = () => {
    setOpen(false);
    onStartPairing();
  };

  const bar = (
    <View style={[styles.statusCard, connected && styles.statusConnected]}>
      <View style={[styles.statusDot, connected && styles.statusDotConnected]} />
      <View style={styles.statusCopy}>
        <Text style={styles.statusTitle}>{statusTitle}</Text>
        <Text style={styles.statusDetail}>{statusDetail}</Text>
      </View>
      {discovering ? <ActivityIndicator color={colors.spinner} /> : null}
      {connected ? (
        <Text style={[styles.streamPill, streamStatus === "live" ? styles.streamPillLive : styles.streamPillPolling]}>
          {streamStatus === "live" ? t("connection.live") : t("connection.polling")}
        </Text>
      ) : null}
      <Ionicons name="chevron-down" size={15} color={colors.textFaint} />
    </View>
  );

  return (
    <>
      {/* 已配对:开管理菜单;未配对:整条即配对入口。 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paired ? t("switcher.openA11y") : t("switcher.pairA11y")}
        onPress={() => (paired ? setOpen(true) : startPairing())}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressablePressed]}
      >
        {bar}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          accessibilityLabel={t("common.cancel")}
          onPress={() => setOpen(false)}
          style={styles.overlay}
        >
          <View style={styles.menu} accessibilityRole="menu">
            {instances.map((instance, index) => {
              const isActive = instance.fingerprint === activeFingerprint;
              const reachable = isReachable(instanceStates[instance.fingerprint]?.phase);
              return (
                <View
                  key={instance.fingerprint}
                  style={[
                    styles.item,
                    index === instances.length - 1 && styles.itemLast,
                  ]}
                >
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={isActive ? { selected: true } : undefined}
                    onPress={() => handleSelect(instance.fingerprint)}
                    style={({ pressed }) => [styles.itemMain, pressed && styles.itemPressed]}
                  >
                    <View
                      style={[
                        styles.itemDot,
                        reachable ? styles.itemDotReachable : styles.itemDotOffline,
                      ]}
                    />
                    <View style={styles.itemBody}>
                      <InstanceLabel fingerprint={instance.fingerprint} style={styles.itemLabel} />
                      <Text style={styles.itemStatus}>
                        {reachable ? t("switcher.reachable") : t("switcher.offline")}
                      </Text>
                    </View>
                    {isActive ? <Ionicons name="checkmark" size={17} color={colors.accent} /> : null}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("switcher.manageA11y")}
                    onPress={() => openInstanceMenu(instance, displayInstanceLabel(readInstanceAlias(instance.fingerprint), instance.fingerprint))}
                    style={({ pressed }) => [styles.itemMore, pressed && styles.itemPressed]}
                  >
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.textFaint} />
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              accessibilityRole="menuitem"
              onPress={startPairing}
              style={({ pressed }) => [styles.pairNewRow, pressed && styles.itemPressed]}
            >
              <Ionicons name="add" size={16} color={colors.accent} />
              <Text style={styles.pairNewText}>{t("switcher.pairNew")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    pressable: {},
    pressablePressed: { opacity: 0.82 },
    statusCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.statusCard,
      borderRadius: 18,
      padding: 16,
      marginBottom: 28,
    },
    statusConnected: { backgroundColor: colors.statusCardConnected },
    statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.statusDot, marginRight: 12 },
    statusDotConnected: { backgroundColor: colors.statusDotConnected },
    statusCopy: { flex: 1 },
    statusTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 3 },
    statusDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    streamPill: { fontSize: 11, fontWeight: "700", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, overflow: "hidden", letterSpacing: 0.2, marginLeft: 8 },
    streamPillLive: { color: colors.success, backgroundColor: colors.statusCard },
    streamPillPolling: { color: colors.textSecondary, backgroundColor: colors.statusCard },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.28)" },
    menu: {
      position: "absolute",
      top: 118,
      right: 20,
      left: 20,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      paddingVertical: 6,
      maxWidth: 420,
      alignSelf: "flex-end",
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    itemLast: { borderBottomWidth: 0 },
    itemMain: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      gap: 12,
      paddingLeft: 16,
      paddingVertical: 13,
    },
    itemMore: { paddingVertical: 13, paddingRight: 14, paddingLeft: 6 },
    itemPressed: { opacity: 0.6 },
    itemDot: { width: 9, height: 9, borderRadius: 5 },
    itemDotReachable: { backgroundColor: colors.statusDotConnected },
    itemDotOffline: { backgroundColor: colors.textFaint },
    itemBody: { flex: 1 },
    itemLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
    itemStatus: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    pairNewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    pairNewText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
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
    renamePressed: { opacity: 0.6 },
    renameActionCancel: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
    renameActionSave: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  });
