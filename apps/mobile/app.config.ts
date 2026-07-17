import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Herdr Connect",
  slug: "herdr-connect",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.tomyail.herdrconnect",
    buildNumber: "1",
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSBonjourServices: ["_herdr-connect._tcp"],
      NSLocalNetworkUsageDescription:
        "Herdr Connect 需要访问本地网络，以发现并连接附近的 Herdr daemon。",
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
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
  plugins: ["expo-dev-client", "./plugins/withAndroidCleartextTraffic.cjs"],
};

export default config;
