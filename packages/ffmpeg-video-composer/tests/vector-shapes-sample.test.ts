import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TemplateDescriptor } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';

type ShapeEntry = { type: string; d?: string; stroke?: { draw?: boolean }; animate?: unknown; gradient?: unknown };

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  fs.readFileSync(path.resolve(here, '../../../examples/motion-design/vector-shapes.json'), 'utf8')
) as TemplateDescriptor;
const shapes = (sample.sections ?? []).flatMap((section) =>
  ((section as { graphics?: ShapeEntry[] }).graphics ?? []).filter((graphic) => graphic.type === 'shape')
);

describe('vector-shapes sample', () => {
  it('validates', () => {
    expect(new TemplateValidator().validateTemplate(sample).errors ?? []).toEqual([]);
  });

  it('shows a pop on tracks, a draw-on, an SVG icon and a gradient blob', () => {
    expect(shapes.some((g) => g.animate)).toBe(true);
    expect(shapes.some((g) => g.stroke?.draw)).toBe(true);
    expect(shapes.some((g) => g.d)).toBe(true);
    expect(shapes.some((g) => g.gradient)).toBe(true);
  });
});
