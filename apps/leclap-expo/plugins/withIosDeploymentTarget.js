const { withPodfile } = require('expo/config-plugins');

// Xcode 27 rejects the older targets in dependency privacy bundles. Match the app's
// deployment floor without lowering dependencies that already require a newer OS.
const TARGET_FLOOR = `    # leclap: align dependency deployment targets with the app
    minimum_target = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '16.4')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        configured_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if configured_target.nil? || Gem::Version.new(configured_target) < minimum_target
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_target.to_s
        end
      end
    end
`;

module.exports = function withIosDeploymentTarget(config) {
  return withPodfile(config, (cfg) => {
    const contents = cfg.modResults.contents;
    const anchor = '  post_install do |installer|';

    if (contents.includes('# leclap: align dependency deployment targets with the app')) return cfg;

    if (!contents.includes(anchor)) throw new Error('LeClap expected an Expo Podfile post_install hook.');

    cfg.modResults.contents = contents.replace(anchor, `${anchor}\n${TARGET_FLOOR}`);

    return cfg;
  });
};
