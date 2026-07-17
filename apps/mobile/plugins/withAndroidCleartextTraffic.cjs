const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("AndroidManifest.xml 缺少 application 节点");
    }

    application.$ = application.$ || {};
    application.$["android:usesCleartextTraffic"] = "true";
    return result;
  });
};
