// The program monitor for a music scene. A music scene puts nothing on screen (the render lays the
// track under every scene), so instead of a decorative frame the monitor shows what the render will
// use: the default track with its own preview transport, and the tracks viewers can switch to.
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { findMusic, type MediaCredit } from '@/data/mediaCatalog';
import type { EditorSection } from '../templateEditorModel';
import { musicSectionTrack } from './sectionFallback';
import { PreviewGlyph, TrackArt } from '../editor/music-track-list';
import {
  formatTrackTime,
  playheadRatio,
  togglePreview,
  trackDuration,
  useMusicPreview,
  type PreviewState,
} from '../editor/music-preview';
import { alternativesSummary } from '../editor/music-track-list.logic';

type MusicSection = Extract<EditorSection, { kind: 'music' }>;

function useAlternativesLine(section: MusicSection): string {
  const { t, i18n } = useTranslation('admin');
  const titles = section.allowed
    .slice(1)
    .map((id) => findMusic(id)?.title)
    .filter((title): title is string => Boolean(title));
  const { shown, more } = alternativesSummary(titles);
  const upload = section.allowUpload ? ` ${t('monitor.musicUploadToo')}` : '';

  if (shown.length === 0) return `${t('monitor.musicOnlyTrack')}${upload}`;

  if (more > 0) return `${t('monitor.musicAlternativesMore', { list: shown.join(', '), count: more })}${upload}`;

  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(shown);

  return `${t('monitor.musicAlternatives', { list })}${upload}`;
}

export function MusicStagePreview({ section }: { section: MusicSection }) {
  const { t } = useTranslation('admin');
  const preview = useMusicPreview();
  const track = musicSectionTrack(section);
  const alternatives = useAlternativesLine(section);

  if (!track) return null;

  const standIn = section.allowed.length === 0;

  return (
    <div className="grid h-full place-items-center overflow-auto p-4 sm:p-6">
      <section
        aria-label={t('monitor.musicRegion')}
        className="w-full max-w-lg rounded-xl border border-divider bg-surface shadow-[var(--shadow-md)]"
      >
        <StageTrackHeader track={track} standIn={standIn} />
        <StageTransport track={track} preview={preview.trackId === track.id ? preview : null} />
        <div className="space-y-1 border-t border-divider px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
          <p>{standIn ? t('monitor.musicStandInNote') : alternatives}</p>
          <p>{t('monitor.musicAudioOnly')}</p>
        </div>
      </section>
    </div>
  );
}

function StageTrackHeader({ track, standIn }: { track: MediaCredit; standIn: boolean }) {
  const { t } = useTranslation('admin');

  return (
    <div className="flex items-start gap-4 p-4 sm:gap-5 sm:p-5">
      <TrackArt
        item={track}
        className="size-20 shrink-0 rounded-lg shadow-[0_0_0_1px_var(--color-divider)] sm:size-28"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="break-words font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">
          {track.title}
        </h3>
        <p className="mt-1 break-words text-sm text-muted-foreground">{track.author}</p>
        <span
          title={standIn ? undefined : t('musicSection.defaultTooltip')}
          className={cn(
            'mt-2.5 inline-block rounded-[0.3125rem] px-1.5 py-0.5 text-[0.6875rem] font-medium',
            standIn ? 'bg-foreground/10 text-muted-foreground' : 'bg-brand-500/20 text-brand-200'
          )}
        >
          {t(standIn ? 'monitor.musicStandIn' : 'musicSection.default')}
        </span>
      </div>
    </div>
  );
}

// The default track's own transport: play/stop, a playhead and the elapsed / total time.
function StageTransport({ track, preview }: { track: MediaCredit; preview: PreviewState | null }) {
  const { t } = useTranslation('admin');
  const status = preview?.status ?? 'idle';
  const sounding = status === 'playing' || status === 'loading';
  const duration = trackDuration(preview, track.durationSec);

  return (
    <>
      <div className="flex items-center gap-3 px-4 pb-4 sm:px-5">
        <button
          type="button"
          onClick={() => {
            togglePreview(track);
          }}
          aria-pressed={sounding}
          aria-label={t(sounding ? 'musicSection.stopPreview' : 'musicSection.preview', { title: track.title })}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-colors duration-150 hover:bg-brand-500"
        >
          <PreviewGlyph status={status} />
        </button>
        <span aria-hidden="true" className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <span
            className="block h-full origin-left bg-brand-400"
            style={{ transform: `scaleX(${playheadRatio(preview, duration)})` }}
          />
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatTrackTime(preview?.currentTime ?? 0)} / {formatTrackTime(duration)}
        </span>
      </div>
      {status === 'error' ? (
        <p role="alert" className="px-4 pb-3 text-xs text-[var(--color-error)] sm:px-5">
          {t('musicSection.previewError')}
        </p>
      ) : null}
    </>
  );
}
