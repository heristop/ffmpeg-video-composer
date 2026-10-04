import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import CustomTabBar from '@/src/components/ui/CustomTabBar';
import Header from '@/src/components/common/Header';
import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';

export default function AppLayout() {
  const { t } = useTranslation('header');
  const { navigationRail } = useAdaptiveLayout();

  return (
    <>
      <Header variant="light" showSlogan={false} />

      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarPosition: Platform.OS === 'android' && navigationRail ? 'left' : 'bottom',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.scenarios'),
          }}
        />
        <Tabs.Screen
          name="videos/index"
          options={{
            title: t('tabs.videos'),
          }}
        />
      </Tabs>
    </>
  );
}
