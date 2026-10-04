import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Config = Record<string, unknown>;
type ModResult = { modResults: { contents: string } };
const withHost = require('../../apps/leclap-expo/plugins/withAndroidDevelopmentHost.js') as (config: Config) => {
  mods: { android: { mainApplication: (config: Config) => Promise<ModResult> } };
};

async function applyHost(contents: string) {
  const config = withHost({ name: 'LeClap', slug: 'leclap' });
  const result = await config.mods.android.mainApplication({
    ...config,
    modResults: { contents, language: 'kt' },
    modRequest: {
      platform: 'android',
      modName: 'mainApplication',
      projectRoot: process.cwd(),
      platformProjectRoot: process.cwd(),
      introspect: true,
    },
  });
  return result.modResults.contents;
}

describe('Android development host', () => {
  it('uses the application build flag and survives repeated prebuilds', async () => {
    const source =
      'ExpoReactHostFactory.getDefaultReactHost(\n      context = applicationContext,\n      packages = packages,\n    )';
    const result = await applyHost(source);
    expect(result).toContain('useDevSupport = BuildConfig.DEBUG,');
    expect(result).toContain('packages = packages,');
    expect(await applyHost(result)).toBe(result);
  });
  it('reports changed native setup instead of adding conflicting arguments', async () => {
    await expect(applyHost('getDefaultReactHost()')).rejects.toThrow('expected the Kotlin');
    await expect(applyHost('context = applicationContext, useDevSupport = true,')).rejects.toThrow('unexpected Expo');
  });
});

describe('adaptive native configuration', () => {
  it('unlocks window orientation and permits iPad multitasking', () => {
    const { expo } = require('../../apps/leclap-expo/app.json');
    expect(expo.orientation).toBe('default');
    expect(expo.ios.requireFullScreen).toBe(false);
    expect(expo.plugins).toContain('./plugins/withAdaptiveWindow.js');
  });
  it('makes the existing Android activity resizable without replacing its native settings', async () => {
    const withWindow = require('../../apps/leclap-expo/plugins/withAdaptiveWindow.js');
    const config = withWindow({ name: 'LeClap', slug: 'leclap' });
    const activity = {
      $: {
        'android:name': '.MainActivity',
        'android:configChanges': 'orientation|screenSize',
        'android:resizeableActivity': 'false',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        },
      ],
    };
    const result = await config.mods.android.manifest({
      ...config,
      modResults: { manifest: { application: [{ activity: [activity] }] } },
      modRequest: {
        platform: 'android',
        modName: 'manifest',
        projectRoot: process.cwd(),
        platformProjectRoot: process.cwd(),
        introspect: true,
      },
    });
    expect(result.modResults.manifest.application[0].activity[0].$).toEqual({
      'android:name': '.MainActivity',
      'android:configChanges': 'orientation|screenSize',
      'android:resizeableActivity': 'true',
    });
  });
});
