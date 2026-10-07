// The parameter panel of an engine effect (a section `graphics[]` entry: an fx light or a stroke).
// Every control is generated from the engine schema (fx-params.ts in the creative kit): number ranges
// become sliders, enums segmented controls or selects, theme-token colours a swatch row with a custom
// colour, booleans checkboxes. An unset parameter reads "Auto" (the engine derives it from the target, the
// theme and the seed) and every set one can go back to Auto, so authors tune only what they mean to.
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { resolveTheme } from 'ffmpeg-video-composer/src/core/theme/resolve.ts';
import type { ThemeSpec } from 'ffmpeg-video-composer/src/core/theme/themes.ts';
import { Shuffle, Trash2, X } from '@/presentation/components/icons';
import {
  Button,
  Checkbox,
  ColorPicker,
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { cn } from '@/lib/utils';
import { findEngineCard } from '@/data/mediaCatalog';
import {
  FX_COLOR_TOKENS,
  FX_EASE_OPTIONS,
  fxTargetOptions,
  isTunableGraphic,
  libraryEntryOfGraphic,
  libraryLabelKey,
  ownParamFields,
  sharedParamFields,
  withParam,
  type EditorSection,
  type ParamField,
} from '../templateEditorModel';
import { rangeFill, SegmentedControl } from './controls';
import { EditorSelectContent } from './editor-select-content';
import { SectionDisclosure } from './SectionDisclosure';
import { KindLine } from './animationKinds';
import { AnimationThumb } from './AnimationMedia';
import { RenderSceneButton } from './RenderSceneButton';

const LABEL_CLS = 'text-xs font-semibold uppercase tracking-widest text-gray-400';
const AUTO = '__auto__';

interface FxParamPanelProps {
  graphic: Graphic;
  section: EditorSection;
  /** global.theme, to show the theme colours the tokens resolve to. */
  theme?: unknown;
  onChange: (graphic: Graphic) => void;
  onRemove: () => void;
}

const humanize = (key: string): string => {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
};

const paramLabel = (t: TFunction<'admin'>, key: string) => t(`animation.param.${key}`, { defaultValue: humanize(key) });

const optionLabel = (t: TFunction<'admin'>, value: string) =>
  t(`animation.option.${value}`, { defaultValue: humanize(value.replace(/^\$/, '')) });

const read = (graphic: Graphic, key: string): unknown => (graphic as Record<string, unknown>)[key];

const sectionSeconds = (section: EditorSection): number =>
  'duration' in section && typeof section.duration === 'number' ? section.duration : 12;

export const FxParamPanel = ({ graphic, section, theme, onChange, onRemove }: FxParamPanelProps) => {
  const { t } = useTranslation('admin');

  if (!isTunableGraphic(graphic)) {
    return (
      <div className="space-y-3">
        <PanelHeader graphic={graphic} onRemove={onRemove} />
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('animation.fx.notTunable')}</p>
      </div>
    );
  }

  const set = (key: string, value: unknown) => {
    onChange(withParam(graphic, key, value));
  };
  const shared = sharedParamFields(graphic);
  const look = shared.filter((field) => field.key === 'intensity' || field.key === 'color');
  const timing = shared.filter((field) => !look.includes(field));
  const fieldProps = { graphic, theme, section, set };

  return (
    <div className="space-y-3">
      <PanelHeader graphic={graphic} onRemove={onRemove} onReroll={graphic.type === 'fx' ? set : undefined} />
      <p className="text-[0.7rem] leading-snug text-gray-500 dark:text-gray-400">{t('animation.fx.previewHint')}</p>
      <RenderSceneButton />
      {graphic.type === 'underline' ? null : <TargetField {...fieldProps} />}
      {[...look, ...ownParamFields(graphic)].map((field) => (
        <ParamControl key={field.key} field={field} {...fieldProps} />
      ))}
      <SectionDisclosure label={t('animation.fx.timing')} summary={timingSummary(t, graphic)}>
        <div className="space-y-3">
          {timing.map((field) => (
            <ParamControl key={field.key} field={field} {...fieldProps} />
          ))}
          <EaseField graphic={graphic} set={set} />
        </div>
      </SectionDisclosure>
    </div>
  );
};

function timingSummary(t: TFunction<'admin'>, graphic: Graphic): string {
  const at = read(graphic, 'at');
  const duration = read(graphic, 'duration');
  const ease = read(graphic, 'ease');

  return [
    typeof at === 'number' ? `${at}s` : t('animation.fx.auto'),
    typeof duration === 'number' ? `${duration}s` : null,
    typeof ease === 'string' ? optionLabel(t, ease) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const PanelHeader = ({
  graphic,
  onRemove,
  onReroll,
}: {
  graphic: Graphic;
  onRemove: () => void;
  onReroll?: (key: string, value: unknown) => void;
}) => {
  const { t } = useTranslation('admin');
  const entry = libraryEntryOfGraphic(graphic);
  const card = entry ? findEngineCard(entry.id) : undefined;
  const label = entry ? t(libraryLabelKey(entry.id), { defaultValue: card?.fallbackLabel }) : humanize(graphic.type);

  return (
    <div className="space-y-2">
      <KindLine family="effect" />
      <div className="flex items-center gap-2.5">
        <AnimationThumb
          thumb={card?.thumb}
          poster={card?.poster}
          fallback={label}
          className="h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-brand-500/25"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        </div>
        {onReroll ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t('animation.fx.reroll')}
            aria-label={t('animation.fx.reroll')}
            onClick={() => {
              onReroll('seed', Math.floor(Math.random() * 10000));
            }}
          >
            <Shuffle className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('animation.fx.remove')}
          title={t('animation.fx.remove')}
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

interface FieldProps {
  graphic: Graphic;
  section: EditorSection;
  theme?: unknown;
  set: (key: string, value: unknown) => void;
}

const targetLabel = (t: TFunction<'admin'>, target: string): string => {
  if (target === 'frame') return t('animation.fx.targetFrame');

  const layer = /^layer:(\d+)$/.exec(target);

  if (layer) return t('animation.fx.targetLayer', { n: Number(layer[1]) + 1 });

  return target;
};

const TargetField = ({ graphic, section, set }: FieldProps) => {
  const { t } = useTranslation('admin');
  const current = read(graphic, 'target');
  const custom = current !== undefined && typeof current !== 'string';
  const value = custom ? 'custom' : (current ?? 'frame');
  const options = fxTargetOptions(section) as string[];
  const all = options.includes(value) || custom ? options : [...options, value];

  return (
    <FieldRow label={t('animation.fx.target')}>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== 'custom') set('target', next);
        }}
      >
        <SelectTrigger aria-label={t('animation.fx.target')} className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <EditorSelectContent>
          {all.map((option) => (
            <SelectItem key={option} value={option}>
              {targetLabel(t, option)}
            </SelectItem>
          ))}
          {custom ? (
            <SelectItem value="custom" disabled>
              {t('animation.fx.targetCustom')}
            </SelectItem>
          ) : null}
        </EditorSelectContent>
      </Select>
    </FieldRow>
  );
};

const EaseField = ({ graphic, set }: Pick<FieldProps, 'graphic' | 'set'>) => {
  const { t } = useTranslation('admin');
  const current = read(graphic, 'ease');
  const value = typeof current === 'string' ? current : AUTO;
  const options: string[] =
    (FX_EASE_OPTIONS as readonly string[]).includes(value) || value === AUTO
      ? [...FX_EASE_OPTIONS]
      : [...FX_EASE_OPTIONS, value];

  return (
    <FieldRow label={paramLabel(t, 'ease')}>
      <Select
        value={value}
        onValueChange={(next) => {
          set('ease', next === AUTO ? undefined : next);
        }}
      >
        <SelectTrigger aria-label={paramLabel(t, 'ease')} className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <EditorSelectContent>
          <SelectItem value={AUTO}>{t('animation.fx.auto')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(t, option)}
            </SelectItem>
          ))}
        </EditorSelectContent>
      </Select>
    </FieldRow>
  );
};

const ParamControl = ({ field, ...props }: FieldProps & { field: ParamField }) => {
  if (field.kind === 'number') return <NumberParam field={field} {...props} />;

  if (field.kind === 'enum') return <EnumParam field={field} {...props} />;

  if (field.kind === 'color') return <ColorParam field={field} {...props} />;

  return <BooleanParam field={field} {...props} />;
};

// "Auto" chip that clears a set parameter (the engine's context default applies again).
const AutoReset = ({ label, onReset }: { label: string; onReset: () => void }) => {
  const { t } = useTranslation('admin');

  return (
    <button
      type="button"
      onClick={onReset}
      aria-label={t('animation.fx.resetParam', { label })}
      title={t('animation.fx.resetParam', { label })}
      className="tap rounded-md p-1 text-gray-400 transition-colors hover:bg-foreground/5 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <X className="h-3 w-3" />
    </button>
  );
};

const FieldRow = ({
  label,
  value,
  onReset,
  htmlFor,
  children,
}: {
  label: string;
  value?: ReactNode;
  onReset?: () => void;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <div>
    <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
      <label htmlFor={htmlFor} className={LABEL_CLS}>
        {label}
      </label>
      <span className="flex items-center gap-1 text-xs tabular-nums text-gray-500">
        {value}
        {onReset ? <AutoReset label={label} onReset={onReset} /> : null}
      </span>
    </div>
    {children}
  </div>
);

function decimals(step: number): number {
  if (step >= 1) return 0;

  return step >= 0.1 ? 1 : 2;
}

const NumberParam = ({
  field,
  graphic,
  section,
  set,
}: FieldProps & { field: Extract<ParamField, { kind: 'number' }> }) => {
  const { t } = useTranslation('admin');
  const id = useId();
  const label = paramLabel(t, field.key);
  const current = read(graphic, field.key);
  const isSet = typeof current === 'number';
  // Timing slides along the section, not the schema's 12 s bound.
  const max = field.key === 'at' ? Math.max(1, sectionSeconds(section)) : field.max;

  if (field.min === undefined || max === undefined) {
    return (
      <FieldRow
        label={label}
        htmlFor={id}
        onReset={
          isSet
            ? () => {
                set(field.key, undefined);
              }
            : undefined
        }
      >
        <NumberField
          id={id}
          value={isSet ? current : 0}
          min={field.min}
          step={field.step}
          compact
          onChange={(next) => {
            set(field.key, next);
          }}
        />
      </FieldRow>
    );
  }

  const shown = isSet ? current : (field.min + max) / 2;

  return (
    <FieldRow
      label={label}
      htmlFor={id}
      value={isSet ? current.toFixed(decimals(field.step)) : t('animation.fx.auto')}
      onReset={
        isSet
          ? () => {
              set(field.key, undefined);
            }
          : undefined
      }
    >
      <input
        id={id}
        type="range"
        min={field.min}
        max={max}
        step={field.step}
        value={shown}
        onChange={(event) => {
          set(field.key, Number(event.target.value));
        }}
        style={rangeFill(shown, field.min, max)}
        className={cn('studio-range', !isSet && 'opacity-60')}
      />
    </FieldRow>
  );
};

const EnumParam = ({ field, graphic, set }: FieldProps & { field: Extract<ParamField, { kind: 'enum' }> }) => {
  const { t } = useTranslation('admin');
  const label = paramLabel(t, field.key);
  const current = read(graphic, field.key);
  const value = typeof current === 'string' ? current : AUTO;
  const onPick = (next: string) => {
    set(field.key, next === AUTO ? undefined : next);
  };

  if (field.options.length <= 3) {
    return (
      <SegmentedControl
        label={label}
        value={value}
        onChange={onPick}
        options={[AUTO, ...field.options].map((option) => ({
          value: option,
          label: option === AUTO ? t('animation.fx.auto') : optionLabel(t, option),
        }))}
      />
    );
  }

  return (
    <FieldRow label={label}>
      <Select value={value} onValueChange={onPick}>
        <SelectTrigger aria-label={label} className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <EditorSelectContent>
          <SelectItem value={AUTO}>{t('animation.fx.auto')}</SelectItem>
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(t, option)}
            </SelectItem>
          ))}
        </EditorSelectContent>
      </Select>
    </FieldRow>
  );
};

const BooleanParam = ({ field, graphic, set }: FieldProps & { field: ParamField }) => {
  const { t } = useTranslation('admin');
  const current = read(graphic, field.key);

  return (
    <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <Checkbox
        checked={current === true}
        onCheckedChange={(checked) => {
          set(field.key, checked === true);
        }}
      />
      {paramLabel(t, field.key)}
    </label>
  );
};

const TOKEN_KEYS: Record<string, string> = {
  '$color.accent': 'accent',
  '$color.accent2': 'accent2',
  '$color.fg': 'fg',
  '$color.bg': 'bg',
};

const tokenHex = (theme: unknown, token: string): string | undefined => {
  const colors = resolveTheme(theme as ThemeSpec | undefined)?.colors as Record<string, string> | undefined;

  return colors?.[TOKEN_KEYS[token] ?? ''];
};

// A colour: Auto (the primitive's default light), a theme token (follows the template's theme) or a custom
// hex, whose picker opens only once Custom is chosen so the panel stays compact.
const ColorParam = ({ field, graphic, theme, set }: FieldProps & { field: ParamField }) => {
  const { t } = useTranslation('admin');
  const label = paramLabel(t, field.key);
  const current = read(graphic, field.key);
  const value = typeof current === 'string' ? current : undefined;
  const custom = value !== undefined && !value.startsWith('$color.');

  return (
    <FieldRow
      label={label}
      onReset={
        value
          ? () => {
              set(field.key, undefined);
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <TokenChip
          active={!value}
          label={t('animation.fx.auto')}
          onPick={() => {
            set(field.key, undefined);
          }}
        />
        {FX_COLOR_TOKENS.map((token) => (
          <TokenChip
            key={token}
            active={value === token}
            label={t(`animation.fx.token.${TOKEN_KEYS[token]}`)}
            swatch={tokenHex(theme, token)}
            onPick={() => {
              set(field.key, token);
            }}
          />
        ))}
        <TokenChip
          active={custom}
          label={t('animation.fx.custom')}
          swatch={custom ? value : undefined}
          onPick={() => {
            set(field.key, custom ? value : (tokenHex(theme, value ?? '') ?? '#FFF8EE'));
          }}
        />
      </div>
      {custom ? (
        <ColorPicker
          aria-label={label}
          className="mt-1.5"
          value={value}
          presets={[]}
          hideVariables
          onChange={(next) => {
            set(field.key, next);
          }}
        />
      ) : null}
    </FieldRow>
  );
};

const TokenChip = ({
  active,
  label,
  swatch,
  onPick,
}: {
  active: boolean;
  label: string;
  swatch?: string;
  onPick: () => void;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onPick}
    className={cn(
      'tap flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
      active
        ? 'border-brand-500 bg-brand-500/15 text-foreground'
        : 'border-foreground/10 text-gray-500 hover:border-brand-500/40 hover:text-foreground'
    )}
  >
    {swatch ? (
      <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: swatch }} />
    ) : null}
    {label}
  </button>
);
