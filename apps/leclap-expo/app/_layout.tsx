// Must load before any tsyringe-decorated class in the reused ffmpeg-video-composer core.
import 'reflect-metadata';
import { LogBox } from 'react-native';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { TamaguiProvider } from '@tamagui/core';
import {
  useFonts,
  Oswald_300Light,
  Oswald_400Regular,
  Oswald_500Medium,
  Oswald_600SemiBold,
  Oswald_700Bold,
} from '@expo-google-fonts/oswald';
import { I18nextProvider } from 'react-i18next';
import { QueryProvider } from '@/src/providers/QueryProvider';
import { OfflineProvider } from '@/src/providers/OfflineProvider';
import { CompileProgressOverlay } from '@/src/components/compile/CompileProgressOverlay';
import i18n from '@/src/i18n';
import config from '../tamagui.config';

// A dependency's bundled code wildcard-imports `react-native`, which enumerates the module and touches
// RN's deprecated `SafeAreaView` getter — emitting a dev-only warnOnce we can't fix in our own code
// (all our SafeAreaViews already come from react-native-safe-area-context). LogBox hides the in-app
// overlay; the console shim drops the same line from the Metro terminal. Passes every other warning through.
LogBox.ignoreLogs([/SafeAreaView has been deprecated/]);

const nativeWarn = console.warn;

console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('SafeAreaView has been deprecated')) return;

  nativeWarn(...args);
};

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    Oswald_300Light,
    Oswald_400Regular,
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
  });

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => {
        setIsReady(true);
      });
  }, [fontsLoaded, fontError]);

  // Open the studio as soon as resources are ready; no mandatory animated intro.
  if (!isReady) return null;

  return (
    <TamaguiProvider config={config} defaultTheme="light">
      <I18nextProvider i18n={i18n}>
        <QueryProvider>
          <OfflineProvider>
            <Stack
              initialRouteName="index"
              screenOptions={{
                headerShown: false,
                // Minimal configuration to avoid LinkPreviewContext issues
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="(app)" />
              <Stack.Screen name="template/[id]" />
              <Stack.Screen name="(fullscreen)" />
              <Stack.Screen name="+not-found" />
            </Stack>
            {/* Global on-device compile experience — overlays any screen while a render is in flight. */}
            <CompileProgressOverlay />
          </OfflineProvider>
        </QueryProvider>
      </I18nextProvider>
    </TamaguiProvider>
  );
}
