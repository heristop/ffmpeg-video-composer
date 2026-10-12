// @vitest-environment node
// The clap as a visitor starts the film: the LeClap mark (the header's logo) popping at the centre and clapping.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerClap } from './player-card';

describe('PlayerClap', () => {
  const html = renderToStaticMarkup(<PlayerClap />);

  it('pops the LeClap mark, with its clapper stick ready to clap', () => {
    expect(html).toContain('data-player-clap="logo"');
    expect(html).toContain('attributeName="transform"');
  });

  it('no longer draws a clapperboard of its own', () => {
    expect(html).not.toContain('player-clap-stick');
  });

  it('stays decorative', () => {
    expect(html).toContain('aria-hidden="true"');
  });
});
