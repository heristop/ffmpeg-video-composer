// The styling controls for a single selected text overlay, lifted out of the legacy OverlayCanvas:
// font, size, insert-variable, delete, color, and the optional background box. No canvas/preview here
// — these render in the left OverlayInspector and patch the overlay through `onPatch`.
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { Trash2, Type } from '@/presentation/components/icons';
import { ChevronDownIcon } from '@/presentation/components/icons/chevron-down';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { FONTS } from '@leclap/creative-kit/fonts';
import { DEFAULT_BOX_PADDING } from '@leclap/creative-kit/editor';
import { RangeSlider } from '../editor/controls';
import { SectionDisclosure } from '../editor/SectionDisclosure';
import { AccentControl } from '../editor/AccentControl';
import { RevealControl } from '../editor/RevealControl';
import { ExitControl } from '../editor/ExitControl';
import { TextEffectControl } from '../editor/TextEffectControl';
import {
  Button,
  Checkbox,
  ColorPicker,
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/presentation/components/ui';
import type { Exit, Reveal, TextOverlay } from '../templateEditorModel';
import { editableExit, editableReveal } from './overlay-timing';
import { EditorSelectContent } from '../editor/editor-select-content';

// newOverlay()'s seed fontsize (creative-kit editor model) — the RangeSlider reset target.
const DEFAULT_FONTSIZE = 48;
// newOverlay()'s seed boxOpacity — the reset target for the box-opacity slider.
const DEFAULT_BOX_OPACITY = 0.5;

// Collapsed "Accent & legibility" summary: every active decoration by name, or "None".
export function styleSummary(t: TFunction<'admin'>, overlay: TextOverlay): string {
  const parts: string[] = [];

  if (overlay.accent !== undefined) parts.push(t('accent.enable'));

  if (overlay.effect?.shadow) parts.push(t('textEffect.shadow'));

  if (overlay.effect?.outline) parts.push(t('textEffect.outline'));

  return parts.length > 0 ? parts.join(' · ') : t('summaryChip.none');
}

// A reveal/exit value's type string ('none' stays undefined-equivalent for the summary).
const motionTypeOf = (value: Reveal | Exit | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.type;

// Collapsed "Entrance & exit" summary: the entrance style, plus the exit style prefixed with its
// group label so "Fade · Exit Fade" stays readable, or "None".
export function motionSummary(t: TFunction<'admin'>, overlay: TextOverlay): string {
  const parts: string[] = [];
  const reveal = motionTypeOf(overlay.reveal);

  if (reveal && reveal !== 'none') parts.push(t(`reveal.${reveal}`));

  const exit = motionTypeOf(overlay.exit);

  if (exit && exit !== 'none') parts.push(`${t('exit.label')} ${t(`reveal.${exit}`)}`);

  return parts.length > 0 ? parts.join(' · ') : t('summaryChip.none');
}

interface SelectedControlsProps {
  overlay: TextOverlay;
  t: TFunction<'admin'>;
  variables: string[];
  onPatch: (patch: Partial<TextOverlay>) => void;
  onInsertVariable: (name: string) => void;
  onDelete: () => void;
}

export const SelectedControls = ({
  overlay,
  t,
  variables,
  onPatch,
  onInsertVariable,
  onDelete,
}: SelectedControlsProps) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <FontSelect
        value={overlay.font}
        t={t}
        onChange={(font) => {
          onPatch({ font });
        }}
      />
      <div className="min-w-[10rem] flex-1">
        <RangeSlider
          label={t('overlay.size')}
          value={overlay.fontsize}
          min={8}
          max={300}
          step={1}
          format={(v) => `${v}px`}
          resetTo={DEFAULT_FONTSIZE}
          onChange={(fontsize) => {
            onPatch({ fontsize });
          }}
        />
      </div>
      <VariableMenu variables={variables} t={t} onInsert={onInsertVariable} />
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('overlay.deleteText')}
        className="tap rounded-lg p-2 text-gray-500 transition-colors hover:bg-foreground/5 hover:text-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]/40 active:scale-90"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('overlay.color')}
          </label>
          <ColorPicker
            aria-label={t('overlay.textColor')}
            value={overlay.fontcolor}
            onChange={(fontcolor) => {
              onPatch({ fontcolor });
            }}
          />
        </div>
        <TextOpacityControl overlay={overlay} t={t} onPatch={onPatch} />
      </div>
      <BoxControls overlay={overlay} t={t} onPatch={onPatch} />
    </div>
    {/* Finishing touches, tucked under two disclosures so the essentials (text/font/size/colour)
        stay above the fold. Each summary mirrors the current state so nothing hides silently. */}
    <SectionDisclosure label={t('overlay.styleGroup')} summary={styleSummary(t, overlay)}>
      {/* Accent bar — the shared control the title card and lower third use, so the accent UX is
          identical everywhere. Only this call site opts into the geometry knobs (position/length/
          thickness/align): the structural title-card/lower-third bars stay colour-only. The kit
          lowers it all to a drawbox next to the drawtext. */}
      <AccentControl
        geometry
        accent={overlay.accent}
        onChange={(accent) => {
          onPatch({ accent });
        }}
      />
      {/* Drop shadow / outline legibility effect — the same control the sugar text layers use; the
          engine lowers it to drawtext shadow/border keys. */}
      <TextEffectControl
        effect={overlay.effect}
        onChange={(effect) => {
          onPatch({ effect });
        }}
      />
    </SectionDisclosure>
    <SectionDisclosure label={t('overlay.motionGroup')} summary={motionSummary(t, overlay)}>
      {/* Animated entrance (rise/slide/fade) for the text — same reveal vocabulary as the other layers. */}
      <RevealControl
        reveal={editableReveal(overlay.reveal)}
        onChange={(reveal) => {
          onPatch({ reveal });
        }}
      />
      {/* Animated exit after a delay, timed against the section duration. */}
      <ExitControl
        exit={editableExit(overlay.exit)}
        onChange={(exit) => {
          onPatch({ exit });
        }}
      />
    </SectionDisclosure>
  </div>
);

// Whole-text opacity slider for watermark-style overlays, mirroring the box-opacity one. Fully
// opaque (1) patches the field back to undefined so solid overlays keep emitting the exact same
// descriptor as before the control existed.
const TextOpacityControl = ({
  overlay,
  t,
  onPatch,
}: {
  overlay: TextOverlay;
  t: TFunction<'admin'>;
  onPatch: (patch: Partial<TextOverlay>) => void;
}) => (
  <RangeSlider
    label={t('overlay.textOpacity')}
    value={overlay.textOpacity ?? 1}
    min={0}
    max={1}
    step={0.05}
    format={(v) => `${Math.round(v * 100)}%`}
    resetTo={1}
    onChange={(next) => {
      onPatch({ textOpacity: next === 1 ? undefined : next });
    }}
  />
);

// The "Box" toggle plus its color picker, opacity slider and padding slider (revealed only when
// the box is on).
const BoxControls = ({
  overlay,
  t,
  onPatch,
}: {
  overlay: TextOverlay;
  t: TFunction<'admin'>;
  onPatch: (patch: Partial<TextOverlay>) => void;
}) => (
  <div className="space-y-2">
    <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <Checkbox
        checked={overlay.box}
        onCheckedChange={(c) => {
          onPatch({ box: c === true });
        }}
      />{' '}
      {t('overlay.box')}
    </label>
    {overlay.box && (
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('overlay.boxColor')}
          </label>
          <ColorPicker
            aria-label={t('overlay.boxColor')}
            value={overlay.boxcolor}
            onChange={(boxcolor) => {
              onPatch({ boxcolor });
            }}
          />
        </div>
        <RangeSlider
          label={t('overlay.boxOpacity')}
          value={overlay.boxOpacity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          resetTo={DEFAULT_BOX_OPACITY}
          onChange={(boxOpacity) => {
            onPatch({ boxOpacity });
          }}
        />
        <div>
          <RangeSlider
            label={t('overlay.boxPadding')}
            value={overlay.boxPadding ?? DEFAULT_BOX_PADDING}
            min={0}
            max={48}
            step={2}
            format={(v) => `${v}px`}
            resetTo={DEFAULT_BOX_PADDING}
            onChange={(next) => {
              // The historical 12px default patches back to undefined so untouched overlays keep
              // emitting the exact same descriptor as before the control existed.
              onPatch({ boxPadding: next === DEFAULT_BOX_PADDING ? undefined : next });
            }}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('overlay.boxPaddingHint')}</p>
        </div>
      </div>
    )}
  </div>
);

// Design-system font picker over the curated FONTS catalog. Each option previews in its own face.
const FontSelect = ({
  value,
  t,
  onChange,
}: {
  value: string;
  t: TFunction<'admin'>;
  onChange: (id: string) => void;
}) => (
  <div className="min-w-[9rem]">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
      {t('overlay.font')}
    </span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={t('overlay.font')} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <EditorSelectContent>
        {FONTS.map((font) => (
          <SelectItem key={font.id} value={font.id} style={{ fontFamily: font.cssFamily }}>
            {font.label}
          </SelectItem>
        ))}
      </EditorSelectContent>
    </Select>
  </div>
);

// "Insert variable ▾" dropdown. Lists the available variable names; choosing one inserts
// `{{ name }}`. Disabled when there are no variables. Dismissal mirrors AddElementMenu
// (outside-click + Escape) so keyboard users can Tab from the trigger onto the items — a
// close-on-blur trigger would slam the menu shut before focus ever reaches them.
const VariableMenu = ({
  variables,
  t,
  onInsert,
}: {
  variables: string[];
  t: TFunction<'admin'>;
  onInsert: (name: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const disabled = variables.length === 0;
  const { ref: chevronRef, hoverProps: chevronHoverProps } = useIconHover();

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;

      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      setOpen(false);
      // Hand focus back to the trigger so keyboard users don't drop to the document body.
      rootRef.current?.querySelector('button')?.focus();
    };

    if (open) {
      document.addEventListener('mousedown', onPointer);
      document.addEventListener('keydown', onKey);
    }

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (disabled) {
    return (
      <Button type="button" variant="secondary" size="sm" disabled title={t('overlay.insertVariableHint')}>
        {t('overlay.insertVariable')} <ChevronDownIcon size={14} />
      </Button>
    );
  }

  const pick = (name: string) => {
    onInsert(name);
    setOpen(false);
    // The clicked item unmounts with the popover; without this, focus falls to <body>.
    rootRef.current?.querySelector('button')?.focus();
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        {...chevronHoverProps}
      >
        {t('overlay.insertVariable')} <ChevronDownIcon ref={chevronRef} size={14} />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={t('overlay.insertVariable')}
          className="absolute z-10 mt-1 max-h-48 min-w-[10rem] overflow-auto rounded-xl border border-divider bg-surface p-1 shadow-[var(--shadow-lg)]"
        >
          {variables.map((name) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              onClick={() => {
                pick(name);
              }}
              className="tap flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-brand-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
            >
              <Type className="h-3.5 w-3.5 text-gray-400" aria-hidden /> {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
