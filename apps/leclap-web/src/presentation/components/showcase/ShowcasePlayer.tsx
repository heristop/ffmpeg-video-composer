import { useTranslation } from 'react-i18next';
import { FilmPlayer } from '@/presentation/components/home/film-player';
import { mediaPath, type ShowcaseSample } from './catalog';

export function ShowcasePlayer({ sample, requested }: { sample: ShowcaseSample; requested: boolean }) {
  const { t } = useTranslation('showcase');
  const { t: home } = useTranslation('home');

  return (
    <FilmPlayer
      className="showcase-player max-w-none"
      film={{ mp4: mediaPath(sample, 'mp4'), poster: mediaPath(sample, 'webp') }}
      title={t('previewOf', { title: sample.title })}
      playback="requested"
      startRequested={requested}
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
