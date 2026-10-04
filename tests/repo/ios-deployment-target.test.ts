import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type PodfileResult = { modResults: { contents: string } };
const withIosDeploymentTarget = require('../../apps/leclap-expo/plugins/withIosDeploymentTarget.js') as (config: {
  name: string;
  slug: string;
}) => { mods: { ios: { podfile: (config: Record<string, unknown>) => Promise<PodfileResult> } } };

async function applyPlugin(contents: string): Promise<string> {
  const config = withIosDeploymentTarget({ name: 'LeClap', slug: 'leclap' });
  const result = await config.mods.ios.podfile({
    ...config,
    modResults: { contents },
    modRequest: {
      platform: 'ios',
      modName: 'podfile',
      projectRoot: process.cwd(),
      platformProjectRoot: process.cwd(),
      introspect: true,
    },
  });

  return result.modResults.contents;
}

const PODFILE = `target 'LeClap' do
  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

describe('iOS deployment target plugin', () => {
  it('adds the deployment floor inside the existing hook and preserves React Native setup', async () => {
    const contents = await applyPlugin(PODFILE);
    expect(contents.startsWith("target 'LeClap' do\n  post_install do |installer|\n")).toBe(true);
    expect(contents).toContain("podfile_properties['ios.deploymentTarget'] || '16.4'");
    expect(contents).toContain('Gem::Version.new(configured_target) < minimum_target');
    expect(contents.endsWith('    react_native_post_install(installer)\n  end\nend\n')).toBe(true);
  });

  it('does not duplicate the hook when prebuild runs again', async () => {
    const contents = await applyPlugin(PODFILE);
    expect(await applyPlugin(contents)).toBe(contents);
  });

  it('reports a changed Expo hook instead of silently omitting the fix', async () => {
    await expect(applyPlugin("target 'LeClap' do\nend\n")).rejects.toThrow(
      'LeClap expected an Expo Podfile post_install hook.'
    );
  });
});
