import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Video, Image, Music, File, Square, type LucideIcon } from '@/presentation/components/icons';
import { FONTS } from '@leclap/creative-kit/fonts';
import { listAvailablePartials, materializeTemplatePartials } from '@/services/templatePartialService';
import { userPartialService } from '@/services/userPartialService';
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { EditorSection } from '../templateEditorModel';
import { resolvePartialImageUrl } from './partialPreviewBackground';

type PartialSection = Extract<EditorSection, { kind: 'partial' }>;

// Built-in partials are authored on a 1280x720 canvas; the drawtext/drawbox px below are measured
// against it, so we scale them to the preview as a percentage of these reference dims.
const REF_W = 1280;
const REF_H = 720;

interface DrawValues {
  text?: { en?: string } | string;
  x?: string | number;
  y?: string | number;
  w?: number | string;
  h?: number | string;
  fontsize?: number;
  fontcolor?: string;
  fontfile?: string;
  c?: string;
}

interface RawFilter {
  type?: string;
  values?: DrawValues;
}

interface ComposedSection {
  type?: string;
  options?: { backgroundColor?: string; imageUrl?: string; videoUrl?: string };
  filters?: RawFilter[];
}

// A glyph per descriptor section type, so the fallback tile reads the partial's make-up at a glance.
const TYPE_ICONS: Record<string, LucideIcon> = {
  video: Video,
  image_background: Image,
  color_background: Square,
  music: Music,
};

const iconForType = (type: string | undefined): LucideIcon => TYPE_ICONS[type ?? ''] ?? File;

const fontFamilyOf = (file: string | undefined): string =>
  FONTS.find((font) => font.file === file)?.cssFamily ?? 'inherit';

// Where a drawtext/drawbox axis sits, as a % of the frame, and whether it is centre-anchored. Mirrors
// SectionPreview: handles `(w-text_w)/2` (centre), `(...)*0.25` (fraction) and absolute px.
const axisPct = (value: string | number | undefined, ref: number): { pct: number; centre: boolean } => {
  if (typeof value === 'number') return { pct: (value / ref) * 100, centre: false };

  if (!value) return { pct: 0, centre: false };

  if (value.includes('/2')) return { pct: 50, centre: true };

  const frac = /\)\s*\*\s*(\d*\.?\d+)/.exec(value);

  if (frac) return { pct: Number(frac[1]) * 100, centre: false };

  const num = Number(value);

  return Number.isFinite(num) ? { pct: (num / ref) * 100, centre: false } : { pct: 0, centre: false };
};

// `#RRGGBB@a` (FFmpeg colour with alpha suffix) → { hex, opacity }.
const splitColor = (colour: string | undefined): { hex: string; opacity: number } => {
  const [hex, alpha] = (colour ?? '#000000').split('@');
  const opacity = Number(alpha);

  return { hex, opacity: Number.isFinite(opacity) ? opacity : 1 };
};

const overlayText = (text: DrawValues['text']): string => {
  if (typeof text === 'string') return text;

  return text?.en ?? '';
};

const OverlayBox = ({ values }: { values: DrawValues }) => {
  const { hex, opacity } = splitColor(values.c);

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: `${(Number(values.x ?? 0) / REF_W) * 100}%`,
        top: `${(Number(values.y ?? 0) / REF_H) * 100}%`,
        width: `${(Number(values.w ?? 0) / REF_W) * 100}%`,
        height: `${(Number(values.h ?? 0) / REF_H) * 100}%`,
        backgroundColor: hex,
        opacity,
      }}
    />
  );
};

const OverlayText = ({ values }: { values: DrawValues }) => {
  const text = overlayText(values.text);

  if (!text) return null;

  const x = axisPct(values.x, REF_W);
  const y = axisPct(values.y, REF_H);

  return (
    <span
      className="pointer-events-none absolute whitespace-pre leading-none"
      style={{
        left: `${x.pct}%`,
        top: `${y.pct}%`,
        transform: `translate(${x.centre ? '-50%' : '0'}, ${y.centre ? '-50%' : '0'})`,
        fontFamily: fontFamilyOf(values.fontfile),
        fontSize: `${((values.fontsize ?? 32) / REF_H) * 100}cqh`,
        color: values.fontcolor ?? '#ffffff',
      }}
    >
      {text}
    </span>
  );
};

// Composite the section's drawbox/drawtext filters in authored order (boxes back the text). Only the
// always-on layers are drawn — `enable` timelines (blink/strobe) are ignored for a calm still preview.
const Overlays = ({ filters }: { filters: RawFilter[] }) => (
  <>
    {filters.map((filter, index) => {
      if (filter.type === 'drawbox' && filter.values) return <OverlayBox key={index} values={filter.values} />;

      if (filter.type === 'drawtext' && filter.values) return <OverlayText key={index} values={filter.values} />;

      return null;
    })}
  </>
);

interface ComposedPartial {
  id: string;
  sections: ComposedSection[];
  first: ComposedSection | undefined;
}

// Compose the partial's sections through the creative-kit expansion path so `{{ tokens }}` resolve.
const composeRef = (ref: string, overrides: Record<string, string>): ComposedSection[] => {
  const descriptor: TemplateDescriptor = {
    sections: [{ type: 'partial', ref, variables: overrides }],
  } as unknown as TemplateDescriptor;

  try {
    return (materializeTemplatePartials(descriptor).sections ?? []) as ComposedSection[];
  } catch {
    return [];
  }
};

// Resolve the referenced partial and compose its sections, picking the FIRST visual one. Returns
// undefined when the ref is empty or unknown. Pure so it stays out of the hook's render path.
const resolveComposed = (ref: string, variables: PartialSection['variables']): ComposedPartial | undefined => {
  const available = listAvailablePartials(userPartialService.list());
  const partial = ref ? available.find((candidate) => candidate.id === ref) : undefined;

  if (!partial) return undefined;

  const overrides = Object.fromEntries(variables.map((entry) => [entry.name, entry.value]));
  const sections = composeRef(ref, overrides);
  const first = sections.find((candidate) => candidate.type !== 'form' && candidate.type !== 'music');

  return { id: partial.id, sections, first };
};

// Memoise the composition so `{{ tokens }}` are only re-resolved when the ref or its overrides change.
const useComposedPartial = (section: PartialSection): ComposedPartial | undefined => {
  const ref = section.ref.trim();

  return useMemo(() => resolveComposed(ref, section.variables), [ref, section.variables]);
};

// A clean labelled fallback (used when the partial can't be resolved or its first section is not
// previewable): the partial id, its section count, and one glyph per section type — far richer than a
// bare "PARTIAL" word.
const FallbackTile = ({
  id,
  sectionCount,
  types,
  label,
}: {
  id: string;
  sectionCount: number;
  types: string[];
  label: string;
}) => (
  <div className="grid h-full place-items-center p-4 sm:p-6">
    <div className="relative aspect-video w-full max-w-full">
      {/* A plain program-out frame, not the sky illustration: the partial's content is unknown here. */}
      <div className="h-full w-full rounded-lg border border-foreground/10 bg-player-ink" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-white">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/60">{label}</span>
        <span className="font-display text-base font-semibold text-white/90">{id}</span>
        {types.length > 0 ? (
          <span className="flex items-center gap-1.5 text-white/70" aria-hidden="true">
            {types.map((type, index) => {
              const Icon = iconForType(type);

              return <Icon key={index} className="size-4" />;
            })}
          </span>
        ) : null}
        <span className="text-xs text-white/55">
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
        </span>
      </div>
    </div>
  </div>
);

// The painted partial backdrop: a stage-filling landscape frame carrying the colour and/or image
// background, the composed always-on overlays, and the partial-id caption. Partials carry no
// authored orientation in their options, so the frame stays landscape (aspect-video) and grows to
// fill the stage like SectionCanvas's landscape frame.
const PaintedPreview = ({
  label,
  id,
  background,
  imageUrl,
  filters,
}: {
  label: string;
  id: string;
  background: string | undefined;
  imageUrl: string | undefined;
  filters: RawFilter[];
}) => (
  <div className="grid h-full place-items-center p-4 sm:p-6">
    <div className="w-full max-w-full">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10"
        style={{ containerType: 'size', backgroundColor: background ?? '#0b0b0f' }}
      >
        {imageUrl ? (
          <img aria-hidden alt="" src={imageUrl} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <Overlays filters={filters} />
      </div>
      <span className="mt-2 block text-center text-xs font-medium text-muted-foreground">
        {label} · {id}
      </span>
    </div>
  </div>
);

interface PaintPlan {
  background: string | undefined;
  imageUrl: string | undefined;
  filters: RawFilter[];
}

// Derive what the first visual section paints: its colour, a resolved image backdrop, and the
// always-on overlays (blink/strobe `enable` timelines dropped for a calm still). Returns undefined
// when nothing is paintable (no first section, no colour, no image, no overlays) so the caller keeps
// its labelled fallback.
const paintPlan = (first: ComposedSection | undefined): PaintPlan | undefined => {
  if (!first) return undefined;

  const filters = (first.filters ?? []).filter((filter) => filter.values && !('enable' in filter.values));
  const background = first.options?.backgroundColor;
  const imageUrl = resolvePartialImageUrl(first.options?.imageUrl);

  if (!background && !imageUrl && filters.length === 0) return undefined;

  return { background, imageUrl, filters };
};

interface PartialPreviewProps {
  section: PartialSection;
}

// The program-monitor preview for a `partial` section: best-effort WYSIWYG. When the referenced
// partial's first visual section is a colour/image background it paints that backdrop with the
// composed drawtext/drawbox overlays (variables resolved) and captions the partial id. Otherwise it
// falls back to a richer labelled tile (id + section count + type glyphs). Never throws.
export const PartialPreview = ({ section }: PartialPreviewProps) => {
  const { t } = useTranslation('admin');
  const composed = useComposedPartial(section);
  const label = t('shell.partialPreviewLabel');

  if (!composed) {
    const ref = section.ref.trim();

    return (
      <FallbackTile id={ref.length > 0 ? ref : t('shell.partialUnset')} sectionCount={0} types={[]} label={label} />
    );
  }

  const { id, sections, first } = composed;
  const plan = paintPlan(first);

  if (!plan) {
    const types = sections.map((candidate) => candidate.type ?? '');

    return <FallbackTile id={id} sectionCount={sections.length} types={types} label={label} />;
  }

  return (
    <PaintedPreview
      label={label}
      id={id}
      background={plan.background}
      imageUrl={plan.imageUrl}
      filters={plan.filters}
    />
  );
};
