declare const jest: { mock(moduleName: string, factory: () => unknown): void };
import React, { act, useEffect } from 'react';
interface Renderer {
  update(element: React.ReactElement): void;
  unmount(): void;
}
const TestRenderer = require('react-test-renderer') as { create(element: React.ReactElement): Renderer };
import { useOrientation } from './useOrientation';

let windowSize = { width: 320, height: 780 };
const locks: number[] = [];
jest.mock('react-native', () => ({ useWindowDimensions: () => windowSize }));
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 1, LANDSCAPE: 2 },
  lockAsync: async (orientation: number) => {
    locks.push(orientation);
  },
  unlockAsync: async () => {},
}));

let observed: ReturnType<typeof useOrientation>;
function Consumer() {
  const orientation = useOrientation('portrait');
  useEffect(() => {
    observed = orientation;
  }, [orientation]);

  return null;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('responds to app-window resizing without sensor rotation or a new orientation-lock function', () => {
  let tree: Renderer;
  act(() => {
    tree = TestRenderer.create(React.createElement(Consumer));
  });
  const originalLock = observed.lockOrientation;
  expect(observed.isCorrectOrientation).toBe(true);
  windowSize = { width: 780, height: 720 };
  act(() => {
    tree.update(React.createElement(Consumer));
  });
  expect(observed.currentOrientation).toBe('landscape');
  expect(observed.isCorrectOrientation).toBe(false);
  expect(observed.lockOrientation).toBe(originalLock);
  expect(locks).toEqual([]);
  act(() => {
    tree.unmount();
  });
});
