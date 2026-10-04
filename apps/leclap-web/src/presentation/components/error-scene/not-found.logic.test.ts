import { describe, expect, it } from 'vitest';
import { DOC_ROUTES } from '@/config/doc-routes';
import { LOCALIZED_ROUTES, UNINDEXED_PATHS } from '@/config/site';
import { KNOWN_PATHS, suggestPath, withPath } from './not-found.logic';

// The router's redirects: real paths, but never a page worth pointing a lost visitor to.
const REDIRECTS = new Set(['/builder', '/admin', '/projects', '/use-cases/agentic-development', '/docs/*']);

describe('KNOWN_PATHS', () => {
  it('lists every page the router serves except home, and nothing else', () => {
    const pages = [
      ...LOCALIZED_ROUTES.map((route) => route.path),
      ...DOC_ROUTES.map((route) => route.path),
      ...UNINDEXED_PATHS.filter((path) => !REDIRECTS.has(path) && !path.includes(':') && path !== '*'),
    ].filter((path) => path !== '/');

    expect(KNOWN_PATHS.toSorted()).toEqual(pages.toSorted());
  });
});

describe('suggestPath', () => {
  it('finds the page behind a typo', () => {
    expect(suggestPath('/studo')).toBe('/studio');
    expect(suggestPath('/doc/transitons')).toBe('/doc/transitions');
    expect(suggestPath('/prvacy')).toBe('/privacy');
  });

  it('counts swapped letters as one slip', () => {
    expect(suggestPath('/studio/nwe')).toBe('/studio/new');
  });

  it('ignores case and a trailing slash', () => {
    expect(suggestPath('/DOC/Transitons/')).toBe('/doc/transitions');
  });

  it('falls back to the deepest page above a path it cannot place', () => {
    expect(suggestPath('/doc/nothing-here')).toBe('/doc');
    expect(suggestPath('/studio/new/extra')).toBe('/studio/new');
  });

  it('offers the only page below a path that stops short', () => {
    expect(suggestPath('/compare')).toBe('/compare/remotion');
  });

  it('suggests nothing when nothing is close, rather than a guess', () => {
    expect(suggestPath('/wp-admin')).toBeNull();
    expect(suggestPath('/x')).toBeNull();
    expect(suggestPath('/')).toBeNull();
  });
});

describe('withPath', () => {
  it('drops the address into the slot the translation put it in', () => {
    expect(withPath('Nothing lives at <path/>. An old link?', '/studo')).toEqual([
      { text: 'Nothing lives at ', isPath: false },
      { text: '/studo', isPath: true },
      { text: '. An old link?', isPath: false },
    ]);
  });

  it('leaves no empty text around a slot at either end', () => {
    expect(withPath('<path/> est introuvable', '/x')).toEqual([
      { text: '/x', isPath: true },
      { text: ' est introuvable', isPath: false },
    ]);
  });

  it('keeps the address as text, never as markup', () => {
    expect(withPath('At <path/>', '/<path/>')).toEqual([
      { text: 'At ', isPath: false },
      { text: '/<path/>', isPath: true },
    ]);
  });
});
