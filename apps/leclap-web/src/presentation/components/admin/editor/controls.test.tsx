// @vitest-environment node
// Editor controls draw state in solid lavender: the brand gradient is kept for brand moments.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SegmentedControl } from './controls';

const noop = () => {};

describe('editor SegmentedControl', () => {
  it('marks the chosen option with the solid primary fill, not the gradient', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="Loudness"
        value="off"
        onChange={noop}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'loudnorm', label: 'Loudnorm' },
        ]}
      />
    );

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('bg-brand-600');
    expect(html).not.toContain('brand-gradient');
  });
});
