import { registerRootComponent } from "expo";
import { AppRegistry } from "react-native";

import { getScreenshotLaunchOptions } from "screenshot-launch-options";
import App from "./src/App";

// Expo's registerRootComponent intentionally adds the Fast Refresh/bundle
// splitting indicator in Debug builds. Bypass that dev wrapper only for the
// deterministic screenshot route; ordinary development keeps Expo's tooling.
const screenshotMode = __DEV__ && Boolean(getScreenshotLaunchOptions()?.scene);
if (screenshotMode) {
  AppRegistry.registerComponent("main", () => App);
} else {
  registerRootComponent(App);
}
