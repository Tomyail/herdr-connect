/**
 * 通用底部动作菜单,替代系统 Alert 的"菜单式"用法(收藏、实例管理 ⋯、
 * 忘记确认、失败三选)。系统 Alert 在 iOS 上样式与 App 视觉语言割裂。
 *
 * 纯提示/错误类告警(如忘记成功、配对失败)仍用 Alert——那是告知语义,
 * 不是选择语义。
 *
 * 形态:底部滑出圆角卡片(标题 + 可选正文 + 选项行 + 独立取消按钮),
 * destructive 选项红色高亮;点遮罩/取消/back 关闭。
 */

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

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
  onDismiss,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: readonly ActionSheetAction[];
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        accessibilityLabel={t("common.cancel")}
        onPress={onDismiss}
        style={styles.overlay}
      >
        <Pressable style={styles.sheet} accessibilityRole="menu">
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 18,
      paddingBottom: 30,
      paddingHorizontal: 16,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
      marginBottom: 8,
    },
    message: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginBottom: 12,
      paddingHorizontal: 12,
    },
    actions: {
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    actionRow: {
      paddingVertical: 14,
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    actionRowBorder: {},
    actionRowPressed: { opacity: 0.6 },
    actionLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
    actionLabelDestructive: { color: colors.danger },
  });
