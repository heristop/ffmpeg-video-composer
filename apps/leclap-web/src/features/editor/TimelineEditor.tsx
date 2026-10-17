import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Crop, Scissors, RotateCcw, Trash2, Undo2, Redo2 } from '@/presentation/components/icons';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/presentation/components/ui';
import { GradientMeter, ratio01 } from '@/presentation/components/kinetic';
import { type VideoEdit } from '@/domain/valueObjects/videoEdits';
import { CropFrame } from '@/features/editor/components/CropFrame';
import { Timeline } from '@/features/editor/components/Timeline';
import { useTimelineEditor } from '@/features/editor/useTimelineEditor';
import { isTextEditingTarget } from '@/features/editor/editor-keys';

interface TimelineEditorProps {
  file: File;
  // Names the editor region for assistive tech; the monitor's view switch already shows it on screen.
  label: string;
  edit: VideoEdit | undefined;
  onChange: (edit: VideoEdit | undefined) => void;
}

const fmtClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));

  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
};

// The shortcut as the platform spells it, for the undo/redo tooltips.
const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);

// ⌘Z / ⌘⇧Z (Ctrl on other platforms) drive the cut history — except while a text field has focus,
// where the keystroke belongs to the field's own undo.
const useUndoShortcuts = (undo: () => void, redo: () => void) => {
  useEffect(() => {
    const handleKey = (ev: KeyboardEvent) => {
      const modKey = ev.metaKey || ev.ctrlKey;

      if (!modKey || ev.key.toLowerCase() !== 'z') return;

      if (isTextEditingTarget(ev.target as HTMLElement | null)) return;

      ev.preventDefault();

      if (ev.shiftKey) {
        redo();

        return;
      }

      undo();
    };

    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [undo, redo]);
};

// The trim/split/speed/crop editor, hosted in the program monitor's place. It fills the area it is
// given: the video takes whatever height the controls leave, so the timeline — the thing being edited
// — stays on screen instead of below a fixed-height player.
export function TimelineEditor({ file, label, edit, onChange }: TimelineEditorProps) {
  const { t } = useTranslation('builder');
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const e = useTimelineEditor({ file, edit, onChange, videoRef, containerRef });
  const canDelete = e.segments.length > 1;
  const { ref: playRef, hoverProps: playHoverProps } = useIconHover();
  const { ref: pauseRef, hoverProps: pauseHoverProps } = useIconHover();
  const mod = isMac() ? '⌘' : 'Ctrl+';

  useUndoShortcuts(e.undo, e.redo);

  return (
    <section aria-label={label} className="flex min-h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <ModeButton
            active={e.mode === 'timeline'}
            dot={e.timelineActive}
            onClick={() => {
              e.switchMode('timeline');
            }}
          >
            <Scissors className="h-4 w-4" />
            {t('edit.trim')}
          </ModeButton>
          <ModeButton
            active={e.mode === 'crop'}
            dot={e.cropActive}
            onClick={() => {
              e.switchMode('crop');
            }}
          >
            <Crop className="h-4 w-4" />
            {t('edit.crop')}
          </ModeButton>
        </div>
        {e.mode === 'timeline' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={e.undo}
              disabled={!e.canUndo}
              aria-label={t('edit.undo')}
              aria-keyshortcuts="Meta+Z Control+Z"
              title={`${t('edit.undo')} (${mod}Z)`}
              className="text-gray-400 hover:text-foreground [&_svg]:size-4"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={e.redo}
              disabled={!e.canRedo}
              aria-label={t('edit.redo')}
              aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
              title={`${t('edit.redo')} (${mod}⇧Z)`}
              className="text-gray-400 hover:text-foreground [&_svg]:size-4"
            >
              <Redo2 />
            </Button>
          </div>
        )}
      </div>

      <div ref={containerRef} className="relative min-h-40 flex-1 overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          src={e.url || undefined}
          aria-label={t('edit.videoAriaLabel')}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          onLoadedMetadata={e.onLoadedMetadata}
          onTimeUpdate={e.onTimeUpdate}
        />
        {e.mode === 'crop' && e.containerSize.width > 0 && (
          <CropFrame videoRect={e.videoRect} crop={e.crop} onChange={e.handleCropChange} />
        )}
      </div>

      {e.mode === 'timeline' ? (
        <div className="shrink-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                onClick={e.togglePlay}
                aria-label={e.playing ? t('edit.pause') : t('edit.play')}
                className="rounded-full [&_svg]:size-4"
                {...(e.playing ? pauseHoverProps : playHoverProps)}
              >
                {e.playing ? (
                  <PauseIcon ref={pauseRef} size={16} />
                ) : (
                  <PlayIcon ref={playRef} size={16} className="translate-x-px" />
                )}
              </Button>
              <span className="text-sm tabular-nums text-gray-300">
                {fmtClock(e.outputPosition)} <span className="text-gray-500">/ {fmtClock(e.outputDuration)}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={e.split} className="gap-1.5 [&_svg]:size-4">
                <Scissors />
                {t('edit.split')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (e.selectedId) e.remove(e.selectedId);
                }}
                disabled={!canDelete}
                aria-label={t('edit.deleteSegment')}
                title={t('edit.deleteSegment')}
                className="text-gray-400 hover:text-[var(--color-error)] [&_svg]:size-4"
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          {/* Playback readout as the shared gradient scrubber — the kinetic playhead vocabulary sitting
              above the source track, reading how far through the trimmed output the deck has played. */}
          <GradientMeter progress={ratio01(e.outputPosition, e.outputDuration)} variant="playhead" size={5} />

          <Timeline
            segments={e.segments}
            selectedId={e.selectedId}
            duration={e.duration}
            sourceTime={e.sourceTime}
            onSelect={e.setSelectedId}
            onSeekSource={e.seekSource}
            onTrimStart={e.beginTrim}
            onTrim={e.trim}
            onSetSpeed={e.setSpeed}
            onSplitAt={e.splitAtSource}
            onDelete={e.remove}
          />

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-xs text-gray-500">{t('edit.trimHint')}</p>
            {e.timelineActive && (
              <div className="flex items-center gap-3">
                <Button
                  variant="link"
                  size="sm"
                  onClick={e.inverse}
                  className="gap-1.5 px-0 font-medium text-gray-400 no-underline hover:text-foreground hover:no-underline [&_svg]:size-3.5"
                >
                  <ArrowRightLeft />
                  {t('edit.invert')}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  onClick={e.resetTimeline}
                  className="gap-1.5 px-0 font-medium text-gray-400 no-underline hover:text-foreground hover:no-underline [&_svg]:size-3.5"
                >
                  <RotateCcw />
                  {t('edit.resetTrim')}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-gray-400">{t('edit.cropHint')}</p>
          <Button
            variant="link"
            size="sm"
            onClick={e.resetCrop}
            className="gap-1.5 px-0 font-medium text-gray-400 no-underline hover:text-foreground hover:no-underline [&_svg]:size-3.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('edit.resetCrop')}
          </Button>
        </div>
      )}
    </section>
  );
}

function ModeButton({
  active,
  dot,
  onClick,
  children,
}: {
  active: boolean;
  dot: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'tap relative inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
        active
          ? 'border-brand-400/50 bg-linear-to-r from-brand-500/25 to-secondary-500/20 text-brand-700 shadow-md shadow-brand-500/25 dark:text-brand-100'
          : 'border-transparent text-gray-400 hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      {children}
      {/* A standing mark, not a pulse: an edit being applied is a state, and a loop beside the label
          read as something still working. */}
      {dot && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand-400 shadow shadow-brand-500/50"
        />
      )}
    </button>
  );
}

export default TimelineEditor;
