import { useLayoutEffect, useState, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";

import { useI18n } from "./i18n/I18nContext";
import { useThemedStyles, useTheme } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import type { RootStackParamList } from "./navigation";
import { parsePairingQRPayload } from "./pairing";
import { pairDaemon, revokeDeviceByPairingHosts } from "./network";
import { loadPairedInstances, saveCredentials, type DeviceCredentials } from "./credentials";
import { defaultInstanceAlias } from "./instance-alias";
import { readInstanceAlias, writeInstanceAlias } from "./instance-alias-storage";
import {
  classifyRevocationFailure,
  planReplacementRevocation,
  replacementRevocationNotice,
} from "./instance-revocation";
import { useConnection } from "./connection";
import { NetworkError, toErrorCode } from "./i18n/errors";
import type { NetworkErrorCode } from "./i18n/errors";
import { Ionicons } from "./icons";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Pairing">;

/** Extract a human-readable error detail for the pairing failure alert. */
function pairingErrorDetail(error: unknown, tError: (code: NetworkErrorCode, params?: Record<string, string | number | undefined>) => string): string {
  if (error instanceof NetworkError) {
    const code: NetworkErrorCode = error.code;
    const base = tError(code, error.status != null ? { status: error.status } : undefined);
    return error.detail ? `${base}\n\n${error.detail}` : base;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 配对完成态:进入命名步骤;替换语义下旧 token 吊销失败时带警告。 */
interface PairingCompleted {
  readonly fingerprint: string;
  readonly revocationWarning: boolean;
}

export function PairingScreen({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { t, tError } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<Navigation>();
  const { refresh } = useConnection();

  const [permission, requestPermission] = useCameraPermissions();
  const [deviceName, setDeviceName] = useState("My iPhone");
  const [isPairing, setIsPairing] = useState(false);
  /** Prevent duplicate scan triggers while pairing is in flight. */
  const pairingRef = useRef(false);
  /** 配对成功 → 命名步骤(默认预填 mDNS/QR hostname,见 defaultInstanceAlias)。 */
  const [completed, setCompleted] = useState<PairingCompleted | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("pairing.title"),
      headerBackTitle: t("settings.screenTitle"),
    });
  }, [navigation, t]);

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (pairingRef.current) return;
      pairingRef.current = true;
      setIsPairing(true);

      try {
        const payload = parsePairingQRPayload(data);
        // 替换语义(#55):入库前抓旧凭据快照。顺序保证——先完成新配对拿到
        // 新 token 并入库,再吊销旧 token,避免中间态失去访问权。
        const previousModel = await loadPairedInstances();
        const previous = previousModel.instances[payload.fp];
        const result = await pairDaemon(payload, deviceName.trim() || "My iPhone");
        const credentials: DeviceCredentials = {
          fingerprint: result.fingerprint,
          deviceId: result.deviceId,
          token: result.token,
          deviceName: result.deviceName,
          pairedAt: new Date().toISOString(),
        };
        await saveCredentials(credentials);
        // 旧 token 主动自吊销(服务端设备表不残留僵尸条目)。失败不阻断
        // 配对成功,只在命名步骤提示(决策见 instance-revocation.ts)。
        let revocationWarning = false;
        // previous 为空时 plan 为 skip,短路守卫同时让 TS 收窄 previous。
        if (previous && planReplacementRevocation(previous, result.token) === "revoke_after_store") {
          try {
            await revokeDeviceByPairingHosts(payload, previous.token);
          } catch (error) {
            const classification = classifyRevocationFailure(toErrorCode(error, "revoke_http"));
            revocationWarning = replacementRevocationNotice(classification);
          }
        }
        // 重复配对同一实例:保留既有别名;新实例预填默认别名(mDNS 服务名
        // → hostname → QR host → 指纹尾 8 位,见 defaultInstanceAlias)。
        setAliasDraft(
          readInstanceAlias(payload.fp) ??
            defaultInstanceAlias({ qrHosts: payload.hosts, fingerprint: payload.fp }),
        );
        setCompleted({ fingerprint: payload.fp, revocationWarning });
        // Trigger the connection to restart discovery with the new credentials.
        // 命名步骤只操作纯客户端别名,不阻塞后台连接。
        void refresh();
      } catch (error) {
        console.error("pairDaemon failed:", error);
        Alert.alert(t("pairing.title"), pairingErrorDetail(error, tError));
      } finally {
        pairingRef.current = false;
        setIsPairing(false);
      }
    },
    [deviceName, refresh, t, tError],
  );

  /** 命名步骤完成:保存别名(空 = 回退默认展示)并结束配对流程。 */
  const handleDone = useCallback(() => {
    if (!completed) return;
    writeInstanceAlias(completed.fingerprint, aliasDraft);
    if (navigation.canGoBack()) navigation.goBack();
    // Wide-mode overlay hosts Pairing as the sole root route, so canGoBack()
    // is false there — onSuccess lets the overlay tear itself down.
    onSuccess?.();
  }, [aliasDraft, completed, navigation, onSuccess]);

  // ── 命名步骤:配对成功后的别名编辑(issue #55) ──
  if (completed) {
    return (
      <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
        <View style={styles.doneBody}>
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={30} color={colors.onAction} />
          </View>
          <Text style={styles.doneTitle}>{t("pairing.aliasSectionTitle")}</Text>
          <Text style={styles.doneText}>{t("pairing.aliasSectionBody")}</Text>
          {completed.revocationWarning ? (
            <View style={styles.warningCard}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.warningText}>{t("pairing.revocationWarning")}</Text>
            </View>
          ) : null}
          <Text style={styles.aliasLabel}>{t("pairing.aliasLabel")}</Text>
          <TextInput
            style={styles.aliasInput}
            value={aliasDraft}
            onChangeText={setAliasDraft}
            placeholder={t("pairing.aliasPlaceholder")}
            placeholderTextColor={colors.textFaint}
            maxLength={64}
            autoFocus
            selectTextOnFocus
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleDone}
            style={({ pressed }) => [styles.doneButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.doneButtonText}>{t("pairing.done")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission) {
    // Permissions are still loading.
    return (
      <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.spinner} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.permissionTitle}>{t("pairing.cameraPermissionTitle")}</Text>
          <Text style={styles.permissionMessage}>{t("pairing.cameraPermissionMessage")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={requestPermission}
            style={({ pressed }) => [
              styles.grantButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.grantButtonText}>{t("pairing.grantCamera")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <View style={styles.nameRow}>
        <Text style={styles.nameLabel}>{t("pairing.deviceNameLabel")}</Text>
        <TextInput
          style={styles.nameInput}
          value={deviceName}
          onChangeText={setDeviceName}
          placeholder={t("pairing.deviceNamePlaceholder")}
          placeholderTextColor={colors.textFaint}
          maxLength={100}
          editable={!isPairing}
        />
      </View>
      <View style={styles.cameraContainer}>
        {isPairing ? (
          <View style={styles.pairingOverlay}>
            <ActivityIndicator size="large" color={colors.spinner} />
            <Text style={styles.pairingText}>{t("pairing.pairing")}</Text>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
        )}
      </View>
      <Text style={styles.scanPrompt}>{t("pairing.scanPrompt")}</Text>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
    permissionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 10, textAlign: "center" },
    permissionMessage: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 22 },
    grantButton: { backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
    grantButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
    buttonPressed: { opacity: 0.72 },
    nameRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, gap: 12 },
    nameLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
    nameInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 15,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
    },
    cameraContainer: {
      flex: 1,
      marginHorizontal: 20,
      marginTop: 20,
      borderRadius: 18,
      overflow: "hidden",
    },
    camera: { flex: 1 },
    pairingOverlay: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: `${colors.background}E6`,
      gap: 16,
    },
    pairingText: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
    scanPrompt: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: "center",
      paddingHorizontal: 32,
      paddingVertical: 18,
    },
    // ── 命名步骤(#55) ──
    doneBody: { flex: 1, paddingHorizontal: 28, paddingTop: 48, alignItems: "stretch" },
    doneBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.actionBg,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginBottom: 18,
    },
    doneTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: "700", textAlign: "center" },
    doneText: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    warningCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 24,
    },
    warningText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, flexShrink: 1 },
    aliasLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "600", marginBottom: 10 },
    aliasInput: {
      color: colors.textPrimary,
      fontSize: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      marginBottom: 26,
    },
    doneButton: {
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: "center",
    },
    doneButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  });
