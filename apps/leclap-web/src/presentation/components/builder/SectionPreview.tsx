import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { type ComponentType } from 'react';
import { Video } from '@/presentation/components/icons';
import { FileTextIcon } from '@/presentation/components/icons/file-text';
import { FONTS } from '@leclap/creative-kit/fonts';
import type { Template, InputSection } from '@/services/templateService';
import { resolveTranslation, resolveVariables, buildDescriptionVars } from '@/lib/i18nText';
import { displayFromTokens } from '@/lib/variableSyntax';
import { cn } from '@/lib/utils';
import { aspectClass, orientationOf, type Orientation } from './editorPanels';
import { useObjectUrl } from './useObjectUrl';
import { FormAnswersPreview } from './form-answers-preview';
import type { SceneModel } from './sceneStatus';

// Reference output dimensions the descriptor's absolute px (drawtext y/fontsize, drawbox x/y/w/h) are
// measured against — the same the FFmpeg render uses. We scale them to the preview via % of the frame.
const refDims = (orientation: Orientation): { w: number; h: number } => {
  if (orientation === 'portrait') return { w: 1080, h: 1920 };

  if (orientation === 'square') return { w: 1080, h: 1080 };

  return { w: 1920, h: 1080 };
};

// Fit the preview within the pane while preserving aspect. Portrait/landscape are width-driven; square
// is height-driven (`h-full w-auto`) so it stays 1:1 in the wide, short preview pane instead of keeping
// full width and getting clipped to a flat rectangle by max-height.
const previewSizeClass = (orientation: Orientation): string => {
  if (orientation === 'portrait') return 'w-full max-h-full max-w-[min(100%,22rem)]';

  if (orientation === 'square') return 'mx-auto h-full max-h-full w-auto max-w-full';

  return 'w-full max-h-full max-w-3xl';
};

// Where a drawtext/drawbox axis sits, as a % of the frame, and whether it's centre-anchored. Handles
// the three forms the templates use: `(w-text_w)/2` (centre), `(w-text_w)*0.25` (fraction), absolute px.
const axisPct = (value: string | number | undefined, ref: number): { pct: number; centre: boolean } => {
  if (typeof value === 'number') return { pct: (value / ref) * 100, centre: false };

  if (!value) return { pct: 0, centre: false };

  if (value.includes('/2')) return { pct: 50, centre: true };

  const frac = /\)\s*\*\s*(\d*\.?\d+)/.exec(value);

  if (frac) return { pct: Number(frac[1]) * 100, centre: false };

  const num = Number(value);

  return Number.isFinite(num) ? { pct: (num / ref) * 100, centre: false } : { pct: 0, centre: false };
};

const fontFamilyOf = (file: string | undefined): string => FONTS.find((f) => f.file === file)?.cssFamily ?? 'inherit';

// `#RRGGBB@a` (drawbox/colour with FFmpeg alpha suffix) → { hex, opacity }.
const splitColor = (c: string | undefined): { hex: string; opacity: number } => {
  const [hex, alpha] = (c ?? '#000000').split('@');
  const opacity = Number(alpha);

  return { hex, opacity: Number.isFinite(opacity) ? opacity : 1 };
};

interface DrawValues {
  text?: Record<string, string | undefined>;
  x?: string | number;
  y?: string | number;
  w?: number;
  h?: number;
  fontsize?: number;
  fontcolor?: string;
  fontfile?: string;
  c?: string;
}

type Vars = Record<string, string | string[]>;

const OverlayText = ({ values, refW, refH, vars }: { values: DrawValues; refW: number; refH: number; vars: Vars }) => {
  const x = axisPct(values.x, refW);
  const y = axisPct(values.y, refH);
  const text = displayFromTokens(resolveVariables(values.text?.en ?? '', vars));

  if (!text) return null;

  return (
    <span
      className="pointer-events-none absolute whitespace-pre leading-none"
      style={{
        left: `${x.pct}%`,
        top: `${y.pct}%`,
        transform: `translate(${x.centre ? '-50%' : '0'}, ${y.centre ? '-50%' : '0'})`,
        fontFamily: fontFamilyOf(values.fontfile),
        fontSize: `${((values.fontsize ?? 32) / refH) * 100}cqh`,
        color: values.fontcolor ?? '#ffffff',
        fontWeight: 400,
      }}
    >
      {text}
    </span>
  );
};

const OverlayBox = ({ values, refW, refH }: { values: DrawValues; refW: number; refH: number }) => {
  const { hex, opacity } = splitColor(values.c);

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: `${(Number(values.x ?? 0) / refW) * 100}%`,
        top: `${(Number(values.y ?? 0) / refH) * 100}%`,
        width: `${((values.w ?? 0) / refW) * 100}%`,
        height: `${((values.h ?? 0) / refH) * 100}%`,
        backgroundColor: hex,
        opacity,
      }}
    />
  );
};

// Composite the section's drawtext/drawbox filters in authored order (boxes back the text).
const Overlays = ({
  filters,
  refW,
  refH,
  vars,
}: {
  filters: Array<{ type: string; values?: DrawValues }>;
  refW: number;
  refH: number;
  vars: Vars;
}) => (
  <>
    {filters.map((f, i) => {
      if (f.type === 'drawbox' && f.values) return <OverlayBox key={i} values={f.values} refW={refW} refH={refH} />;

      if (f.type === 'drawtext' && f.values) {
        return <OverlayText key={i} values={f.values} refW={refW} refH={refH} vars={vars} />;
      }

      return null;
    })}
  </>
);

interface SectionPreviewProps {
  template: Template;
  section: InputSection | null;
  model: SceneModel;
}

// The monitor's empty state for a not-yet-filled scene: the scene title plus a one-line hint that
// points at the next action in the Content panel (record/upload for clips, fill fields for forms),
// so the blank stage teaches what to do rather than just naming the scene.
const Placeholder = ({
  kind,
  title,
  Icon,
  t,
}: {
  kind: InputSection['kind'] | undefined;
  title: string;
  Icon: ComponentType<{ className?: string }>;
  t: TFunction<'builder'>;
}) => {
  const isClip = kind === 'clip';

  return (
    // relative z-10 keeps the empty-state guidance above the template's <Overlays> (which paint after
    // it) — otherwise a centred drawbox/drawtext crosses the text and reads as a cropped title.
    <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-brand-500/20 via-secondary-500/10 to-accent-400/15 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-white/70 ring-1 ring-white/15">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold text-white/90">
          {isClip ? t('editor.emptyClipTitle') : title}
        </p>
        <p className="mx-auto max-w-[16rem] text-xs leading-relaxed text-white/55">
          {isClip ? t('editor.emptyClipHint') : t('editor.emptyFormHint')}
        </p>
      </div>
    </div>
  );
};

// What fills the frame: the recorded clip, the answers of a form scene, or the empty-state guidance.
function PreviewBase({
  url,
  section,
  template,
  model,
  title,
  Icon,
}: {
  url: string | null | undefined;
  section: InputSection | null;
  template: Template;
  model: SceneModel;
  title: string;
  Icon: ComponentType<{ className?: string }>;
}) {
  const { t } = useTranslation('builder');

  if (url) return <video src={url} className="h-full w-full object-cover" autoPlay loop muted playsInline />;

  if (section?.kind === 'form') {
    return <FormAnswersPreview template={template} section={section} formData={model.formData} />;
  }

  return <Placeholder kind={section?.kind} title={title} Icon={Icon} t={t} />;
}

// Derive the section's overlays, vars, placeholder title and glyph — kept out of the component so its
// render stays simple (and under the complexity budget).
const previewData = (
  template: Template,
  section: InputSection | null,
  lang: string,
  formData: Record<string, string>,
  fallback: string
) => {
  const descriptor = section ? (template.descriptor.sections ?? []).find((s) => s.name === section.name) : undefined;

  return {
    filters: (descriptor?.filters ?? []) as Array<{ type: string; values?: DrawValues }>,
    vars: buildDescriptionVars(template.descriptor.global?.variables, formData),
    title: section ? displayFromTokens(resolveTranslation(section.title, lang) ?? fallback) : fallback,
    Icon: section?.kind === 'clip' ? Video : FileTextIcon,
  };
};

// Live-ish scene preview: the recorded clip (or a branded placeholder) as the base, with the section's
// drawtext / drawbox overlays composited on top and {{ tokens }} resolved from the live form data — so
// a lower-third reads "Claire Nichols", not "{{ form_1_name }}". Approximate (no transitions, motion,
// alpha timing or audio); the final render is the source of truth.
export const SectionPreview = ({ template, section, model }: SectionPreviewProps) => {
  const { t, i18n } = useTranslation('builder');
  const orientation = orientationOf(template);
  const { w: refW, h: refH } = refDims(orientation);
  const clip = section?.kind === 'clip' ? model.clipsBySection[section.name] : undefined;
  const url = useObjectUrl(clip);
  const { filters, vars, title, Icon } = previewData(
    template,
    section,
    i18n.language,
    model.formData,
    t('hub.section')
  );

  return (
    <div className="flex h-full items-center justify-center p-4 sm:p-8">
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-foreground/10',
          aspectClass(orientation),
          previewSizeClass(orientation)
        )}
        style={{ containerType: 'size' }}
      >
        <PreviewBase url={url} section={section} template={template} model={model} title={title} Icon={Icon} />

        <Overlays filters={filters} refW={refW} refH={refH} vars={vars} />
      </div>
    </div>
  );
};
