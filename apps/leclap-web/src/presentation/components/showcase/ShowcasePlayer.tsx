import { useTranslation } from 'react-i18next';
import { FilmPlayer } from '@/presentation/components/home/film-player';
import { useTemplateScenes } from '@/presentation/components/player/use-template-scenes';
import { SHAPE_ASPECT, mediaPath, sampleDuration, sampleShape, type ShowcaseSample } from './catalog';

export function ShowcasePlayer({
  sample,
  requested,
  suspended = false,
  still = false,
}: {
  sample: ShowcaseSample;
  requested: boolean;
  /** Paused while set aside: under the sample dialog, or as that dialog closes. */
  suspended?: boolean;
  /** Inside the dialog: no scroll reveal. */
  still?: boolean;
}) {
  const { t } = useTranslation('showcase');
  const { t: home } = useTranslation('home');
  const shape = sampleShape(sample);
  const scenes = useTemplateScenes(mediaPath(sample, 'json'));

  return (
    <FilmPlayer
      className="showcase-player max-w-none"
      film={{ mp4: mediaPath(sample, 'mp4'), poster: mediaPath(sample, 'webp') }}
      title={t('previewOf', { title: sample.title })}
      playback="requested"
      startRequested={requested}
      shape={shape}
      still={still}
      suspended={suspended}
      cardTitle={sample.title}
      cardMeta={{ shape: SHAPE_ASPECT[shape], duration: sampleDuration(sample) }}
      scenes={scenes}
      labels={{
        play: t('playSample', { title: sample.title }),
        pause: home('film.pause'),
        loading: t('loading'),
        error: t('videoError'),
        retry: t('retry'),
      }}
    />
  );
}
