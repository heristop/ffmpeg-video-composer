// The existing .test.ts Jest suite renders components without JSX using its installed renderer.
declare const jest: {
  mock(name: string, factory: () => unknown): void;
  fn<T extends (...args: never[]) => unknown>(impl: T): T;
  fn(): () => void;
  requireActual(name: string): unknown;
  clearAllMocks(): void;
  mocked<T>(fn: T): T & { mockReturnValue(value: unknown): void };
};
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Clappy } from './Clappy';
import { PressableScale } from '../kinetic/pressable-scale';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import { cancelAnimation, withSequence, withTiming } from 'react-native-reanimated';

jest.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Defs: 'Defs',
  Ellipse: 'Ellipse',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Pattern: 'Pattern',
  Rect: 'Rect',
  Stop: 'Stop',
}));
jest.mock('@leclap/creative-kit/clappy', () => ({
  ARM: '',
  BOARD: '',
  BOARD_BOTTOM: '',
  BOARD_TOP: '',
  CHEEK: '',
  DOT: '',
  OUTLINE: '',
  PUPIL: '',
  STRIPE_PERI: '',
  STRIPE_YELLOW: '',
  VIEW: { x: 0, y: 0, width: 600, height: 600 },
}));
jest.mock('@/src/hooks/use-motion-preferences', () => ({
  useMotionPreferences: jest.fn(() => ({ reducedMotion: false, appActive: true })),
}));
jest.mock('@/src/hooks/use-haptic-press', () => ({ useHapticPress: (onPress: unknown) => onPress }));
jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    ReduceMotion: { Never: 'never' },
    default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (value: unknown) =>
      ReactActual.useRef({
        value,
        get() {
          return this.value;
        },
        set(next: unknown) {
          this.value = next;
        },
      }).current,
    useAnimatedStyle: (style: () => unknown) => style(),
    withTiming: jest.fn((value: unknown) => value),
    withSpring: jest.fn((value: unknown) => value),
    withSequence: jest.fn((...values: unknown[]) => values.at(-1)),
    cancelAnimation: jest.fn(),
    interpolate: (_value: unknown, _input: unknown, output: unknown[]) => output.at(-1),
    Easing: { out: (v: unknown) => v, inOut: (v: unknown) => v, quad: 'quad', cubic: 'cubic' },
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useMotionPreferences).mockReturnValue({ reducedMotion: false, appActive: true });
});
afterEach(() => act(() => tree.unmount()));
const mount = (element: React.ReactElement) =>
  act(() => {
    tree = TestRenderer.create(element);
  });

it('does not schedule mascot motion while the engine works', () => {
  mount(React.createElement(Clappy, { state: 'working' }));
  expect(withTiming).not.toHaveBeenCalled();
});
it('does not animate a hidden sheet mascot or background screen', () => {
  mount(React.createElement(Clappy, { state: 'success', active: false }));
  expect(withTiming).not.toHaveBeenCalled();
  jest.mocked(useMotionPreferences).mockReturnValue({ reducedMotion: false, appActive: false });
  act(() => tree.update(React.createElement(Clappy, { state: 'welcome' })));
  expect(withTiming).not.toHaveBeenCalled();
});
it('runs one finite reaction per state transition, with no per-frame React state', () => {
  mount(React.createElement(Clappy, { state: 'welcome' }));
  expect(withSequence).toHaveBeenCalledTimes(1);
  act(() => tree.update(React.createElement(Clappy, { state: 'search' })));
  expect(withSequence).toHaveBeenCalledTimes(2);
  act(() => tree.update(React.createElement(Clappy, { state: 'search' })));
  expect(withSequence).toHaveBeenCalledTimes(2);
});
it('cancels an active reaction when reduced motion is enabled', () => {
  mount(React.createElement(Clappy, { state: 'success' }));
  jest.mocked(useMotionPreferences).mockReturnValue({ reducedMotion: true, appActive: true });
  act(() => tree.update(React.createElement(Clappy, { state: 'success' })));
  expect(cancelAnimation).toHaveBeenCalled();
  expect(withSequence).toHaveBeenCalledTimes(1);
});
it('resumes motion after a live preference change using the shared guard', () => {
  jest.mocked(useMotionPreferences).mockReturnValue({ reducedMotion: true, appActive: true });
  mount(React.createElement(Clappy, { state: 'success' }));
  expect(withSequence).not.toHaveBeenCalled();
  jest.mocked(useMotionPreferences).mockReturnValue({ reducedMotion: false, appActive: true });
  act(() => tree.update(React.createElement(Clappy, { state: 'success' })));
  expect(withSequence).toHaveBeenCalledTimes(1);
  expect(withSequence).toHaveBeenCalledWith('never', 0.35, 0.65, 1);
  expect(withTiming).toHaveBeenCalledWith(0.35, expect.objectContaining({ reduceMotion: 'never' }));
});
it('commits the action immediately instead of waiting for the press animation', () => {
  const onPress = jest.fn();
  mount(React.createElement(PressableScale, { children: null, onPress }));
  const press = tree.root.findByType('Pressable' as never);
  act(() => {
    press.props.onPressIn();
    press.props.onPress();
  });
  expect(onPress).toHaveBeenCalledTimes(1);
  act(() => {
    press.props.onPressOut();
  });
  expect(onPress).toHaveBeenCalledTimes(1);
});
it('clears held press feedback if the control becomes disabled', () => {
  mount(React.createElement(PressableScale, { children: null }));
  act(() => {
    tree.root.findByType('Pressable' as never).props.onPressIn();
  });
  act(() => tree.update(React.createElement(PressableScale, { children: null, disabled: true })));
  const press = tree.root.findByType('Pressable' as never);
  expect(press.props.onPress).toBeUndefined();
  expect(press.props.style.at(-1)).toEqual({ transform: [{ scale: 1 }], opacity: 0.5 });
  expect(cancelAnimation).toHaveBeenCalled();
});
