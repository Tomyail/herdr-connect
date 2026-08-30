/**
 * 通用底部动作菜单,替代系统 Alert 的"菜单式"用法(收藏、实例管理 ⋯、
 * 忘记确认、失败三选)。系统 Alert 在 iOS 上样式与 App 视觉语言割裂。
 *
 * 纯提示/错误类告警(如忘记成功、配对失败)仍用 Alert——那是告知语义,
 * 不是选择语义。
 *
 * 视觉上采用 iOS action sheet 的两组结构:操作组 + 独立取消按钮。
 * 宽屏设备限制面板宽度,避免 iPad 上出现横跨整屏的巨大色块。
 */

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "./i18n/I18nContext";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";

export type ActionSheetAction = {
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

export function ActionSheet({
  visible,
  title,
  message,
  actions,
  cancelLabel,
  onDismiss,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: readonly ActionSheetAction[];
  cancelLabel?: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const { bottom } = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        accessibilityLabel={t("common.cancel")}
        onPress={onDismiss}
        style={[styles.overlay, { paddingBottom: Math.max(bottom, 8) }]}
      >
        <Pressable
          accessibilityRole="menu"
          onPress={() => {}}
          style={styles.sheet}
        >
          <View style={styles.actionGroup}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <View style={styles.actions}>
              {actions.map((action, index) => (
                <Pressable
                  key={`${action.label}-${index}`}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    onDismiss();
                    action.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.actionRow,
                    index < actions.length - 1 && styles.actionRowBorder,
                    pressed && styles.actionRowPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionLabel,
                      action.destructive && styles.actionLabelDestructive,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel ?? t("common.cancel")}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
          >
            <Text style={styles.cancelLabel}>{cancelLabel ?? t("common.cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: "center",
      justifyContent: "flex-end",
      paddingHorizontal: 12,
      backgroundColor: "rgba(0,0,0,0.42)",
    },
    sheet: {
      width: "100%",
      maxWidth: 460,
    },
    actionGroup: {
      overflow: "hidden",
      backgroundColor: colors.card,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      shadowColor: colors.background,
      shadowOpacity: 0.22,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 20,
      textAlign: "center",
      paddingTop: 18,
      paddingHorizontal: 18,
    },
    message: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      paddingTop: 6,
      paddingHorizontal: 24,
    },
    actions: { marginTop: 10 },
    actionRow: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingVertical: 13,
    },
    actionRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    actionRowPressed: { backgroundColor: colors.separator },
    actionLabel: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: "600",
      lineHeight: 21,
      textAlign: "center",
    },
    actionLabelDestructive: { color: colors.danger },
    cancelButton: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      shadowColor: colors.background,
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    cancelButtonPressed: { backgroundColor: colors.separator },
    cancelLabel: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 21,
    },
  });
