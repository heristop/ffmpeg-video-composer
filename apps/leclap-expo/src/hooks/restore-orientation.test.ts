declare const jest: { mock(moduleName: string, factory: () => unknown): void };
const mockCalls: string[] = [];

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 1, LANDSCAPE: 2 },
  lockAsync: async (orientation: number) => {
    mockCalls.push(`lock:${orientation}`);
  },
  unlockAsync: async () => {
    mockCalls.push('unlock');
  },
}));
jest.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 320, height: 780 }) }));

import { restoreOrientation } from './useOrientation';

it('rotates back to portrait before handing rotation back to the device', async () => {
  await restoreOrientation();

  expect(mockCalls).toEqual(['lock:1', 'unlock']);
});
