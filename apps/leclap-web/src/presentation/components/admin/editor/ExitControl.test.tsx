// @vitest-environment node
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exit } from '../templateEditorModel';
import { overlayVisibilityAt } from '../editor-shell/overlay-visibility.logic';
import { ExitControl } from './ExitControl';

const controls = vi.hoisted(() => new Map<string, (value: string) => void>());

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./SectionDisclosure', () => ({ SectionDisclosure: ({ children }: { children: ReactNode }) => children }));
vi.mock('./controls', () => ({
  RangeSlider: () => null,
  SegmentedControl: ({ label, onChange }: { label: string; onChange: (value: string) => void }) => {
    controls.set(label, onChange);

    return null;
  },
}));

beforeEach(() => {
  controls.clear();
});

describe('ExitControl easing authoring', () => {
  it.each<Exit>(['rise', { type: 'rise', after: 2, duration: 1, easing: 'ease-out' }])(
    'preserves an explicit Linear selection for preview/render parity: %j',
    (exit) => {
      const onChange = vi.fn<(exit: Exit | undefined) => void>();
      renderToStaticMarkup(<ExitControl exit={exit} onChange={onChange} />);
      controls.get('exit.easing')?.('linear');

      const authored = onChange.mock.calls[0]?.[0];
      expect(authored).toEqual({ ...(typeof exit === 'string' ? { type: exit } : exit), easing: 'linear' });
      const midpoint = typeof exit === 'string' ? 3.7 : 2.5;
      expect(overlayVisibilityAt(undefined, authored, midpoint, 4).opacity).toBeCloseTo(0.5, 5);
    }
  );

  it('leaves omitted legacy easing untouched until the author selects a curve', () => {
    const onChange = vi.fn();
    renderToStaticMarkup(<ExitControl exit="fade" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(overlayVisibilityAt(undefined, 'fade', 3.7, 4).opacity).toBeCloseTo(0.03125, 5);
  });

  it('keeps an authored spring when the author re-picks its own segment', () => {
    const onChange = vi.fn();
    renderToStaticMarkup(<ExitControl exit={{ type: 'rise', easing: 'spring(300, 14)' }} onChange={onChange} />);
    controls.get('exit.easing')?.('custom');

    expect(onChange).not.toHaveBeenCalled();
  });
});
