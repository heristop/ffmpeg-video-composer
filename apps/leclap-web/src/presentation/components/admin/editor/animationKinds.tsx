// The two things the builder calls "animation", kept visually apart everywhere they appear (the add menu,
// the picker, the element list, the inspector):
//   - an EFFECT is drawn by the engine, tuned to the scene and adjustable (a section `graphics` entry);
//     lavender, a sparkles glyph, the badge "Engine · adjustable";
//   - an ANIMATION FILE is a clip played as-is on top of the scene (APNG / WebM / GIF / WebP, a section
//     `animations` entry); rose, a film glyph, the badge "File · APNG".
// One vocabulary module so every surface uses the same glyph, tone and words for each kind.
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Sparkles } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { SampleThumb } from './AnimationMedia';
import { animationFileName, animationFormat } from './animationOverlay';

export type AnimationFamily = 'effect' | 'file';

export const FAMILY_ICON: Record<AnimationFamily, ComponentType<{ className?: string }>> = {
  effect: Sparkles,
  file: Film,
};

// The tinted icon tile and the chip of each kind: brand lavender for effects, secondary rose for files.
export const FAMILY_TONE: Record<AnimationFamily, { tile: string; chip: string; text: string }> = {
  effect: {
    tile: 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
    chip: 'bg-brand-500/12 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-200',
    text: 'text-brand-600 dark:text-brand-300',
  },
  file: {
    tile: 'bg-secondary-500/15 text-secondary-600 dark:text-secondary-300',
    chip: 'bg-secondary-500/12 text-secondary-700 ring-1 ring-inset ring-secondary-500/25 dark:text-secondary-200',
    text: 'text-secondary-600 dark:text-secondary-300',
  },
};

/** The i18n key of a kind's singular name ("Effect" / "Animation file"). */
export const familyNameKey = (family: AnimationFamily): string => `animation.kind.${family}.name`;

export const FamilyTile = ({ family, className }: { family: AnimationFamily; className?: string }) => {
  const Icon = FAMILY_ICON[family];

  return (
    <span
      aria-hidden
      className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', FAMILY_TONE[family].tile, className)}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
};

// "Engine · adjustable" for an effect, "File · APNG" for a file (just "File" when the format is unknown).
export const FamilyBadge = ({
  family,
  format,
  className,
}: {
  family: AnimationFamily;
  format?: string;
  className?: string;
}) => {
  const { t } = useTranslation('admin');
  const text = family === 'file' && format ? `${t('animation.kind.file.badge')} · ${format}` : null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-1.5 py-px text-[0.6rem] font-semibold tracking-wide',
        FAMILY_TONE[family].chip,
        className
      )}
    >
      {text ?? t(`animation.kind.${family}.badge`)}
    </span>
  );
};

// The kind eyebrow above an element's name in the inspector: "✦ Effect · Engine · adjustable" or
// "🎞 Animation file · APNG" ("· played as-is" when the format is unknown), glyph and name in the kind's tone.
export const KindLine = ({ family, format }: { family: AnimationFamily; format?: string }) => {
  const { t } = useTranslation('admin');
  const Icon = FAMILY_ICON[family];
  const detail = family === 'file' ? (format ?? t('animation.kind.file.detail')) : t('animation.kind.effect.badge');

  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-widest">
      <Icon className={cn('h-3 w-3 shrink-0', FAMILY_TONE[family].text)} aria-hidden />
      <span className={cn('shrink-0', FAMILY_TONE[family].text)}>{t(familyNameKey(family))}</span>
      <span className="truncate text-gray-400">· {detail}</span>
    </p>
  );
};

// The inspector header of an animation-file element, the counterpart of the effect panel's header: the file
// playing on the neutral stage, its name, and the "Animation file · APNG" kind line.
export const FileElementHeader = ({ url, label }: { url: string; label?: string }) => (
  <div className="space-y-2">
    <KindLine family="file" format={animationFormat(url)} />
    <div className="flex items-center gap-2.5">
      <SampleThumb
        url={url}
        className="h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-secondary-500/25"
      />
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {animationFileName({ url, label }) ?? label}
      </p>
    </div>
  </div>
);

// The header that opens each side of the picker: the kind's tile, title, badge and one-line subtitle.
// Under the "Effects | Animation files" switch the title would repeat the switch, so `titled={false}` keeps
// just the badge and the subtitle on one compact line.
export const FamilyHeader = ({
  family,
  format,
  titled = true,
}: {
  family: AnimationFamily;
  format?: string;
  titled?: boolean;
}) => {
  const { t } = useTranslation('admin');

  if (!titled) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.7rem] leading-snug text-gray-500 dark:text-gray-400">
        <FamilyBadge family={family} format={format} />
        {t(`animation.kind.${family}.subtitle`)}
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <FamilyTile family={family} className="mt-0.5 h-7 w-7 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold text-foreground">{t(`animation.kind.${family}.title`)}</h3>
          <FamilyBadge family={family} format={format} />
        </div>
        <p className="mt-0.5 text-[0.7rem] leading-snug text-gray-500 dark:text-gray-400">
          {t(`animation.kind.${family}.subtitle`)}
        </p>
      </div>
    </div>
  );
};
