// Unit tests run in Jest; the app type program uses Vitest globals.
declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(impl?: (...args: never[]) => unknown): ((...args: never[]) => unknown) & { mock: { calls: unknown[][] } };
};
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { CaptionsPanel } from './captions-panel';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Switch: 'Switch',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/src/features/editor/preview/previewStyles', () => ({ styles: {} }));
jest.mock('@/src/styles/theme', () => ({
  colors: {},
  fonts: { inter: {}, poppins: {} },
  spacing: {},
}));

const captions = {
  words: [
    { text: 'Hello', start: 0, end: 0.4, confidence: 0.9 },
    { text: 'wold', start: 0.5, end: 0.9, confidence: 0.3 },
  ],
  coarse: false,
  clipPath: 'file:///clip.mp4',
  record: { from: 'intro', engine: 'ios-speech' },
};

function render(overrides: Record<string, unknown> = {}) {
  const props = {
    captions,
    enabled: true,
    status: 'idle' as const,
    error: null,
    onToggle: jest.fn(),
    onWordsChange: jest.fn(),
    onRetry: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  let tree!: TestRenderer.ReactTestRenderer;

  act(() => {
    tree = TestRenderer.create(React.createElement(CaptionsPanel, props as never));
  });

  return { tree, props };
}

it('shows each word as a chip with the tap-to-fix hint', () => {
  const { tree } = render();
  const texts = tree.root.findAllByType('Text' as never).map((node) => node.props.children);

  expect(texts).toEqual(expect.arrayContaining(['captions.tapToFix', 'Hello', 'wold']));
});

it('fixes a tapped word in place and saves the edit on blur', () => {
  const { tree, props } = render();
  const chip = tree.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityHint === 'wold'
  )[0];

  act(() => {
    chip.props.onPress();
  });

  const input = tree.root.findByType('TextInput' as never);

  act(() => {
    input.props.onChangeText('world');
  });
  act(() => {
    tree.root.findByType('TextInput' as never).props.onBlur();
  });

  expect(props.onWordsChange.mock.calls[0][0]).toEqual([
    captions.words[0],
    { text: 'world', start: 0.5, end: 0.9, confidence: 0.3 },
  ]);
  expect(tree.root.findAllByType('TextInput' as never)).toHaveLength(0);
});

it('turns captions on and off with the toggle', () => {
  const { tree, props } = render({ captions: null, enabled: false });

  act(() => {
    tree.root.findByType('Switch' as never).props.onValueChange(true);
  });

  expect(props.onToggle.mock.calls[0]).toEqual([true]);
  expect(tree.root.findAllByType('Text' as never).map((node) => node.props.children)).toContain('captions.privacy');
});

it('explains a device without on-device recognition', () => {
  const { tree } = render({ captions: null, status: 'error', error: 'unavailable' });

  expect(tree.root.findAllByType('Text' as never).map((node) => node.props.children)).toContain(
    'captions.errors.unavailable'
  );
});
