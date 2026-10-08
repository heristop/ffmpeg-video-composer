Pod::Spec.new do |s|
  s.name           = 'LeclapSpeech'
  s.version        = '1.0.0'
  s.summary        = 'On-device speech recognition for LeClap auto-captions'
  s.description    = 'SFSpeechRecognizer with requiresOnDeviceRecognition: transcribes a recorded clip without a network.'
  s.license        = 'MIT'
  s.author         = 'leclap'
  s.homepage       = 'https://github.com/heristop/leclap'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files   = 'LeclapSpeechModule.swift'
  s.frameworks     = 'Speech', 'AVFoundation', 'CryptoKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
