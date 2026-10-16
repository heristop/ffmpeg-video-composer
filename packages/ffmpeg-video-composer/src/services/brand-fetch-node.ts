// packages/ffmpeg-video-composer/src/services/brand-fetch-node.ts
// Node host for brand kits: fetch a page, up to 3 of its own stylesheets and its logo, then parse them.
// The URL is untrusted (an agent can pick it), so every request is HTTPS to a public address: each hop
// (the URL and each of at most 3 manual redirects) is resolved and refused unless every address is public.
// Bodies are capped while streaming (maxBytes) and each request is capped in time (timeoutMs, plus the
// caller's signal); no cookies or credentials are sent. Known limit: DNS can still change between the
// check and the connection (rebinding); the caps and HTTPS-only keep that window small, and the MCP
// server only fetches when its operator opts in.

import { lookup as dnsLookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  cssColors,
  cssFonts,
  MAX_BRAND_COLORS,
  MAX_BRAND_FAMILIES,
  MAX_FAMILY_NAME,
  parseBrandPage,
  sanitizeBrandName,
  withThemeColor,
  type BrandKit,
  type BrandLogo,
} from '../core/brand';

export interface BrandFetchOptions {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const MAX_BYTES = 2_000_000;
const MAX_LOGO_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_STYLESHEETS = 3;
const HEADERS = { 'user-agent': 'LeClap brand reader', accept: 'text/html,text/css,image/*;q=0.9,*/*;q=0.5' };

/** The image content types a logo may come back as, with the file each is saved to (never named by a URL). */
const LOGO_FILES: Record<string, string> = {
  'image/png': 'logo.png',
  'image/svg+xml': 'logo.svg',
  'image/jpeg': 'logo.jpg',
  'image/webp': 'logo.webp',
  'image/x-icon': 'logo.ico',
  'image/vnd.microsoft.icon': 'logo.ico',
};

async function defaultLookup(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true, order: 'verbatim' })).map((entry) => entry.address);
}

/** IPv4 ranges that are not publicly routable. */
const V4_BLOCKED = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8',
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.168.0.0/16',
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/3', // multicast, reserved, broadcast
];

/** IPv6 ranges that carry an IPv4 address, judged by that address: bit offset of the IPv4 inside. */
const V6_EMBEDDING_V4: [string, number][] = [
  ['::/96', 0], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0/96', 0], // IPv4-mapped
  ['64:ff9b::/96', 0], // NAT64 well-known prefix
  ['2002::/16', 80], // 6to4
];

/** Only global unicast (2000::/3) is public, minus these; fc00::/7, fe80::/10, ff00::/8 etc. fall outside. */
const V6_GLOBAL = '2000::/3';
const V6_BLOCKED = ['2001::/32', '2001:20::/28', '2001:db8::/32']; // Teredo, ORCHIDv2, documentation

function v4Value(ip: string): bigint {
  return ip.split('.').reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

/** An IPv6 address as a 128-bit number (an embedded dotted IPv4 tail fills the last 32 bits). */
function v6Value(ip: string): bigint {
  const tail = /\d+\.\d+\.\d+\.\d+$/.exec(ip)?.[0];
  const hex = tail ? ip.slice(0, -tail.length) + '0:0' : ip;
  const halves = hex.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const zeros = halves.length > 1 ? Array<string>(8 - left.length - right.length).fill('0') : [];
  const value = [...left, ...zeros, ...right].reduce((sum, group) => (sum << 16n) | BigInt(parseInt(group, 16)), 0n);

  return tail ? value | v4Value(tail) : value;
}

function inRange(value: bigint, cidr: string, width: 32 | 128): boolean {
  const [base, prefix] = cidr.split('/');
  const shift = BigInt(width - Number(prefix));
  const start = width === 32 ? v4Value(base) : v6Value(base);

  return value >> shift === start >> shift;
}

function v4Public(value: bigint): boolean {
  return !V4_BLOCKED.some((cidr) => inRange(value, cidr, 32));
}

function v6Public(value: bigint): boolean {
  const embedding = V6_EMBEDDING_V4.find(([cidr]) => inRange(value, cidr, 128));

  if (embedding) return v4Public((value >> BigInt(embedding[1])) & 0xffffffffn);

  return inRange(value, V6_GLOBAL, 128) && !V6_BLOCKED.some((cidr) => inRange(value, cidr, 128));
}

/** Whether an IP address (v4 or v6, an optional zone ignored) is publicly routable; anything else is false. */
export function isPublicAddress(ip: string): boolean {
  const address = ip.replace(/%.*$/, '');
  const family = isIP(address);

  if (family === 4) return v4Public(v4Value(address));

  return family === 6 && v6Public(v6Value(address));
}

async function assertPublic(url: URL, lookup: (host: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== 'https:') throw new Error(`Only https:// is fetched (${url.href})`);

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await lookup(host);

  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new Error(`${url.hostname} doesn't resolve to a public address`);
  }
}

function tooLarge(maxBytes: number, url: string): Error {
  return new Error(`Response too large (over ${maxBytes} bytes): ${url}`);
}

async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cap: { maxBytes: number; url: string },
  chunks: Uint8Array[] = [],
  size = 0
): Promise<Uint8Array> {
  const { done, value } = await reader.read();

  if (done) return Buffer.concat(chunks);

  if (size + value.byteLength > cap.maxBytes) {
    await reader.cancel();

    throw tooLarge(cap.maxBytes, cap.url);
  }

  chunks.push(value);

  return drain(reader, cap, chunks, size + value.byteLength);
}

/** The body, refused (and the stream cancelled) as soon as it goes over maxBytes. */
async function readCapped(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();

    throw tooLarge(maxBytes, url);
  }

  return response.body ? drain(response.body.getReader(), { maxBytes, url }) : new Uint8Array();
}

interface Fetched {
  url: string;
  type: string;
  body: Uint8Array;
}

interface Hop {
  url: URL;
  hop: number;
  maxBytes: number;
}

function requestSignal(options: BrandFetchOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);

  return options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
}

/** The next URL of a 3xx answer, resolved against the current one. */
async function redirectTarget(response: Response, url: URL): Promise<URL> {
  const location = response.headers.get('location');
  await response.body?.cancel();

  if (!location) throw new Error(`${url.href} redirected (${response.status}) without a Location`);

  return new URL(location, url);
}

/** GET over HTTPS from public hosts only, following at most 3 redirects by hand, capped in size and time. */
async function get({ url, hop, maxBytes }: Hop, options: BrandFetchOptions): Promise<Fetched> {
  if (hop > MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);

  options.signal?.throwIfAborted();

  if (url.username || url.password) throw new Error('URLs that embed credentials are not fetched');

  await assertPublic(url, options.lookup ?? defaultLookup);

  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(url.href, {
    redirect: 'manual',
    credentials: 'omit',
    signal: requestSignal(options),
    headers: HEADERS,
  });

  if (response.status >= 300 && response.status < 400) {
    return get({ url: await redirectTarget(response, url), hop: hop + 1, maxBytes }, options);
  }

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(`${url.href} answered ${response.status}`);
  }

  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

  return { url: url.href, type, body: await readCapped(response, maxBytes, url.href) };
}

/** Always a promise: a bad or credentialed URL rejects instead of throwing before a caller's .catch attaches. */
async function safeGet(href: string, options: BrandFetchOptions, maxBytes = options.maxBytes ?? MAX_BYTES) {
  return get({ url: new URL(href), hop: 0, maxBytes }, options);
}

function text(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

/** The kit's colours (the heaviest MAX_BRAND_COLORS) and families (the first MAX_BRAND_FAMILIES), bounded. */
function bounded(kit: BrandKit): BrandKit {
  return {
    ...kit,
    colors: kit.colors.toSorted((a, b) => b.weight - a.weight).slice(0, MAX_BRAND_COLORS),
    fonts: { ...kit.fonts, families: kit.fonts.families.slice(0, MAX_BRAND_FAMILIES) },
  };
}

/** Read a brand kit from an https:// site: its name, colours, fonts and the logo's URL (not downloaded). */
export async function fetchBrandKit(url: string, options: BrandFetchOptions = {}): Promise<BrandKit> {
  const page = await safeGet(url, options);
  const parsed = parseBrandPage(text(page.body), page.url);
  const sheets = await Promise.all(
    parsed.stylesheets.slice(0, MAX_STYLESHEETS).map((sheet) =>
      safeGet(sheet, options)
        .then((fetched) => text(fetched.body))
        .catch(() => '')
    )
  );
  options.signal?.throwIfAborted();

  const css = [parsed.inlineCss, ...sheets].join('\n');
  const colors = cssColors(css);
  const fonts = cssFonts(css);

  const google = parsed.googleFamilies.filter((family) => family !== '' && family.length <= MAX_FAMILY_NAME);

  return bounded({
    url: page.url,
    name: sanitizeBrandName(parsed.name),
    colors: withThemeColor(colors, parsed.themeColor),
    fonts: {
      ...fonts,
      body: fonts.body ?? google.at(0) ?? null,
      families: [...new Set([...fonts.families, ...google])],
    },
    logo: parsed.logo,
  });
}

/** Download a logo, at most 2 MB, as whichever allowed image type it comes back as; that type names the file. */
async function downloadLogo(logo: BrandLogo, options: BrandFetchOptions): Promise<{ file: string; body: Uint8Array }> {
  const download = await safeGet(logo.url, options, Math.min(options.maxBytes ?? MAX_LOGO_BYTES, MAX_LOGO_BYTES));
  const file = Object.hasOwn(LOGO_FILES, download.type) ? LOGO_FILES[download.type] : null;

  if (!file) throw new Error(`The logo isn't an image (got "${download.type}"): ${download.url}`);

  return { file, body: download.body };
}

/** The logo, or why it could not be had; a caller's abort is never swallowed into a reason. */
async function tryLogo(
  logo: BrandLogo,
  options: BrandFetchOptions
): Promise<{ file: string; body: Uint8Array } | { error: string }> {
  try {
    return await downloadLogo(logo, options);
  } catch (error) {
    options.signal?.throwIfAborted();

    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The logo as recorded in brand-kit.json: its URL and type, plus the saved `file` when there is one. */
function savedLogo(logo: BrandLogo | null, file?: string): BrandLogo | null {
  if (!logo) return null;

  return { url: logo.url, type: logo.type, source: logo.source, ...(file ? { file } : {}) };
}

/**
 * Download the kit's logo and write it and brand-kit.json into `dir`. File names are fixed
 * (`logo.<ext>` from the returned image type, `brand-kit.json`), never taken from a URL, so nothing is
 * written outside `dir`. The logo is optional: if it can't be had (not an image, too large, unreachable)
 * the kit is saved with the logo's URL but no `file`, `logo` is null and `logoError` says why.
 */
export async function saveBrandKit(
  kit: BrandKit,
  dir: string,
  options: BrandFetchOptions = {}
): Promise<{ kit: BrandKit; json: string; logo: string | null; logoError?: string }> {
  const result = kit.logo ? await tryLogo(kit.logo, options) : null;
  const download = result && 'file' in result ? result : null;
  const logoError = result && 'error' in result ? result.error : undefined;
  const logo = download ? path.join(dir, download.file) : null;
  const saved: BrandKit = {
    ...bounded(kit),
    name: sanitizeBrandName(kit.name),
    logo: savedLogo(kit.logo, download?.file),
  };

  await mkdir(dir, { recursive: true });

  if (logo && download) await writeFile(logo, download.body);

  const json = path.join(dir, 'brand-kit.json');
  await writeFile(json, `${JSON.stringify(saved, null, 2)}\n`);

  return { kit: saved, json, logo, ...(logoError ? { logoError } : {}) };
}
