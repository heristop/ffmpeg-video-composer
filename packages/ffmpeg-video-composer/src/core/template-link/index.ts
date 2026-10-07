// Template links: a whole template descriptor carried in the URL fragment of the web builder,
// `https://leclap.dev/studio/builder#t=v1.<base64url(deflate-raw(JSON))>`. Browsers never send the
// fragment to a server, so handing a template from an agent to a person needs no upload and no backend.
// Pure: no Node or DOM imports, so the web app, the CLI and the MCP server share it.
import { TemplateDescriptorSchema } from '../../schemas/section.schemas';
import { fromBase64Url, toBase64Url } from './base64url';
import { deflateRaw, inflateRaw } from './deflate';
import { mediaToRebind, type MediaToRebind } from './media-refs';

export { classifyMediaRef, mediaToRebind, type MediaRebindReason, type MediaToRebind } from './media-refs';

export const TEMPLATE_LINK_VERSION = 'v1';
export const TEMPLATE_LINK_PARAM = 't';
export const DEFAULT_BUILDER_BASE_URL = 'https://leclap.dev';
export const BUILDER_PATH = '/studio/builder';
const DEFAULT_ORIGIN = new URL(DEFAULT_BUILDER_BASE_URL).origin;

export const TEMPLATE_LINK_LIMITS = {
  /** Above this many URL characters chat apps, terminals and mail clients may truncate the link. */
  warnLength: 8000,
  /** Hard ceiling on the encoded payload; well inside what every current browser accepts in a URL. */
  maxPayloadLength: 512 * 1024,
  /** Most template JSON a payload may inflate to, so a crafted link cannot exhaust memory. */
  maxJsonBytes: 4 * 1024 * 1024,
} as const;

export type TemplateLinkErrorCode =
  | 'empty'
  | 'unsupported_version'
  | 'malformed'
  | 'too_large'
  | 'corrupt'
  | 'invalid_json'
  | 'invalid_template'
  | 'invalid_base_url';

export class TemplateLinkError extends Error {
  constructor(
    readonly code: TemplateLinkErrorCode,
    message: string,
    readonly issues: string[] = []
  ) {
    super(message);
    this.name = 'TemplateLinkError';
  }
}

const PREFIX = `${TEMPLATE_LINK_VERSION}.`;
const VERSIONED = /^(v\d+)\./;
const TOO_LARGE_HINT = 'export the JSON and use Import in the builder instead';

function templateIssues(template: unknown): string[] {
  const result = TemplateDescriptorSchema.safeParse(template);

  if (result.success) return [];

  return result.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`);
}

function assertTemplate(template: unknown): void {
  const issues = templateIssues(template);

  if (issues.length > 0) throw new TemplateLinkError('invalid_template', 'not a valid template descriptor', issues);
}

/** `template` as a versioned link payload (`v1.<base64url>`); throws `too_large` past the hard limit. */
export async function encodeTemplatePayload(template: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(template));
  const payload = `${PREFIX}${toBase64Url(await deflateRaw(json))}`;

  if (payload.length > TEMPLATE_LINK_LIMITS.maxPayloadLength) {
    const size = `${String(Math.ceil(payload.length / 1024))} KiB`;

    throw new TemplateLinkError('too_large', `the template is too large for a link (${size}); ${TOO_LARGE_HINT}`);
  }

  return payload;
}

function checkEnvelope(payload: string): string {
  if (payload.trim() === '') throw new TemplateLinkError('empty', 'the link carries no template');

  if (payload.length > TEMPLATE_LINK_LIMITS.maxPayloadLength) {
    throw new TemplateLinkError('too_large', `the link is too large to open; ${TOO_LARGE_HINT}`);
  }

  const version = VERSIONED.exec(payload)?.[1];

  if (version !== TEMPLATE_LINK_VERSION) {
    throw new TemplateLinkError('unsupported_version', `unsupported link version "${version ?? payload.slice(0, 8)}"`);
  }

  return payload.slice(PREFIX.length);
}

function bytesOf(body: string): Uint8Array {
  try {
    return fromBase64Url(body);
  } catch {
    throw new TemplateLinkError('malformed', 'the link is malformed (was it cut off when copied?)');
  }
}

async function inflate(bytes: Uint8Array): Promise<string> {
  try {
    const json = await inflateRaw(bytes, TEMPLATE_LINK_LIMITS.maxJsonBytes);

    return new TextDecoder('utf-8', { fatal: true }).decode(json);
  } catch (error) {
    const budget = error instanceof Error && error.message.includes('budget');

    if (budget) throw new TemplateLinkError('too_large', `the template in the link is too large; ${TOO_LARGE_HINT}`);

    throw new TemplateLinkError('corrupt', 'the link is damaged and cannot be read (was it cut off when copied?)');
  }
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new TemplateLinkError('invalid_json', 'the link does not contain template JSON');
  }
}

/** The template a payload carries, validated against the descriptor schema; throws a TemplateLinkError. */
export async function decodeTemplatePayload(payload: string): Promise<unknown> {
  const template = parse(await inflate(bytesOf(checkEnvelope(payload))));
  assertTemplate(template);

  return template;
}

/** The payload in a location hash (`#t=…`, alone or among other `&`-separated params), else null. */
export function readTemplateLinkPayload(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  return params.get(TEMPLATE_LINK_PARAM);
}

/** The builder URL for `payload` under `baseUrl` (origin, optionally with a locale prefix such as /fr). */
export function builderLinkUrl(payload: string, baseUrl: string = DEFAULT_BUILDER_BASE_URL): string {
  let base: URL;

  try {
    base = new URL(baseUrl);
  } catch {
    throw new TemplateLinkError('invalid_base_url', `base URL "${baseUrl}" is not a URL`);
  }

  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new TemplateLinkError('invalid_base_url', `base URL must be http(s), got "${base.protocol}"`);
  }

  const path = base.pathname.replace(/\/+$/, '');

  return `${base.origin}${path}${BUILDER_PATH}#${TEMPLATE_LINK_PARAM}=${payload}`;
}

export interface BuilderLink {
  url: string;
  /** Characters in `url`. */
  length: number;
  mediaToRebind: MediaToRebind[];
  warnings: string[];
}

function linkWarnings(template: unknown, url: string, media: MediaToRebind[]): string[] {
  const warnings: string[] = [];
  const sections = (template as { sections?: Array<{ type?: unknown }> }).sections ?? [];

  if (url.length > TEMPLATE_LINK_LIMITS.warnLength) {
    warnings.push(
      `the link is ${String(url.length)} characters long: browsers open it, but chat apps, terminals and mail ` +
        'clients may truncate it, so paste it straight into the address bar'
    );
  }

  const origin = new URL(url).origin;

  if (origin !== DEFAULT_ORIGIN) {
    warnings.push(
      `the link opens on ${origin}, not ${DEFAULT_ORIGIN}: the page served there can read the template in the ` +
        'fragment, so share it only if you trust that origin'
    );
  }

  const unreadable = media.filter((entry) => entry.reason !== 'unsupported_scheme');
  const unsupported = media.filter((entry) => entry.reason === 'unsupported_scheme');

  if (unreadable.length > 0) {
    const names = unreadable.map((entry) => entry.value.split(/[\\/]/).pop() ?? entry.value);
    warnings.push(`media only this machine can read will open as empty slots to fill again: ${names.join(', ')}`);
  }

  if (unsupported.length > 0) {
    const values = unsupported.map((entry) => entry.value);
    warnings.push(`media under a URL scheme the builder does not load will be dropped: ${values.join(', ')}`);
  }

  if (sections.some((section) => section.type === 'effect')) {
    warnings.push('effect sections cannot be edited in the builder yet; the builder will refuse this template');
  }

  return warnings;
}

/** A builder link for a valid `template`, with the media to re-bind and anything worth telling the author. */
export async function createBuilderLink(template: unknown, options: { baseUrl?: string } = {}): Promise<BuilderLink> {
  assertTemplate(template);

  const url = builderLinkUrl(await encodeTemplatePayload(template), options.baseUrl);
  const media = mediaToRebind(template);

  return { url, length: url.length, mediaToRebind: media, warnings: linkWarnings(template, url, media) };
}
