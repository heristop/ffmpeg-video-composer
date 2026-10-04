import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const DOCS = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'DESIGN.md',
  'CODE_OF_CONDUCT.md',
  'docs/effects-configuration.md',
  'docs/engine-configuration.md',
  'docs/template-configuration.md',
  'docs/creative-direction.md',
];

// Markdown inline links. Reference-style links and bare URLs are out of scope — the repo does not
// use them for local paths, and a regex that tried to cover both would produce more false
// positives than findings.
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// README and DESIGN drop into raw HTML for the badge/screenshot blocks and for the inline
// source-file citations, so those hrefs rot exactly like the markdown ones and have to be scanned
// too.
const HTML_LINK = /<(?:a|img)\b[^>]*?(?:href|src)=["']([^"']+)["']/gi;

const isExternal = (href: string) => /^(https?:|mailto:|#|data:|\/\/)/.test(href);

const hrefs = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map(([, href]) => href).filter((href) => !isExternal(href));

const relativeLinks = (source: string) => [...hrefs(source, MARKDOWN_LINK), ...hrefs(source, HTML_LINK)];

const read = (doc: string) => readFileSync(join(repoRoot, doc), 'utf8');

describe.each(DOCS)('%s relative links', (doc) => {
  it('resolve to files that exist on disk', () => {
    const source = read(doc);
    const broken: string[] = [];

    for (const href of relativeLinks(source)) {
      // Strip an anchor: docs/architecture.md#cross-platform-support -> docs/architecture.md
      const path = href.split('#')[0];
      if (path.length === 0) continue;
      if (!existsSync(resolve(dirname(join(repoRoot, doc)), path))) broken.push(href);
    }

    expect(broken, `broken relative links in ${doc}`).toEqual([]);
  });
});

// Guards the patterns themselves. README links to local files in both syntaxes; if either regex
// stopped matching, the checks above would report zero broken links and pass for the wrong reason.
describe('link extraction', () => {
  const readme = read('README.md');

  it('finds README markdown links', () => {
    expect(hrefs(readme, MARKDOWN_LINK)).toContain('docs/architecture.md');
  });

  // Pinned to the masthead logo rather than a prose link: prose gets rewritten (an earlier version
  // pinned a citation that a README trim deleted, failing this for the wrong reason), but the <img>
  // in the centred header block is structural.
  it('finds README html links', () => {
    expect(hrefs(readme, HTML_LINK)).toContain('.github/media/clappy.png');
  });
});
