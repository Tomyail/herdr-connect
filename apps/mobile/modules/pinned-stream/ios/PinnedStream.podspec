require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PinnedStream'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license'] || 'MIT'
  s.author         = package['author'] || 'Herdr Connect'
  s.homepage       = package['homepage'] || 'https://github.com/Tomyail/herdr-connect'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/Tomyail/herdr-connect.git' }
  s.static_framework = true

  s.source_files = '**/*.{h,m,swift}'

  # Expo module runtime.
  s.dependency 'ExpoModulesCore'
  # Reuse the shared PinnedTrustEvaluator (leaf-fingerprint + constant-time
  # compare). The trust logic exists in exactly one place.
  s.dependency 'PinnedFetch'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
