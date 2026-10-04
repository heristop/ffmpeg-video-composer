// Unit tests run in Jest; the app type program uses Vitest globals.
declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(impl?: (...args: never[]) => unknown): (...args: never[]) => unknown;
  clearAllMocks(): void;
  mocked<T extends (...args: never[]) => unknown>(
    fn: T
  ): T & {
    mockRejectedValueOnce(value: unknown): void;
    mockImplementationOnce(impl: T): void;
  };
};
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ExportSheet } from './ExportSheet';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s },
  Alert: { alert: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/src/features/templates/components/Sheet', () => ({ Sheet: 'Sheet' }));
jest.mock('@/src/components/clappy/Clappy', () => ({ Clappy: 'Clappy' }));
jest.mock('@/src/utils/permissions', () => ({ requestMediaLibraryPermission: jest.fn(async () => true) }));
jest.mock('expo-media-library', () => ({ Asset: { create: jest.fn(async () => {}) } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
import { Alert } from 'react-native';
import { Asset } from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const props = { visible: true, videoUri: 'file:///first.mp4', onClose: jest.fn() };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: TestRenderer.ReactTestRenderer;
const action = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    tree = TestRenderer.create(React.createElement(ExportSheet, props));
  });
});
afterEach(() => {
  act(() => {
    tree.unmount();
  });
});

it('shares the MP4 file with a video MIME type instead of Android text sharing', async () => {
  await act(async () => {
    await action('export.share').props.onPress();
  });
  expect(Sharing.shareAsync).toHaveBeenCalledWith(props.videoUri, {
    mimeType: 'video/mp4',
    UTI: 'public.mpeg-4',
    dialogTitle: 'export.shareTitle',
  });
});

it('shows recoverable feedback when sharing fails', async () => {
  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('Share unavailable'));
  await act(async () => {
    await action('export.share').props.onPress();
  });
  expect(Alert.alert).toHaveBeenCalledWith('export.shareErrorTitle', 'export.shareErrorBody');
  expect(action('export.share').props.disabled).toBe(false);
});

it('allows saving a second output after the first has been saved', async () => {
  await act(async () => {
    await action('export.save.idle').props.onPress();
  });
  expect(action('export.save.saved').props.disabled).toBe(true);
  act(() => {
    tree.update(React.createElement(ExportSheet, { ...props, videoUri: 'file:///second.mp4' }));
  });
  expect(action('export.save.idle').props.disabled).toBe(false);
  await act(async () => {
    await action('export.save.idle').props.onPress();
  });
  expect(Asset.create).toHaveBeenLastCalledWith('file:///second.mp4');
});

it('does not transfer a pending save completion to a new output', async () => {
  let finish!: () => void;
  jest.mocked(Asset.create).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      })
  );
  await act(async () => {
    action('export.save.idle').props.onPress();
    await Promise.resolve();
  });
  act(() => {
    tree.update(React.createElement(ExportSheet, { ...props, videoUri: 'file:///second.mp4' }));
  });
  await act(async () => {
    finish();
  });
  expect(action('export.save.idle').props.disabled).toBe(false);
});
