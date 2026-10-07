// Bundle guard for the browser-agent (WebMCP) code, run against a production build (`vite build`; skipped
// when there is no dist/). Nothing WebMCP may load with the entry: neither the entry script nor any
// chunk index.html modulepreloads may carry it, and the dev-only polyfill must not be in the build at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const indexHtml = path.join(dist, 'index.html');
const built = fs.existsSync(indexHtml);

// String literals that survive minification: the settings key, ModelContext detection, the tool layer.
const WEBMCP_MARKERS = ['leclap.webmcp.v1', 'modelContext', 'Builder guide (WebMCP)', 'revision_conflict: template'];
const POLYFILL_MARKERS = ['initializeWebMCPPolyfill', '__isWebMCPPolyfill', 'modelContextTesting'];

function eagerChunks(): string[] {
  const html = fs.readFileSync(indexHtml, 'utf8');
  const urls = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+\.js)"/g)];

  return urls.map((match) => path.join(dist, match[1].replace(/^\//, '')));
}

describe.skipIf(!built)('WebMCP bundle guard', () => {
  it('keeps WebMCP code out of the entry chunk and its modulepreload set', () => {
    const chunks = eagerChunks();

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const code = fs.readFileSync(chunk, 'utf8');

      for (const marker of WEBMCP_MARKERS) expect(code.includes(marker), `${marker} in ${chunk}`).toBe(false);
    }
  });

  it('ships no polyfill in a production build', () => {
    const assets = fs.readdirSync(path.join(dist, 'assets')).filter((file) => file.endsWith('.js'));

    for (const file of assets) {
      const code = fs.readFileSync(path.join(dist, 'assets', file), 'utf8');

      for (const marker of POLYFILL_MARKERS) expect(code.includes(marker), `${marker} in ${file}`).toBe(false);
    }
  });
});
