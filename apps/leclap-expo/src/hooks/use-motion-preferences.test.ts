// Match the component test stack already installed in this app.
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
declare const jest: {
  mock(name: string, factory: () => unknown): void;
  fn<T extends (...args: never[]) => unknown>(impl: T): T;
  requireMock(name: string): unknown;
  clearAllMocks(): void;
  mocked<T>(fn: T): T & {
    mockResolvedValue(value: boolean): void;
    mockResolvedValueOnce(value: boolean): void;
    mockRejectedValueOnce(error: Error): void;
    mockImplementationOnce(impl: () => Promise<boolean>): void;
  };
};
import { AccessibilityInfo, AppState } from 'react-native';
import { useMotionPreferences } from './use-motion-preferences';

jest.mock('react-native', () => {
  const events = new Map<string, (value: unknown) => void>();
  const addEventListener = jest.fn((name: string, cb: (value: unknown) => void) => {
    events.set(name, cb);
    return { remove: jest.fn(() => events.delete(name)) };
  });
  return {
    AccessibilityInfo: { addEventListener, isReduceMotionEnabled: jest.fn(async () => false) },
    AppState: { currentState: 'active', addEventListener },
    emit: (name: string, value: unknown) => events.get(name)?.(value),
    listenerCount: () => events.size,
  };
});
const native = jest.requireMock('react-native') as {
  emit: (name: string, value: unknown) => void;
  listenerCount: () => number;
};
const observed = new Map<string, ReturnType<typeof useMotionPreferences>>();
function Consumer({ id }: { id: string }) {
  observed.set(id, useMotionPreferences());
  return null;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: TestRenderer.ReactTestRenderer | undefined;
const mount = () => {
  tree = TestRenderer.create(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Consumer, { id: 'a' }),
      React.createElement(Consumer, { id: 'b' })
    )
  );
};
const emit = (name: string, value: unknown) => act(() => native.emit(name, value));
beforeEach(() => {
  observed.clear();
  jest.clearAllMocks();
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
  Object.assign(AppState, { currentState: 'active' });
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});

it('shares one pair of native listeners across controls and removes them on unmount', async () => {
  await act(async () => mount());
  expect(native.listenerCount()).toBe(2);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(2);
  expect(observed.get('a')).toEqual({ appActive: true, reducedMotion: false });
  expect(observed.get('a')).toBe(observed.get('b'));
  act(() => tree?.unmount());
  tree = undefined;
  expect(native.listenerCount()).toBe(0);
});

it('updates mounted controls when reduced motion changes', async () => {
  await act(async () => mount());
  emit('reduceMotionChanged', true);
  expect(observed.get('a')?.reducedMotion).toBe(true);
  expect(observed.get('b')?.reducedMotion).toBe(true);
  emit('reduceMotionChanged', false);
  expect(observed.get('a')?.reducedMotion).toBe(false);
});

it('suspends in the background and rechecks settings before resuming', async () => {
  await act(async () => mount());
  emit('change', 'background');
  expect(observed.get('a')?.appActive).toBe(false);
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(true);
  emit('change', 'active');
  expect(observed.get('a')).toEqual({ appActive: true, reducedMotion: true });
  await act(async () => {});
  expect(observed.get('b')).toEqual({ appActive: true, reducedMotion: true });
});

it('keeps a newer accessibility event when an older query resolves later', async () => {
  let resolve!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => mount());
  expect(observed.get('a')?.reducedMotion).toBe(true);
  emit('reduceMotionChanged', true);
  await act(async () => resolve(false));
  expect(observed.get('a')?.reducedMotion).toBe(true);
});

it('ignores an abandoned query after a new screen subscribes', async () => {
  let resolve!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => mount());
  act(() => tree?.unmount());
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(true);
  await act(async () => mount());
  await act(async () => resolve(false));
  expect(observed.get('a')?.reducedMotion).toBe(true);
  expect(native.listenerCount()).toBe(2);
});

it('stays still if the system query fails', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => mount());
  expect(observed.get('a')?.reducedMotion).toBe(true);
});
