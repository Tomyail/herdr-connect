const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

// react-native-svg@15.x podspec declares ios deployment target 12.4; newer Xcode
// SDKs only support >= 15.0, failing the Pods build. The Podfile `platform :ios`
// value is NOT a floor for pod targets (podspec values win), so we inject a
// post_install bump into the generated Podfile.
const MARKER = "# deployment-target-floor";
const SNIPPET = `
    ${MARKER}
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |config|
        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.1
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end
`;

module.exports = function withIosDeploymentTargetFloor(config) {
  return withDangerousMod(config, [
    "ios",
    (result) => {
      const podfilePath = path.join(result.modRequest.platformProjectRoot, "Podfile");
      let podfile = fs.readFileSync(podfilePath, "utf8");
      if (podfile.includes(MARKER)) return result;
      const anchor = /:ccache_enabled => ccache_enabled\?\(podfile_properties\),\s*\n\s*\)/;
      if (!anchor.test(podfile)) {
        throw new Error("Podfile post_install anchor not found; update withIosDeploymentTarget.cjs");
      }
      podfile = podfile.replace(anchor, (m) => m + SNIPPET);
      fs.writeFileSync(podfilePath, podfile);
      return result;
    },
  ]);
};
