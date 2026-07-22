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
    buildNumber: "4",
    // Run at native iPad resolution instead of iPhone compatibility scaling.
    supportsTablet: true,
    // `requireFullScreen` is intentionally left unset (defaults to false).
    // With supportsTablet:true and requireFullScreen:false, Expo's RequiresFullScreen
    // config plugin automatically writes `UISupportedInterfaceOrientations~ipad`
    // with all four orientations (portrait, portraitUpsideDown, landscapeLeft,
    // landscapeRight) so iPad can rotate freely and support multitasking.
    // The root `orientation: "portrait"` field is unchanged, so it keeps driving
    // the base `UISupportedInterfaceOrientations` (iPhone) key = portrait-only,
    // and the same field drives Android's portrait lock too.
    // Verified against @expo/config-plugins@56.0.13: ios/RequiresFullScreen.js
    // sets the ~ipad key; ios/Orientation.js only writes the base key.
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
      NSSpeechRecognitionUsageDescription:
        "Herdr Connect uses speech recognition to turn your voice into text in the message composer.",
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
  plugins: [
    "expo-localization",
    "expo-audio",
    "expo-dev-client",
    "expo-camera",
    "expo-notifications",
    "expo-secure-store",
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Herdr Connect uses the microphone to turn your voice into text in the message composer.",
        speechRecognitionPermission: "Herdr Connect uses speech recognition to turn your voice into text in the message composer.",
      },
    ],
    "./plugins/withAndroidCleartextTraffic.cjs",
  ],
};

export default config;
