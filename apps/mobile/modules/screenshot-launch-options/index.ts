import { Platform } from "react-native";

export interface ScreenshotLaunchOptions {
  readonly scene?: string;
  readonly locale?: string;
}

interface NativeScreenshotLaunchOptions {
  get: () => ScreenshotLaunchOptions;
}

let nativeModule: NativeScreenshotLaunchOptions | undefined;

if (Platform.OS === "ios") {
  try {
    // Keep this optional so Android and ordinary Expo tooling can load the JS
    // bundle without requiring the iOS-only module to be present.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require("expo-modules-core") as {
      requireNativeModule: <T>(name: string) => T;
    };
    nativeModule = core.requireNativeModule<NativeScreenshotLaunchOptions>(
      "ScreenshotLaunchOptionsModule",
    );
  } catch {
    nativeModule = undefined;
  }
}

/**
 * Read launch options passed to an iOS Debug build.
 *
 * The production app never uses this value: App.tsx additionally guards the
 * screenshot route with React Native's compile-time __DEV__ flag. Keeping the
 * native lookup optional makes the module harmless in Expo Go and on Android.
 */
export function getScreenshotLaunchOptions(): ScreenshotLaunchOptions | undefined {
  if (!nativeModule) return undefined;
  try {
    const options = nativeModule.get();
    return options && typeof options === "object" ? options : undefined;
  } catch {
    return undefined;
  }
}
