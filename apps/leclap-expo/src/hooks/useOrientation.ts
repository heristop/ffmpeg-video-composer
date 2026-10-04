import * as ScreenOrientation from 'expo-screen-orientation';
import { useWindowDimensions } from 'react-native';

type OrientationType = 'portrait' | 'landscape';

// Stable functions prevent lock/unlock effects from restarting on unrelated renders.
const lockOrientation = async (orientation: OrientationType) => {
  await ScreenOrientation.lockAsync(
    orientation === 'portrait'
      ? ScreenOrientation.OrientationLock.PORTRAIT_UP
      : ScreenOrientation.OrientationLock.LANDSCAPE
  );
};
const unlockOrientation = async () => {
  await ScreenOrientation.unlockAsync();
};

export const useOrientation = (requiredOrientation?: OrientationType) => {
  const { width, height } = useWindowDimensions();
  const currentOrientation: OrientationType = height >= width ? 'portrait' : 'landscape';

  return {
    currentOrientation,
    isCorrectOrientation: !requiredOrientation || requiredOrientation === currentOrientation,
    lockOrientation,
    unlockOrientation,
  };
};

export default { name: 'OrientationHook' };
