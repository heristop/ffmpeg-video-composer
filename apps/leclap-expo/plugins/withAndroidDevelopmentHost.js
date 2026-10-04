const { withMainApplication } = require('expo/config-plugins');

// The library's ReactBuildConfig.DEBUG can be false even in our Debug APK. Use the app's build type.
module.exports = function withAndroidDevelopmentHost(config) {
  return withMainApplication(config, (cfg) => {
    const contents = cfg.modResults.contents;

    if (/useDevSupport\s*=\s*BuildConfig\.DEBUG/.test(contents)) return cfg;

    if (/useDevSupport\s*=/.test(contents)) {
      throw new Error('LeClap found an unexpected Expo development support setting.');
    }

    const anchor = 'context = applicationContext,';

    if (cfg.modResults.language !== 'kt' || !contents.includes(anchor)) {
      throw new Error('LeClap expected the Kotlin ExpoReactHostFactory application context.');
    }

    cfg.modResults.contents = contents.replace(anchor, `${anchor}\n      useDevSupport = BuildConfig.DEBUG,`);

    return cfg;
  });
};
