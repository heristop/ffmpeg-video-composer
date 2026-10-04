const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Expo's schema has no resizeableActivity setting; keep it on the native activity through prebuild.
module.exports = function withAdaptiveWindow(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity.$['android:resizeableActivity'] = 'true';

    return cfg;
  });
};
