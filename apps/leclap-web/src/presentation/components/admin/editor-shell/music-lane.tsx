// The music scene as an audio lane under the clips, the way an editor shows a bed under picture: it
// spans the clips because the render lays the track under all of them. Selecting it opens the music
// panel; Delete removes it like any scene, from inside the strip.
import { useTranslation } from 'react-i18next';
import { Music, Trash2 } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import type { EditorSection } from '../templateEditorModel';
import { programMusicTrack } from './program-music.logic';
import { Waveform } from '../editor/waveform';

interface MusicLaneProps {
  section: Extract<EditorSection, { kind: 'music' }>;
  index: number;
  selected: boolean;
  canDelete: boolean;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
}

export function MusicLane({ section, index, selected, canDelete, onSelect, onDelete }: MusicLaneProps) {
  const { t } = useTranslation('admin');
  const track = programMusicTrack([section]);
  const others = Math.max(0, section.allowed.length - 1);

  return (
    <div className="relative">
      <button
        type="button"
        aria-current={selected}
        onClick={() => {
          onSelect(index);
        }}
        className={cn(
          'relative flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2.5 text-left text-xs transition-colors duration-150',
          selected
            ? 'border-brand-500 bg-brand-500/15 text-foreground'
            : 'border-foreground/10 bg-brand-500/[0.06] text-muted-foreground hover:border-brand-500/40 hover:text-foreground'
        )}
      >
        {track?.peaks ? (
          <Waveform
            peaks={track.peaks}
            progress={0}
            className="pointer-events-none absolute inset-x-2 inset-y-1.5 opacity-35"
          />
        ) : null}
        <Music aria-hidden="true" className="relative size-3.5 shrink-0 text-brand-300" />
        <span className="relative min-w-0 truncate font-medium">{track?.title ?? t('shell.musicLaneEmpty')}</span>
        {others > 0 ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {t('shell.musicLaneMore', { count: others })}
          </span>
        ) : null}
        {section.allowed.length === 0 ? (
          <span className="relative shrink-0 text-muted-foreground">{t('monitor.musicStandIn')}</span>
        ) : null}
      </button>
      {selected ? (
        <button
          type="button"
          aria-label={t('shell.deleteScene')}
          title={t('shell.deleteSceneTooltip')}
          disabled={!canDelete}
          onClick={() => {
            onDelete(index);
          }}
          className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--color-error)] hover:text-white disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
