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
import { pairDaemon } from "./network";
import { saveCredentials, type DeviceCredentials } from "./credentials";
import { useConnection } from "./connection";
import { NetworkError } from "./i18n/errors";
import type { NetworkErrorCode } from "./i18n/errors";

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
        const result = await pairDaemon(payload, deviceName.trim() || "My iPhone");
        const credentials: DeviceCredentials = {
          fingerprint: result.fingerprint,
          deviceId: result.deviceId,
          token: result.token,
          deviceName: result.deviceName,
          pairedAt: new Date().toISOString(),
        };
        await saveCredentials(credentials);
        Alert.alert(t("pairing.title"), t("pairing.success"));
        // Trigger the connection to restart discovery with the new credentials.
        void refresh();
        if (navigation.canGoBack()) navigation.goBack();
        // Wide-mode overlay hosts Pairing as the sole root route, so canGoBack()
        // is false there — onSuccess lets the overlay tear itself down so the
        // success experience matches the narrow push-based flow.
        onSuccess?.();
      } catch (error) {
        console.error("pairDaemon failed:", error);
        Alert.alert(t("pairing.title"), pairingErrorDetail(error, tError));
      } finally {
        pairingRef.current = false;
        setIsPairing(false);
      }
    },
    [deviceName, navigation, onSuccess, refresh, t, tError],
  );

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
  });
