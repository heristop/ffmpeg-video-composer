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
import PreviewPage from '../../../../app/(fullscreen)/preview';
import { PreviewToolbar } from './PreviewToolbar';

let params: { videoUri?: string; sectionName?: string; projectId?: string; orientation?: 'square' };
let previewSize = { width: 390, height: 700 };
const player = { pause: jest.fn() };
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StatusBar: 'StatusBar',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => params, useRouter: () => ({ back: jest.fn() }) }));
jest.mock('expo-video', () => ({ VideoView: 'VideoView' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/src/components/kinetic/pressable-scale', () => ({ PressableScale: 'PressableScale' }));
jest.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: undefined }), useSaveProject: () => ({}) }));
jest.mock('@/src/features/editor/components/CropOverlay', () => 'CropOverlay');
jest.mock('@/src/features/editor/components/ExportSheet', () => ({ ExportSheet: 'ExportSheet' }));
jest.mock('@/src/features/editor/preview/usePreviewPlayer', () => ({
  usePreviewPlayer: () => ({ player, duration: 3, srcSize: {}, status: 'readyToPlay' }),
}));
jest.mock('@/src/features/editor/preview/usePreviewState', () => ({
  usePreviewState: () => ({ mode: 'view', trim: { start: 0, end: 3 }, crop: { x: 0, y: 0, w: 1, h: 1 } }),
}));
jest.mock('@/src/features/editor/preview/usePreviewActions', () => ({
  usePreviewActions: () => ({ canEdit: Boolean(params.sectionName), saving: false }),
}));
jest.mock('@/src/features/editor/preview/useVideoRect', () => ({
  useVideoRect: () => ({ videoRect: {}, containerWidth: previewSize.width, containerHeight: previewSize.height }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/src/features/editor/preview/EditPanels', () => ({
  TrimEditPanel: 'TrimEditPanel',
  CropEditPanel: 'CropEditPanel',
}));
jest.mock('@/src/features/editor/preview/PreviewStates', () => ({
  PreviewLoading: 'PreviewLoading',
  PreviewError: 'PreviewError',
  PreviewNoVideo: 'PreviewNoVideo',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: TestRenderer.ReactTestRenderer;
afterEach(() => {
  previewSize = { width: 390, height: 700 };
  act(() => {
    tree.unmount();
  });
});
it('keeps a square preview fully visible when the window becomes wider than it is tall', () => {
  params = { videoUri: 'file:///render.mp4', orientation: 'square' };
  act(() => {
    tree = TestRenderer.create(React.createElement(PreviewPage));
  });
  const squareFrame = () => tree.root.findByType('VideoView' as never).parent;
  expect(squareFrame()?.props.style[1]).toEqual({ width: 390, height: 390 });
  previewSize = { width: 780, height: 360 };
  act(() => {
    tree.update(React.createElement(PreviewPage));
  });
  expect(squareFrame()?.props.style[1]).toEqual({ width: 360, height: 360 });
});
it('opens export from the routed finished-video preview and pauses playback', () => {
  params = { videoUri: 'file:///render.mp4' };
  act(() => {
    tree = TestRenderer.create(React.createElement(PreviewPage));
  });
  const toolbar = tree.root.findByType(PreviewToolbar);
  expect(toolbar.props.onExport).toEqual(expect.any(Function));
  act(() => {
    tree.root.findByProps({ accessibilityLabel: 'export.title' }).props.onPress();
  });
  expect(player.pause).toHaveBeenCalled();
  expect(tree.root.findByType('ExportSheet' as never).props).toMatchObject({
    visible: true,
    videoUri: params.videoUri,
  });
});
it('keeps export out of recorded-section previews', () => {
  params = { videoUri: 'file:///clip.mp4', sectionName: 'intro' };
  act(() => {
    tree = TestRenderer.create(React.createElement(PreviewPage));
  });
  expect(tree.root.findByType(PreviewToolbar).props.onExport).toBeUndefined();
  expect(tree.root.findAllByType('ExportSheet' as never)).toHaveLength(0);
});
