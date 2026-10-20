// @vitest-environment node
// The checkbox draws state with a solid lavender fill, not the brand gradient, and has a mixed state.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Checkbox, CheckboxMark } from './checkbox';

describe('Checkbox', () => {
  it('fills checked boxes with the primary token, not the gradient', () => {
    const html = renderToStaticMarkup(<Checkbox checked aria-label="x" />);

    expect(html).toContain('data-state="checked"');
    expect(html).toContain('data-[state=checked]:bg-brand-600');
    expect(html).not.toContain('brand-gradient');
    expect(html).toContain('<path d="M3.5 8.5');
  });

  it('draws a dash for the indeterminate state', () => {
    const html = renderToStaticMarkup(<Checkbox checked="indeterminate" aria-label="x" />);

    expect(html).toContain('data-state="indeterminate"');
    expect(html).toContain('<path d="M4 8h8"');
  });

  it('renders the decorative mark hidden from assistive tech with the same box', () => {
    const html = renderToStaticMarkup(<CheckboxMark checked />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-state="checked"');
  });
});
