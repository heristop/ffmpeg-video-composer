// Embedding a LeClap video on another site: the chromeless route that plays it (/embed/<kind>/<id>), the <iframe>
// snippet that points there, and whether a video can be embedded at all. Only videos the site itself serves have
// a public address: the showcase samples, the two landing films and the effects reel. A render made in the studio
// lives in this browser alone (a blob: URL over IndexedDB), so it never offers an embed.

export type EmbedShape = 'landscape' | 'portrait' | 'square';

const FILM_IDS = ['showcase', 'agentic'] as const;
const FILM_LANGS = ['en', 'fr'] as const;
const REEL_IDS = ['effects'] as const;

export type EmbedFilmId = (typeof FILM_IDS)[number];
export type EmbedFilmLang = (typeof FILM_LANGS)[number];

export type EmbedRef =
  | { kind: 'sample'; id: string }
  | { kind: 'film'; id: EmbedFilmId; lang: EmbedFilmLang }
  | { kind: 'reel'; id: (typeof REEL_IDS)[number] };

/** The embed route's path for a video, e.g. "/embed/sample/effects-tour" or "/embed/film/agentic?lang=fr". */
export function embedPath(ref: EmbedRef): string {
  const base = `/embed/${ref.kind}/${encodeURIComponent(ref.id)}`;

  if (ref.kind === 'film') return `${base}?lang=${ref.lang}`;

  return base;
}

const oneOf = <T extends string>(values: readonly T[], value: string | null | undefined): T | undefined =>
  values.find((candidate) => candidate === value);

/** The video an embed route names, or null for one it cannot play. A sample id is checked against the catalog later. */
export function parseEmbed(kind: string | undefined, id: string | undefined, search: string): EmbedRef | null {
  if (!id) return null;

  if (kind === 'sample') return { kind, id };

  if (kind === 'film') {
    const film = oneOf(FILM_IDS, id);
    const lang = oneOf(FILM_LANGS, new URLSearchParams(search).get('lang')) ?? 'en';

    return film ? { kind, id: film, lang } : null;
  }

  if (kind === 'reel') {
    const reel = oneOf(REEL_IDS, id);

    return reel ? { kind, id: reel } : null;
  }

  return null;
}

const FRAME: Record<EmbedShape, { width: number; height: number; ratio: string }> = {
  landscape: { width: 640, height: 360, ratio: '16/9' },
  portrait: { width: 360, height: 640, ratio: '9/16' },
  square: { width: 480, height: 480, ratio: '1/1' },
};

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * The snippet a visitor pastes into their page: a borderless iframe that keeps the video's shape at any width, may go
 * fullscreen, and loads lazily. `autoplay` is allowed so a press inside the frame can start the sound right away.
 */
export function embedSnippet({
  origin,
  ref,
  title,
  shape,
}: {
  origin: string;
  ref: EmbedRef;
  title: string;
  shape: EmbedShape;
}): string {
  const frame = FRAME[shape];

  return (
    `<iframe src="${origin}${embedPath(ref)}" title="${escapeAttribute(title)}" ` +
    `width="${frame.width}" height="${frame.height}" ` +
    `style="width:100%;height:auto;aspect-ratio:${frame.ratio};border:0" ` +
    'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>'
  );
}

const LOCAL_SCHEMES = ['blob:', 'data:', 'filesystem:'];

/** Whether to offer "Embed": only for a video with an embed address that the site serves publicly. */
export function embedAvailable(src: string | undefined, ref: EmbedRef | undefined): boolean {
  if (!ref || !src) return false;

  return !LOCAL_SCHEMES.some((scheme) => src.startsWith(scheme));
}
