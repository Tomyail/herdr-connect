require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PinnedFetch'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license'] || 'MIT'
  s.author         = package['author'] || 'Herdr Connect'
  s.homepage       = package['homepage'] || 'https://github.com/Tomyail/herdr-connect'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/Tomyail/herdr-connect.git' }
  s.static_framework = true

  # Swift sources live next to this podspec (in ios/). The Swift module name
  # referenced from expo-module.config.json ("PinnedFetchModule") is exposed via
  # DEFINES_MODULE under the pod name.
  s.source_files = '**/*.{h,m,swift}'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
