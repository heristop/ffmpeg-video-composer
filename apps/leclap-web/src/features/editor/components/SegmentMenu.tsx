import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Trash2 } from '@/presentation/components/icons';
import { GaugeIcon } from '@/presentation/components/icons/gauge';
import { cn } from '@/lib/utils';
import type { ClipSegment } from '@/domain/valueObjects/videoEdits';
import { SPEED_PRESETS } from '@/features/editor/timelineSegments';

interface SegmentMenuProps {
  x: number;
  y: number;
  segment: ClipSegment;
  canDelete: boolean;
  onSetSpeed: (speed: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

// A right-click / kebab menu anchored to a segment: speed presets, split at this point, and delete.
// Renders fixed at the pointer; an invisible backdrop closes it, as does Escape. Focus moves onto the
// current speed when it opens and goes back to whatever opened it when it closes, so a keyboard user
// lands in the menu and returns to the block they were on.
export function SegmentMenu({ x, y, segment, canDelete, onSetSpeed, onSplit, onDelete, onClose }: SegmentMenuProps) {
  const { t } = useTranslation('builder');
  const currentSpeedRef = useRef<HTMLButtonElement>(null);
  // The timeline re-renders under an open menu (the playhead moves), handing a fresh onClose each
  // time; reading it through a ref keeps the focus hand-off below to one mount and one unmount.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    currentSpeedRef.current?.focus();
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  // Keep the menu fully on-screen (≈ w-44 + padding ≈ 188px wide, ≈ 170px tall).
  const left = Math.max(8, Math.min(x, window.innerWidth - 196));
  const top = Math.max(8, Math.min(y, window.innerHeight - 176));

  return (
    <div
      className="fixed inset-0 z-50"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <div
        role="menu"
        aria-label={t('edit.segmentOptions')}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        style={{ left, top }}
        className="absolute w-44 overflow-hidden rounded-xl border border-foreground/10 bg-surface p-1 shadow-2xl shadow-black/40 fade-in"
      >
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-gray-400">
          <GaugeIcon size={14} />
          {t('edit.speed')}
        </div>
        <div className="grid grid-cols-5 gap-0.5 px-1 pb-1.5">
          {SPEED_PRESETS.map((preset) => (
            <button
              key={preset}
              ref={segment.speed === preset ? currentSpeedRef : undefined}
              type="button"
              role="menuitemradio"
              aria-checked={segment.speed === preset}
              onClick={() => {
                onSetSpeed(preset);
                onClose();
              }}
              className={cn(
                'tap rounded-md py-1 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
                segment.speed === preset ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-300 hover:bg-foreground/10'
              )}
            >
              {preset}×
            </button>
          ))}
        </div>

        <div className="my-1 h-px bg-foreground/10" />

        <MenuRow onClick={onSplit}>
          <Scissors className="h-4 w-4" />
          {t('edit.splitHere')}
        </MenuRow>
        <MenuRow onClick={onDelete} disabled={!canDelete} danger>
          <Trash2 className="h-4 w-4" />
          {t('edit.deleteSegment')}
        </MenuRow>
      </div>
    </div>
  );
}

function MenuRow({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'tap flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 [&_svg]:size-4',
        disabled && 'cursor-not-allowed opacity-40',
        danger
          ? 'text-gray-200 hover:bg-[var(--color-error)]/15 hover:text-[var(--color-error)]'
          : 'text-gray-200 hover:bg-foreground/10'
      )}
    >
      {children}
    </button>
  );
}

export default SegmentMenu;
