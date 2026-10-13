const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const MARKER = "// scene-lifecycle-adoption";
const LEGACY_START = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;
const SCENE_DELEGATE = `
${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = ["UIApplicationLaunchOptionsUserActivityKey": activity]
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    // Cold-start deep links only flow through launchOptions above, matching the
    // legacy (non-scene) startup path. Do not also forward connectionOptions to
    // scene(_:openURLContexts:)/scene(_:continue:) here — iOS never called
    // application(_:open:options:)/application(_:continue:) on legacy cold start,
    // and doing so would deliver one-shot URLs/activities twice.
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  // Expo subscribers still consume UIApplicationDelegate lifecycle callbacks.
  func sceneDidBecomeActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidBecomeActive(UIApplication.shared)
  }
  func sceneWillResignActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillResignActive(UIApplication.shared)
  }
  func sceneWillEnterForeground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillEnterForeground(UIApplication.shared)
  }
  func sceneDidEnterBackground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidEnterBackground(UIApplication.shared)
  }
}
`;

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (result) => {
    result.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: "Default Configuration",
          UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
        }],
      },
    };
    return result;
  });
  return withAppDelegate(config, (result) => {
    if (result.modResults.language !== "swift") {
      throw new Error("withIosSceneLifecycle requires a Swift AppDelegate");
    }
    const contents = result.modResults.contents;
    if (contents.includes(MARKER)) return result;
    if (!contents.includes(LEGACY_START)) {
      throw new Error("Expo AppDelegate startup changed; review withIosSceneLifecycle.cjs");
    }
    result.modResults.contents = contents.replace(LEGACY_START, "") + SCENE_DELEGATE;
    return result;
  });
};
