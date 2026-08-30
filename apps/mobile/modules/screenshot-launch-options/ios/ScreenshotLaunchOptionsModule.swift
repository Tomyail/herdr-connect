import ExpoModulesCore
import Foundation

/// Exposes simulator launch arguments to the JavaScript screenshot harness.
///
/// The JS app still guards the route with __DEV__, so this module cannot enable
/// a hidden screen in a production bundle. Keeping the arguments in a native
/// module lets xcrun simctl launch select a scene without rebuilding the JS
/// bundle for every screenshot.
public final class ScreenshotLaunchOptionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScreenshotLaunchOptionsModule")

    Function("get") {
      let arguments = ProcessInfo.processInfo.arguments
      var result: [String: String] = [:]
      if let scene = Self.argument(named: "-appStoreScreenshotScene", in: arguments) {
        result["scene"] = scene
      }
      if let locale = Self.argument(named: "-appStoreScreenshotLocale", in: arguments) {
        result["locale"] = locale
      }
      return result
    }
  }

  private static func argument(named name: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name) else { return nil }
    let valueIndex = arguments.index(after: index)
    guard arguments.indices.contains(valueIndex) else { return nil }
    return arguments[valueIndex]
  }
}
