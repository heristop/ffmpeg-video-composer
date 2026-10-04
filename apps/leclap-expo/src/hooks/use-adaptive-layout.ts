import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { adaptiveLayout } from '@/src/styles/adaptive-layout';

export function useAdaptiveLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return { ...adaptiveLayout(width, height, fontScale, insets), fontScale, insets };
}
