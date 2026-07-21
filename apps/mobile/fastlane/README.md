fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios testflight_build

```sh
[bundle exec] fastlane ios testflight_build
```

在本机生成用于 TestFlight 的 App Store IPA，不上传

### ios testflight_upload

```sh
[bundle exec] fastlane ios testflight_upload
```

上传已生成的 IPA 到 TestFlight，但不分发给测试组

### ios testflight_distribute

```sh
[bundle exec] fastlane ios testflight_distribute
```

把 App Store Connect 中已处理完成的 build 分发给指定 TestFlight 测试组

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
