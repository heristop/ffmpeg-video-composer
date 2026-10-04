import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReferenceArticle, referenceHref, referenceHeadingId } from './ReferenceArticle';

describe('canonical documentation rendering', () => {
  it('routes canonical doc links locally and source links to their repository paths', () => {
    expect(referenceHref('./engine-configuration.md#qualitytier')).toBe('/doc/engine#qualitytier');
    expect(referenceHref('../examples/llm-remotion-title/README.md')).toBe(
      'https://github.com/heristop/leclap/blob/main/examples/llm-remotion-title/README.md'
    );
    expect(referenceHref('#reveal')).toBe('#reveal');
    expect(referenceHref('https://example.com')).toBe('https://example.com');
    expect(referenceHeadingId('`qualityTier`')).toBe('qualitytier');
  });
  it('renders tables and scroll-spy anchors, preserves code languages, and skips executable HTML', () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceArticle, {
        source:
          '# Hidden title\n\n## Configuration\n\n### `qualityTier`\n\n### Repeated\n\n### Repeated\n\n| Field | Default |\n| --- | --- |\n| qualityTier | standard |\n\n```ts\nconst example = 1;\n```\n\n<script>alert(1)</script>',
      })
    );
    expect(html).toContain('data-toc-level="2"');
    expect(html).toContain('id="qualitytier"');
    expect(html).toContain('id="repeated-1"');
    expect(html).toContain('<table');
    expect(html).toContain('data-language="ts"');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<script');
  });
});
