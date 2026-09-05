Pod::Spec.new do |s|
  s.name           = 'PayholeDns'
  s.version        = '0.1.0'
  s.summary        = 'Installs the PayHole encrypted DNS setting through NEDNSSettingsManager'
  s.description    = 'Native half of the PayHole app: saves a DNS-over-HTTPS or DNS-over-TLS system setting and reports whether the user has enabled it.'
  s.license        = 'MIT'
  s.author         = 'PayHole'
  s.homepage       = 'https://payhole.org'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/S4PAY/payhole.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,swift}"
end
