import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Herdr Connect",
  slug: "herdr-connect",
  icon: "./assets/icon.png",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.tomyail.herdrconnect",
    buildNumber: "3",
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSBonjourServices: ["_herdr-connect._tcp"],
      NSLocalNetworkUsageDescription:
        "Herdr Connect needs access to your local network to discover and connect to nearby Herdr daemons.",
      CFBundleAllowMixedLocalizations: true,
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSCameraUsageDescription:
        "Herdr Connect uses the camera to scan the QR code shown by the desktop daemon when pairing a device.",
    },
  },
  android: {
    package: "com.tomyail.herdrconnect",
    versionCode: 1,
    permissions: [
      "android.permission.NEARBY_WIFI_DEVICES",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.CHANGE_WIFI_MULTICAST_STATE",
    ],
  },
  locales: {
    en: "./locales/en.json",
    "zh-Hans": "./locales/zh-Hans.json",
  },
  plugins: ["expo-localization", "expo-audio", "expo-dev-client", "expo-camera", "expo-notifications", "expo-secure-store", "./plugins/withAndroidCleartextTraffic.cjs"],
};

export default config;
