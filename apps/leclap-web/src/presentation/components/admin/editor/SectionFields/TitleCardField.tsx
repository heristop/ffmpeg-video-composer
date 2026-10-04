// The "Title card" control for color_background sections: kicker / headline / subtitle text, an accent
// colour, alignment, an entrance and fade toggles. Lowers to the descriptor `titleCard` sugar, which
// the engine turns into the drawtext/drawbox/fade filters intros used to author by hand. Clearing every
// line removes the card. Distinct from the positional OverlayCanvas — this is the structured card.
import { useTranslation } from 'react-i18next';
import { FONTS, isFontRef } from '@leclap/creative-kit/fonts';
import { FEATURE_CONTROLS, fontLabel, type TitleCard } from '../../templateEditorModel';
import { Checkbox, ColorPicker, Select, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { RangeSlider, SegmentedControl, type SegmentOption } from '../controls';
import { AccentControl } from '../AccentControl';
import { SectionDisclosure } from '../SectionDisclosure';
import { RevealControl } from '../RevealControl';
import { TextEffectControl } from '../TextEffectControl';
import { VariableTextField } from '../VariableTextField';
import { FONT_REF_OPTION, fontPickerValue } from '../font-picker';
import { EditorSelectContent } from '../editor-select-content';

type Align = NonNullable<TitleCard['align']>;
const STAGGER_SPEC = FEATURE_CONTROLS.titleCard.find((spec) => spec.fieldPath === 'titleCard.stagger');
type LineStyle = NonNullable<TitleCard['kickerStyle']>;

// The engine's preset look per line at the landscape 1280x720 scale (text-blocks.ts styledLook
// defaults) — shown as the resting values before an author overrides them.
const LINE_DEFAULTS = {
  kicker: { fontsize: 19, color: '#ffffff' },
  headline: { fontsize: 61, color: '#ffffff' },
  subtitle: { fontsize: 22, color: '#cfd3de' },
} as const;

function lineText(line: TitleCard['headline']): string {
  return line?.en ?? '';
}

function hasAnyText(card: TitleCard): boolean {
  return [card.kicker, card.headline, card.subtitle].some((line) => lineText(line).trim() !== '');
}

// Merge a patch over the current card; clear the whole card once no line has text.
function nextTitleCard(current: TitleCard | undefined, patch: Partial<TitleCard>): TitleCard | undefined {
  const merged: TitleCard = { ...current, ...patch };

  return hasAnyText(merged) ? merged : undefined;
}

function setLine(value: string): TitleCard['headline'] | undefined {
  return value.trim() === '' ? undefined : { en: value };
}

// The disclosure summary: the overridden font label / size / colour, or the fallback when the line
// still renders with the engine preset.
function lineStyleSummary(style: LineStyle | undefined, fallback: string): string {
  const font = style?.font ? fontLabel(style.font) : null;
  const parts = [font, style?.fontsize ? `${style.fontsize}px` : null, style?.color ?? null].filter(
    (part): part is string => Boolean(part)
  );

  return parts.length > 0 ? parts.join(' · ') : fallback;
}

interface TitleCardFieldProps {
  titleCard: TitleCard | undefined;
  onChange: (titleCard: TitleCard | undefined) => void;
  variables: string[];
  inputCls: string;
}

export const TitleCardField = ({ titleCard, onChange, variables, inputCls }: TitleCardFieldProps) => {
  const { t } = useTranslation('admin');
  const card = titleCard;

  const patch = (next: Partial<TitleCard>) => {
    onChange(nextTitleCard(card, next));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('titleCard.hint')}</p>
      <CardLine
        label={t('titleCard.kicker')}
        placeholder={t('titleCard.kickerPlaceholder')}
        value={lineText(card?.kicker)}
        variables={variables}
        inputCls={inputCls}
        onText={(v) => {
          patch({ kicker: setLine(v) });
        }}
        styleLabel={t('titleCard.kickerStyleLabel')}
        style={card?.kickerStyle}
        // The engine tints an unstyled kicker with the accent (styledLook's colour default).
        styleDefaults={{ ...LINE_DEFAULTS.kicker, color: card?.accent ?? LINE_DEFAULTS.kicker.color }}
        onStyle={(kickerStyle) => {
          patch({ kickerStyle });
        }}
      />
      <CardLine
        label={t('titleCard.headline')}
        placeholder={t('titleCard.headlinePlaceholder')}
        value={lineText(card?.headline)}
        variables={variables}
        inputCls={inputCls}
        onText={(v) => {
          patch({ headline: setLine(v) });
        }}
        styleLabel={t('titleCard.headlineStyleLabel')}
        style={card?.headlineStyle}
        styleDefaults={LINE_DEFAULTS.headline}
        onStyle={(headlineStyle) => {
          patch({ headlineStyle });
        }}
      />
      <CardLine
        label={t('titleCard.subtitle')}
        placeholder={t('titleCard.subtitlePlaceholder')}
        value={lineText(card?.subtitle)}
        variables={variables}
        inputCls={inputCls}
        onText={(v) => {
          patch({ subtitle: setLine(v) });
        }}
        styleLabel={t('titleCard.subtitleStyleLabel')}
        style={card?.subtitleStyle}
        styleDefaults={LINE_DEFAULTS.subtitle}
        onStyle={(subtitleStyle) => {
          patch({ subtitleStyle });
        }}
      />
      {card && hasAnyText(card) && <CardOptions card={card} patch={patch} />}
    </div>
  );
};

// The card-wide options (accent / alignment / background / fades / reveal / effect), shown once the
// card has any text.
const CardOptions = ({ card, patch }: { card: TitleCard; patch: (next: Partial<TitleCard>) => void }) => {
  const { t } = useTranslation('admin');
  const align = card.align ?? 'left';

  const alignOptions: ReadonlyArray<SegmentOption<Align>> = [
    { value: 'left', label: t('titleCard.alignLeft') },
    { value: 'center', label: t('titleCard.alignCenter') },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* The shared accent control (same as the lower third + text overlays): the engine draws the
            underline bar and tints an unstyled kicker only when an accent is set. */}
        <AccentControl
          accent={card.accent}
          hint={t('accent.hintTitleCard')}
          onChange={(accent) => {
            patch({ accent });
          }}
        />
        <SegmentedControl
          label={t('titleCard.align')}
          value={align}
          options={alignOptions}
          onChange={(next) => {
            patch({ align: next });
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('titleCard.background')}
          </span>
          {/* The card's fade colour; the engine defaults to the section background when unset. */}
          <ColorPicker
            aria-label={t('titleCard.background')}
            value={card.background ?? '#000000'}
            onChange={(background) => {
              patch({ background });
            }}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('titleCard.fade')}
          </span>
          <div className="flex flex-col gap-1.5">
            <FadeToggle
              label={t('titleCard.fadeIn')}
              checked={card.fade?.in ?? true}
              onChange={(on) => {
                patch({ fade: { ...card.fade, in: on } });
              }}
            />
            <FadeToggle
              label={t('titleCard.fadeOut')}
              checked={card.fade?.out ?? true}
              onChange={(on) => {
                patch({ fade: { ...card.fade, out: on } });
              }}
            />
          </div>
        </div>
      </div>
      <RevealControl
        reveal={card.reveal}
        onChange={(reveal) => {
          patch({ reveal });
        }}
      />
      <RangeSlider
        label={t('titleCard.stagger')}
        value={card.stagger ?? 0.15}
        min={STAGGER_SPEC?.min ?? 0}
        max={STAGGER_SPEC?.max ?? 1}
        step={0.01}
        resetTo={0.15}
        format={(value) => `${value}s`}
        onChange={(stagger) => {
          patch({ stagger: stagger === 0.15 ? undefined : stagger });
        }}
      />
      <TextEffectControl
        effect={card.effect}
        onChange={(effect) => {
          patch({ effect });
        }}
      />
    </>
  );
};

// One card line: the text input plus its per-line style disclosure (shown once the line has text).
const CardLine = ({
  label,
  placeholder,
  value,
  variables,
  inputCls,
  onText,
  styleLabel,
  style,
  styleDefaults,
  onStyle,
}: {
  label: string;
  placeholder: string;
  value: string;
  variables: string[];
  inputCls: string;
  onText: (value: string) => void;
  styleLabel: string;
  style: LineStyle | undefined;
  styleDefaults: { fontsize: number; color: string };
  onStyle: (style: LineStyle) => void;
}) => (
  <>
    <Line
      label={label}
      placeholder={placeholder}
      value={value}
      variables={variables}
      inputCls={inputCls}
      onChange={onText}
    />
    {value.trim() !== '' && (
      <LineStyleControl label={styleLabel} style={style} defaults={styleDefaults} onChange={onStyle} />
    )}
  </>
);

// One line's font / size / colour overrides behind a disclosure — mirrors CaptionAdvanced. Unset
// fields keep the engine preset (styledLook in text-blocks.ts), so the summary reads "Defaults"
// until the author overrides something.
const LineStyleControl = ({
  label,
  style,
  defaults,
  onChange,
}: {
  label: string;
  style: LineStyle | undefined;
  defaults: { fontsize: number; color: string };
  onChange: (style: LineStyle) => void;
}) => {
  const { t } = useTranslation('admin');

  const patch = (next: Partial<LineStyle>) => {
    onChange({ ...style, ...next });
  };

  return (
    <SectionDisclosure label={label} summary={lineStyleSummary(style, t('titleCard.styleDefaults'))}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('titleCard.font')}
          </span>
          <Select
            value={fontPickerValue(style?.font, '')}
            onValueChange={(font) => {
              patch({ font });
            }}
          >
            <SelectTrigger aria-label={t('titleCard.font')} className="w-full">
              <SelectValue placeholder={t('titleCard.fontDefault')} />
            </SelectTrigger>
            <EditorSelectContent>
              {isFontRef(style?.font) ? (
                <SelectItem value={FONT_REF_OPTION} disabled>
                  {fontLabel(style.font)}
                </SelectItem>
              ) : null}
              {FONTS.map((font) => (
                <SelectItem key={font.id} value={font.id} style={{ fontFamily: font.cssFamily }}>
                  {font.label}
                </SelectItem>
              ))}
            </EditorSelectContent>
          </Select>
        </div>
        <NumberField
          label={t('titleCard.fontsize')}
          value={style?.fontsize ?? defaults.fontsize}
          min={8}
          max={300}
          step={1}
          unit="px"
          compact
          className="w-full"
          onChange={(fontsize) => {
            patch({ fontsize });
          }}
        />
      </div>
      <div>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
          {t('titleCard.color')}
        </span>
        <ColorPicker
          aria-label={t('titleCard.color')}
          value={style?.color ?? defaults.color}
          onChange={(color) => {
            patch({ color });
          }}
        />
      </div>
    </SectionDisclosure>
  );
};

// A small labelled checkbox for the card's auto fade-in / fade-out toggles.
const FadeToggle = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) => (
  <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
    <Checkbox
      checked={checked}
      onCheckedChange={(c) => {
        onChange(c === true);
      }}
    />
    {label}
  </label>
);

// One labelled text line — shared by kicker / headline / subtitle. Backed by VariableTextField so
// typing `#` opens the in-scope variable autocomplete and stores the canonical `{{ name }}` token.
const Line = ({
  label,
  placeholder,
  value,
  variables,
  inputCls,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  variables: string[];
  inputCls: string;
  onChange: (value: string) => void;
}) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</span>
    <VariableTextField
      value={value}
      onChange={onChange}
      variables={variables.map((name) => ({ name, scope: 'global' as const }))}
      placeholder={placeholder}
      className={inputCls}
      aria-label={label}
    />
  </label>
);
