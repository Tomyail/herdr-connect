/**
 * 连接状态条(issue #55 后续 UX 调整)。
 *
 * 替代 AgentsScreen 原有的绿色"已连接"状态卡与 header 角落的实例切换器
 * 胶囊,二者合并为一个整行状态条:
 *
 * - 显示焦点实例的连接相位(标题/详情文案由 AgentsScreen 组装传入)、
 *   状态点(discovering 显示 spinner)、connected 时的 live/polling 徽标;
 * - 已配对实例 ≥ 2 时,状态条可点开实例切换菜单(原 InstanceSwitcher 的
 *   下拉菜单原样保留:别名 + 可达/离线徽标 + checkmark),并显示 chevron;
 * - 单实例或未配对时退化为纯状态条,不可点。
 */

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useMMKVString } from "react-native-mmkv";

import { useConnection } from "./connection";
import { displayInstanceLabel } from "./instance-alias";
import { aliasKeyFor, instanceAliasStorage } from "./instance-alias-storage";
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

export function ConnectionStatusBar({
  statusTitle,
  statusDetail,
  phase,
  streamStatus,
}: {
  /** 焦点实例相位标题(已配对文案,如"已连接"/"正在发现")。 */
  statusTitle: string;
  /** 相位详情文案(实例名/错误说明等)。 */
  statusDetail: string;
  /** 焦点实例当前相位,仅判 connected(绿)与 discovering(spinner)。 */
  phase: string;
  /** 焦点实例的流状态,connected 时显示 live/polling 徽标。 */
  streamStatus: "live" | "polling";
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { instances, activeFingerprint, switchInstance, instanceStates } = useConnection();
  const [open, setOpen] = useState(false);
  /** 切换在途标记:防连点。 */
  const switchingRef = useRef(false);

  const connected = phase === "connected";
  const discovering = phase === "discovering";
  const canSwitch = instances.length > 1 && !!activeFingerprint;

  useEffect(() => {
    // 实例集合收缩到 ≤1(忘记/解绑)时收起菜单;条目本身保留为纯状态条。
    if (open && instances.length < 2) setOpen(false);
  }, [instances.length, open]);

  const handleSelect = (fingerprint: string) => {
    setOpen(false);
    if (fingerprint === activeFingerprint || switchingRef.current) return;
    switchingRef.current = true;
    void switchInstance(fingerprint).finally(() => {
      switchingRef.current = false;
    });
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
      {canSwitch ? (
        <Ionicons name="chevron-down" size={15} color={colors.textFaint} />
      ) : null}
    </View>
  );

  return (
    <>
      {canSwitch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("switcher.openA11y")}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.pressable, pressed && styles.pressablePressed]}
        >
          {bar}
        </Pressable>
      ) : (
        bar
      )}

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
            {instances.map((instance) => {
              const isActive = instance.fingerprint === activeFingerprint;
              const reachable = isReachable(instanceStates[instance.fingerprint]?.phase);
              return (
                <Pressable
                  key={instance.fingerprint}
                  accessibilityRole="menuitem"
                  accessibilityState={isActive ? { selected: true } : undefined}
                  onPress={() => handleSelect(instance.fingerprint)}
                  style={({ pressed }) => [
                    styles.item,
                    instance === instances[instances.length - 1] && styles.itemLast,
                    pressed && styles.itemPressed,
                  ]}
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
              );
            })}
          </View>
        </Pressable>
      </Modal>
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
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    itemLast: { borderBottomWidth: 0 },
    itemPressed: { opacity: 0.6 },
    itemDot: { width: 9, height: 9, borderRadius: 5 },
    itemDotReachable: { backgroundColor: colors.statusDotConnected },
    itemDotOffline: { backgroundColor: colors.textFaint },
    itemBody: { flex: 1 },
    itemLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
    itemStatus: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  });
