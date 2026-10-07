// The two animation libraries, never mixed in one grid:
//   - EffectLibraryPicker: the engine primitives, grouped (Light, Focus, Celebrate, Frames, Ambient), with the
//     two-part recipes ("Combinations") on top. A card is an action: it inserts that primitive into the
//     section, tuned to it, and opens its parameter panel (the host does the insert). Each card carries the
//     engine thumbnail and a small "adjustable" glyph.
//   - SampleLibraryPicker: the stock animation files (the legacy APNGs, or a config-curated list), each playing
//     the real file on the neutral stage with its format chip. A card selects that file like before.
import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, SlidersHorizontal } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { ANIMATION_PICKER, type PickerCard, type PickerGroup } from '@/data/mediaCatalog';
import { ANIMATION_EFFECT_PRESETS, type AnimationEffectPreset, type EngineLibraryEntry } from '../templateEditorModel';
import { AnimationThumb, SampleThumb } from './AnimationMedia';
import { animationFormat } from './animationOverlay';
import { FAMILY_TONE } from './animationKinds';
import { CANVAS_DND_MIME, type DropPayload } from '../editor-shell/canvasDrop';

const startCanvasDrag = (event: DragEvent, payload: DropPayload) => {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(CANVAS_DND_MIME, JSON.stringify(payload));
};

const GROUP_LABEL_CLS = 'text-[0.65rem] font-semibold uppercase tracking-widest text-gray-400';

const THUMB_CLASS = 'aspect-video w-full overflow-hidden transition-transform duration-300 group-hover:scale-[1.03]';

const CARD_CLASS =
  'group relative block overflow-hidden rounded-xl border bg-surface text-left transition-all focus-visible:outline-none focus-visible:ring-2';

export interface EffectLibraryPickerProps {
  /** Inserts an engine primitive. */
  onPickEngine: (entry: EngineLibraryEntry) => void;
  /** Inserts a two-part recipe. */
  onPickRecipe?: (preset: AnimationEffectPreset) => void;
}

export const EffectLibraryPicker = ({ onPickEngine, onPickRecipe }: EffectLibraryPickerProps) => {
  const groups = ANIMATION_PICKER.filter((group) => group.group !== 'samples');

  return (
    <div className="space-y-4">
      {onPickRecipe ? <RecipeRow onPick={onPickRecipe} /> : null}
      {groups.map((group) => (
        <PickerSection key={group.group} group={group}>
          {group.cards.map((card) => (
            <EffectCard key={card.key} card={card} onPick={onPickEngine} />
          ))}
        </PickerSection>
      ))}
    </div>
  );
};

export interface SampleLibraryPickerProps {
  /** The url of the file currently chosen (marks its card). */
  selectedUrl?: string;
  onPickSample: (card: PickerCard) => void;
  /** Override the sample list (config-driven curated libraries). */
  samples?: PickerCard[];
}

export const SampleLibraryPicker = ({ selectedUrl, onPickSample, samples }: SampleLibraryPickerProps) => {
  const { t } = useTranslation('admin');
  const group = ANIMATION_PICKER.find((entry) => entry.group === 'samples');
  const cards = samples ?? group?.cards ?? [];

  return (
    <PickerSection group={{ group: 'samples', cards }}>
      <p className="col-span-2 -mt-0.5 text-[0.7rem] leading-snug text-gray-500">{t('animation.groups.samplesHint')}</p>
      {cards.map((card) => (
        <SampleCard
          key={card.key}
          card={card}
          selected={card.sample !== undefined && card.sample.url === selectedUrl}
          onPick={onPickSample}
        />
      ))}
    </PickerSection>
  );
};

const RecipeRow = ({ onPick }: { onPick: (preset: AnimationEffectPreset) => void }) => {
  const { t } = useTranslation('admin');

  return (
    <section aria-label={t('animation.effects.label')} className="space-y-1.5">
      <h4 className={GROUP_LABEL_CLS}>{t('animation.effects.label')}</h4>
      <div className="flex flex-wrap gap-1.5">
        {ANIMATION_EFFECT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={t(preset.descriptionKey)}
            onClick={() => {
              onPick(preset);
            }}
            className="tap rounded-full border border-foreground/10 bg-surface px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-brand-500/50 hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {t(preset.nameKey)}
          </button>
        ))}
      </div>
    </section>
  );
};

const PickerSection = ({ group, children }: { group: PickerGroup; children: ReactNode }) => {
  const { t } = useTranslation('admin');
  const headingId = `animation-group-${group.group}`;

  if (group.cards.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h4 id={headingId} className={GROUP_LABEL_CLS}>
        {t(`animation.groups.${group.group}`)}
      </h4>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
};

const EffectCard = ({ card, onPick }: { card: PickerCard; onPick: (entry: EngineLibraryEntry) => void }) => {
  const { t } = useTranslation('admin');
  const label = t(card.labelKey, { defaultValue: card.fallbackLabel });

  return (
    <button
      type="button"
      aria-label={t('animation.picker.addLabel', { label })}
      onClick={() => {
        if (card.engine) onPick(card.engine);
      }}
      className={cn(CARD_CLASS, 'border-foreground/10 hover:border-brand-500/50 focus-visible:ring-brand-500/40')}
    >
      <AnimationThumb thumb={card.thumb} poster={card.poster} fallback={label} className={THUMB_CLASS} />
      {/* The "adjustable" glyph: an effect opens its parameter panel once added. */}
      <span
        aria-hidden
        title={t('animation.kind.effect.adjustable')}
        className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/45 text-brand-200 ring-1 ring-inset ring-white/15 backdrop-blur-sm"
      >
        <SlidersHorizontal className="h-3 w-3" />
      </span>
      <span className="block truncate px-2 py-1.5 text-[0.7rem] font-semibold text-foreground">{label}</span>
    </button>
  );
};

const SampleCard = ({
  card,
  selected,
  onPick,
}: {
  card: PickerCard;
  selected: boolean;
  onPick: (card: PickerCard) => void;
}) => {
  const { t } = useTranslation('admin');
  const label = t(card.labelKey, { defaultValue: card.fallbackLabel });
  const sample = card.sample;
  const format = sample ? animationFormat(sample.url) : undefined;

  if (!sample) return null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={t('animation.picker.sampleLabel', { label, format: format ?? t('animation.kind.file.badge') })}
      draggable
      onDragStart={(event) => {
        startCanvasDrag(event, { source: 'library', element: 'animation', url: sample.url, label: sample.label });
      }}
      onClick={() => {
        onPick(card);
      }}
      className={cn(
        CARD_CLASS,
        'focus-visible:ring-secondary-500/40',
        selected
          ? 'border-secondary-500 ring-2 ring-secondary-500/30'
          : 'border-foreground/10 hover:border-secondary-500/50'
      )}
    >
      <SampleThumb url={sample.url} className={THUMB_CLASS} />
      <span className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-foreground">{label}</span>
        {format ? (
          <span
            className={cn(
              'shrink-0 rounded px-1 py-px text-[0.55rem] font-semibold uppercase tracking-wider',
              FAMILY_TONE.file.chip
            )}
          >
            {format}
          </span>
        ) : null}
      </span>
      {selected ? (
        <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-secondary-500 p-0.5 text-white" />
      ) : null}
    </button>
  );
};
