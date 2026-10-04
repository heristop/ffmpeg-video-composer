// Post-build SEO step. The app is a client-rendered SPA: per-route <title>, description, canonical,
// hreflang and OG/Twitter tags are set by src/presentation/components/Seo.tsx in a useEffect — i.e.
// only after JavaScript runs. Crawlers that don't execute JS (Bing, most social unfurlers, many AI
// bots) would otherwise see the home page's English meta on every route.
//
// This script runs after `vite build`. From route manifests it:
//   1. writes a static <route>/index.html for every indexable route with the route's head meta baked
//      in (title/description/canonical/OG per URL, and the correct <html lang>); and
//   2. for the localized marketing routes, writes one file PER LANGUAGE under its URL prefix
//      (English at the root, others under /<lng>) — each with a self-referencing canonical and a full
//      set of reciprocal hreflang alternates (every language + x-default → English). This is the
//      duplicate-content-safe multilingual setup Google expects: distinct URLs tied by hreflang.
//      Each non-English page also gets a modulepreload for its own lazy UI-strings chunk, which the
//      bundler can't emit itself because the language comes from the URL, not the module graph.
//   3. generates dist/sitemap.xml from the same manifests, with xhtml:link alternates on the
//      localized URLs — so the sitemap can never drift from the routes, and noindex pages are absent.
//
// The body still hydrates via React; only the <head> is pre-baked.
//
// The domain, the language list and both route tables come from src/config/site.ts — the same module
// src/presentation/components/Seo.tsx reads — so the prerendered <head> and the runtime one cannot
// drift. The `.ts` extension on those imports is required: this script runs as plain
// `node scripts/seo-prerender.ts`, and Node's type-stripping applies neither tsconfig path mapping
// nor extensionless resolution.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALE_CODES,
  LOCALIZED_ROUTES,
  localeUrl,
  OG_LOCALE,
  SITE_URL,
  type Language,
  type LocalizedRoute,
} from '../src/config/site.ts';
import { DOC_ROUTES } from '../src/config/doc-routes.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const distDir = path.join(appDir, 'dist');
const localesDir = path.join(appDir, 'src/i18n/locales');

const LOCALES = LOCALE_CODES;
type Locale = Language;

// Marketing-route copy lives in each locale's seo bundle so it stays in sync with the runtime <Seo>.
const seoByLocale = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (l) => [l, JSON.parse(await readFile(path.join(localesDir, l, 'seo.json'), 'utf8'))] as const)
  )
) as Record<
  Locale,
  {
    default: SeoEntry;
    studio: SeoEntry;
    about: SeoEntry;
    compareRemotion: SeoEntry;
    legal: SeoEntry;
    privacy: SeoEntry;
    showcase: SeoEntry;
  }
>;

type SeoEntry = { title: string; description: string };

const MARKETING_ROUTES = LOCALIZED_ROUTES;
type MarketingRoute = LocalizedRoute;

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type HeadSpec = {
  lang: Locale;
  title: string;
  description: string;
  canonical: string;
  /** Marketing routes only: emit reciprocal hreflang for these languages + x-default. */
  alternates: boolean;
  routePath: string;
};

const setMeta = (input: string, attr: string, key: string, value: string) =>
  input.replace(
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`),
    (_m: string, p1: string, p2: string) => p1 + value + p2
  );

// Search Console reads the ownership tag from the property root only. Every route clones the same
// template, so drop the tag (and its now-orphaned comment, if HTML minification kept it) from the
// other pages rather than shipping a tag that does nothing there.
const stripVerification = (html: string) =>
  html
    .replace(/[ \t]*<!-- Google Search Console[\s\S]*?-->\n?/, '')
    .replace(/[ \t]*<meta\s+name="google-site-verification"[^>]*>\n?/, '');

// Reciprocal hreflang for every language + x-default, plus og:locale:alternate for the others.
// og:locale itself is patched in place by patchHead so the template's existing tag isn't duplicated.
function alternateLines(spec: HeadSpec) {
  const lines: string[] = [];

  for (const lng of LOCALES) {
    lines.push(`    <link rel="alternate" hreflang="${lng}" href="${escapeAttr(localeUrl(lng, spec.routePath))}" />`);

    if (lng !== spec.lang) {
      lines.push(`    <meta property="og:locale:alternate" content="${OG_LOCALE[lng]}" />`);
    }
  }

  lines.push(`    <link rel="alternate" hreflang="x-default" href="${escapeAttr(localeUrl('en', spec.routePath))}" />`);

  return lines;
}

// Everything this script appends to <head>: the language's lazy UI chunk (non-English pages, so the
// browser starts fetching it alongside the eager graph instead of a round-trip later), then the
// reciprocal hreflang set on the marketing routes. Doc routes are English-only and get neither.
function headExtras(spec: HeadSpec) {
  const lines: string[] = [];
  const localeChunk = localeChunks[spec.lang];

  if (localeChunk) {
    lines.push(`    <link rel="modulepreload" crossorigin href="${localeChunk}">`);
  }

  if (spec.alternates) {
    lines.push(...alternateLines(spec));
  }

  return lines;
}

// Swap a head tag's value in place, tolerant of the multi-line attribute formatting Vite preserves.
function patchHead(html: string, spec: HeadSpec) {
  const title = escapeAttr(spec.title);
  const desc = escapeAttr(spec.description);
  const url = escapeAttr(spec.canonical);

  const metas: Array<['name' | 'property', string, string]> = [
    ['name', 'description', desc],
    ['property', 'og:title', title],
    ['property', 'og:description', desc],
    ['property', 'og:url', url],
    ['property', 'og:locale', OG_LOCALE[spec.lang]],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', desc],
  ];

  const base = spec.canonical === `${SITE_URL}/` ? html : stripVerification(html);

  let out = base.replace(/<html lang="[^"]*">/, `<html lang="${spec.lang}">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);

  for (const [attr, key, value] of metas) {
    out = setMeta(out, attr, key, value);
  }

  out = out.replace(
    /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
    (_m: string, p1: string, p2: string) => p1 + url + p2
  );

  const extras = headExtras(spec);

  if (extras.length === 0) {
    return out;
  }

  return out.replace('</head>', `${extras.join('\n')}\n  </head>`);
}

const marketingTitle = (route: MarketingRoute, lng: Locale) => {
  const entry = seoByLocale[lng][route.seoKey];

  return route.titleVerbatim ? entry.title : `${entry.title} — LeClap`;
};

// Where a (route, locale) pair's HTML is written. English keeps the root tree; others nest under
// /<lng>. The English home is dist/index.html itself.
//
// Non-home routes are written as a SIBLING `<route>.html`, not `<route>/index.html`. Static hosts
// serve a folder index at the slash-suffixed URL and redirect the bare path to it (`/studio` → 308 →
// `/studio/`), while `studio.html` is served directly at `/studio`. Every canonical, hreflang
// alternate and sitemap <loc> here uses the slash-less form, so the folder layout made Google follow
// a redirect for each one and land on a page whose canonical pointed back at the redirect. This is
// fixed behaviour on Cloudflare Pages — it is not configurable — and the sibling layout also serves
// correctly on Workers static assets, so it stays right if the deploy target changes.
const fileFor = (routePath: string, lng: Locale) => {
  const prefix = lng === 'en' ? '' : `/${lng}`;
  const rel = `${prefix}${routePath === '/' ? '' : routePath}`.replace(/^\//, '');

  return rel === '' ? path.join(distDir, 'index.html') : path.join(distDir, `${rel}.html`);
};

function buildSitemap(lastmod: string) {
  const xhtml = (routePath: string) =>
    [
      ...LOCALES.map((lng) => ({ hreflang: lng as string, href: localeUrl(lng, routePath) })),
      { hreflang: 'x-default', href: localeUrl('en', routePath) },
    ]
      .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
      .join('\n');

  const marketing = MARKETING_ROUTES.flatMap((r) =>
    LOCALES.map(
      (lng) =>
        `  <url>\n    <loc>${localeUrl(lng, r.path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n${xhtml(r.path)}\n  </url>`
    )
  );

  const docs = DOC_ROUTES.map(
    (r) =>
      `  <url>\n    <loc>${SITE_URL}${r.path}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${[...marketing, ...docs].join('\n')}\n</urlset>\n`
  );
}

const template = await readFile(path.join(distDir, 'index.html'), 'utf8');

// Sanity check: a stale template (wrong domain) would silently bake bad canonicals into every page.
if (!template.includes(SITE_URL)) {
  throw new Error(`dist/index.html does not reference ${SITE_URL} — rebuild before prerendering.`);
}

// Each non-English UI bundle is a lazy chunk (see src/i18n/index.ts). Vite's own modulepreload tags
// cover the eager graph only, and the language is a property of the URL rather than of the bundle
// graph — so on a cold /fr visit the browser can't even discover the French chunk until the entry
// has run and the path detector has resolved the language. That serializes a whole round-trip ahead
// of first paint, on exactly the prefixed pages this script exists to make fast. Naming the chunk in
// the prerendered <head> lets the fetch start with the rest of the eager graph instead of after it.
//
// The names are content-hashed, so they're read back out of the build rather than written down here:
// a hardcoded hash would go stale on the next build and preload a 404. English is absent by design —
// `en` ships inside the eager graph, so the root pages already have it.
//
// Read from the build manifest (`build.manifest: true` in vite.config.ts), which maps source module
// to emitted file, rather than by scanning dist/assets for `<lng>-*.js`. Filenames cannot carry that
// question: rolldown names an unassigned node_modules chunk after the module's basename, so
// `es-toolkit-<hash>.js`, `de-indent-<hash>.js` and `it-tools-<hash>.js` are all valid answers to a
// `^<lng>-[A-Za-z0-9_-]+\.js$` pattern — and the "exactly one chunk per locale" assumption is
// already false for `en`, which emits a facade plus a payload and escapes only by being filtered out.
const MANIFEST_FILE = path.join(distDir, '.vite/manifest.json');

/** The preload is a cosmetic hint. Nothing here may fail a build that has already succeeded. */
function skipPreloads(reason: string): Partial<Record<Locale, string>> {
  console.warn(`[seo-prerender] no locale modulepreloads: ${reason}`);

  return {};
}

async function readLocaleChunks(): Promise<Partial<Record<Locale, string>>> {
  const manifest = await readFile(MANIFEST_FILE, 'utf8').then(
    (raw) => JSON.parse(raw) as Record<string, { file?: string } | undefined>,
    (error: unknown) => {
      console.warn(`[seo-prerender] could not read ${MANIFEST_FILE}: ${String(error)}`);

      return null;
    }
  );

  if (!manifest) {
    return skipPreloads('the build manifest is missing (is build.manifest still enabled?)');
  }

  const entries = LOCALES.filter((lng) => lng !== 'en').map(
    (lng) => [lng, manifest[`src/i18n/locales/${lng}/index.ts`]?.file] as const
  );
  const missing = entries.filter(([, file]) => !file).map(([lng]) => lng);

  // Warn rather than throw: a locale that stops resolving to a chunk means the code-splitting in
  // src/i18n/index.ts changed shape, which is worth a look — but it is not worth failing a release.
  if (missing.length > 0) {
    return skipPreloads(`no manifest entry for ${missing.join(', ')} — did src/i18n/index.ts change shape?`);
  }

  return Object.fromEntries(entries.map(([lng, file]) => [lng, `/${file}`]));
}

const localeChunks = await readLocaleChunks();

async function writeFileFor(routePath: string, lng: Locale, spec: HeadSpec) {
  const file = fileFor(routePath, lng);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, patchHead(template, spec));
}

const jobs: Promise<void>[] = [];

for (const route of MARKETING_ROUTES) {
  for (const lng of LOCALES) {
    jobs.push(
      writeFileFor(route.path, lng, {
        lang: lng,
        title: marketingTitle(route, lng),
        description: seoByLocale[lng][route.seoKey].description,
        canonical: localeUrl(lng, route.path),
        alternates: true,
        routePath: route.path,
      })
    );
  }
}

for (const route of DOC_ROUTES) {
  jobs.push(
    writeFileFor(route.path, 'en', {
      lang: 'en',
      title: `${route.title} — LeClap`,
      description: route.description,
      canonical: `${SITE_URL}${route.path}`,
      alternates: false,
      routePath: route.path,
    })
  );
}

const lastmod = new Date().toISOString().slice(0, 10);
jobs.push(writeFile(path.join(distDir, 'sitemap.xml'), buildSitemap(lastmod)));
await Promise.all(jobs);

const localizedFiles = MARKETING_ROUTES.length * LOCALES.length;
const sitemapUrls = MARKETING_ROUTES.length * LOCALES.length + DOC_ROUTES.length;
console.log(
  `seo-prerender: ${localizedFiles} localized + ${DOC_ROUTES.length} doc pages written, ` +
    `sitemap.xml (${sitemapUrls} urls with hreflang alternates).`
);
