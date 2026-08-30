/**
 * 主界面实例切换器(issue #55)。
 *
 * Agents 列表页头部的一击切换入口:只列**已配对**安装实例(ConnectionProvider
 * 的 instances,不掺未配对的 mDNS 发现结果),每项显示别名(instance-alias)
 * 与可达/离线徽标(数据来自 #54 的 per-instance 并行会话状态
 * instanceStates——connected 即可达)。点选非活动项 → switchInstance:只改
 * 活动指针,会话并行保活,切换瞬间完成。
 *
 * 单实例时隐藏(无物可切);窄屏(tab 头部)与宽屏(列表列头部)由
 * AgentsScreenContent 统一挂载,两处行为一致。
 */

import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
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

export function InstanceSwitcher() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { instances, activeFingerprint, switchInstance, instanceStates } = useConnection();
  const [open, setOpen] = useState(false);
  /** 切换在途标记:防连点。 */
  const switchingRef = useRef(false);

  const activeReachable = isReachable(instanceStates[activeFingerprint ?? ""]?.phase);

  useEffect(() => {
    // 实例集合收缩到 1(忘记/解绑)时收起菜单;入口由下面的渲染守卫隐藏。
    if (open && instances.length < 2) setOpen(false);
  }, [instances.length, open]);

  // 只在有得可切时显示。
  if (instances.length < 2) return null;
  if (!activeFingerprint) return null;

  const handleSelect = (fingerprint: string) => {
    setOpen(false);
    if (fingerprint === activeFingerprint || switchingRef.current) return;
    switchingRef.current = true;
    void switchInstance(fingerprint).finally(() => {
      switchingRef.current = false;
    });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("switcher.openA11y")}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <View
          style={[
            styles.triggerDot,
            activeReachable ? styles.triggerDotReachable : styles.triggerDotOffline,
          ]}
        />
        <InstanceLabel fingerprint={activeFingerprint} style={styles.triggerLabel} />
        <Ionicons name="chevron-down" size={13} color={colors.textFaint} style={styles.triggerChevron} />
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
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      backgroundColor: colors.card,
      borderRadius: 20,
      height: 40,
      paddingLeft: 13,
      paddingRight: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      maxWidth: 220,
      marginRight: 8,
    },
    triggerPressed: { opacity: 0.72 },
    triggerLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", flexShrink: 1 },
    triggerDot: { width: 8, height: 8, borderRadius: 4 },
    triggerDotReachable: { backgroundColor: colors.statusDotConnected },
    triggerDotOffline: { backgroundColor: colors.textFaint },
    triggerChevron: { marginLeft: 1 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.28)" },
    menu: {
      position: "absolute",
      top: 92,
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
