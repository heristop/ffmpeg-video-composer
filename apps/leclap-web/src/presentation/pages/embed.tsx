import { useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { SITE_URL } from '@/config/site';
import { cn } from '@/lib/utils';
import { Seo } from '@/presentation/components/Seo';
import { VideoPlayer } from '@/presentation/components/player/video-player';
import { embedMedia, type EmbedMedia } from '@/presentation/components/player/embed-media';
import { embedPath, parseEmbed, type EmbedRef } from '@/presentation/components/player/embed.logic';

const FILM_TITLE_KEYS = { showcase: 'film.name', agentic: 'agentic.filmName' } as const;

// Where "Watch on LeClap" leads: the sample in the showcase, or the landing for a film and the reel.
const watchUrl = (ref: EmbedRef): string => {
  if (ref.kind === 'sample') return `${SITE_URL}/showcase?sample=${encodeURIComponent(ref.id)}`;

  if (ref.kind === 'film') return `${SITE_URL}/#film`;

  return `${SITE_URL}/#showcase`;
};

/**
 * A LeClap video embedded on another site (/embed/<kind>/<id>, embed.logic.ts): the player alone, filling the iframe
 * on the player's ink, with no header, footer or app shell. Nothing plays, and nothing makes a sound, until the
 * visitor presses play; the keyboard works without focusing the frame first. A link in the corner leads back to the
 * video on LeClap. The route is the one page the site lets other origins frame (public/_headers).
 */
export const EmbedPage = () => {
  const { kind, id } = useParams();
  const { search } = useLocation();
  const { t } = useTranslation('player');
  const { t: home } = useTranslation('home');
  const ref = parseEmbed(kind, id, search);
  const media: EmbedMedia | null = ref ? embedMedia(ref) : null;
  const title = (() => {
    if (!ref || !media) return t('notFound');

    if (ref.kind === 'sample') return media.sample?.title ?? t('player');

    if (ref.kind === 'film') return home(FILM_TITLE_KEYS[ref.id]);

    return home('showcase.videoAria');
  })();

  if (!ref || !media) {
    return (
      <main className="dark fixed inset-0 grid place-items-center bg-player-ink p-6 text-center text-player-fg">
        <Seo title={title} noindex />
        <p className="text-sm font-medium text-player-fg/80">{t('notFound')}</p>
      </main>
    );
  }

  return (
    <main className="dark fixed inset-0 bg-player-ink" data-embed={embedPath(ref)}>
      <Seo title={title} noindex />
      <VideoPlayer
        sources={media.sources}
        poster={media.poster}
        title={title}
        captions={media.captions && { ...media.captions, label: home('film.captions') }}
        embed={{ ref, title, shape: media.shape }}
        pageKeys
        className="h-full w-full"
        // Showcase previews are letterboxed into 16:9: a portrait or square sample crops its bars back off, as on
        // the site's own frame, in an iframe the snippet sizes to the sample's shape.
        videoClassName={cn('h-full w-full', media.shape !== 'landscape' && 'object-cover')}
        corner={
          <a
            href={watchUrl(ref)}
            target="_blank"
            rel="noopener"
            className="tap inline-flex min-h-11 items-center gap-1.5 rounded-full bg-player-ink/60 px-3.5 text-xs font-semibold text-player-fg/90 ring-1 ring-player-fg/15 backdrop-blur-sm transition-[transform,background-color,color] duration-150 hover:bg-player-ink/80 hover:text-player-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 [&_svg]:size-3.5"
          >
            {t('watchOn')}
            <ExternalLink aria-hidden="true" />
          </a>
        }
      />
    </main>
  );
};
