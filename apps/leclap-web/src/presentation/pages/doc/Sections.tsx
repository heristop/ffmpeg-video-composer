import { Seo } from '@/presentation/components/Seo';
import { DocSection, Prose, Code, Tip, RefTable, Sample } from '@/presentation/components/doc/DocBlocks';
import { docGroups, sectionTypeValues } from '@/presentation/components/doc/schemaFields';
import { snippets } from '@/presentation/components/doc/snippets';
import { DocPageHeader } from './DocLayout';

// The discriminated-union `type` set is schema-driven (sectionTypeValues); these one-line glosses are
// the only hand-authored part. A type added to the schema shows here with an em-dash, flagging it for
// a blurb rather than silently disappearing.
const TYPE_BLURB: Record<string, string> = {
  video: 'A bundled or uploaded video clip.',
  project_video:
    'A clip the end user records or supplies at build time. Use captureMode / allowedCaptureModes to control the input source (front, back, screen, upload), and framingGuide to overlay a shot composition guide.',
  form: 'A data-collection step whose fields feed later text. Produces no clip of its own.',
  color_background: 'A solid-colour or gradient backdrop, optionally with composited layers.',
  image_background: 'A still-image backdrop.',
  music: 'A music-only section contributing audio to the final mix.',
  partial: 'Embeds a reusable partial template, optionally with a prefix and overridden variables.',
  effect:
    'References a versioned registered effect with JSON props/assets. A trusted backend resolves it into a project_video clip before FFmpeg composition.',
};

export const DocSections = () => (
  <>
    <Seo
      title="Sections & types — template descriptor"
      description="LeClap section types, including registered JSON effects, shared native fields, reusable partials and per-section options."
      path="/doc/sections"
    />

    <DocPageHeader kicker="Structure" title="Sections & types">
      <Code>sections</Code> is an ordered list of visual scenes, audio, form steps and partial references. Native scenes
      share base fields; a <Code>type</Code> selects their options. Registered effects have their own reference and
      duration contract and require resolution before composition.
    </DocPageHeader>

    <DocSection id="types" title="Section types" kicker="Discriminated union">
      <Prose className="mb-5">
        <p>
          The <Code>type</Code> field is the discriminant. There are {sectionTypeValues().length} types — each unlocks
          its own <Code>options</Code> (for example <Code>layers</Code> on <Code>color_background</Code>,{' '}
          <Code>framingGuide</Code> / <Code>captureMode</Code> on <Code>project_video</Code>, <Code>fields</Code> on{' '}
          <Code>form</Code>).
        </p>
      </Prose>
      <div className="overflow-x-auto rounded-2xl border border-divider bg-surface/60">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-divider bg-foreground/[0.025] text-[0.7rem] uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3 font-semibold">type</th>
              <th className="px-4 py-3 font-semibold">Use</th>
            </tr>
          </thead>
          <tbody>
            {sectionTypeValues().map((type) => (
              <tr key={type} className="border-b border-divider/60 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.85rem] font-medium text-foreground">
                  {type}
                </td>
                <td className="px-4 py-3 text-[0.85rem] leading-6 text-gray-300">{TYPE_BLURB[type] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DocSection>

    <DocSection id="reference" title="Fields" kicker="Schema-driven">
      <div className="space-y-9">
        <RefTable
          id="section"
          title="section"
          summary="Shared section fields. Registered effects also require a name, effect reference and contract-compatible duration."
          rows={docGroups.section()}
        />
        <RefTable
          id="options"
          title="options"
          summary="Per-section knobs, unioned across every section type — duration, speed, framing, fades, colours, layers and more. Which keys are valid depends on the section type."
          rows={docGroups.options()}
        />
        <RefTable
          id="inputs"
          title="inputs[]"
          summary="Animation assets composited over the section video."
          rows={docGroups.inputs()}
        />
      </div>
      <Sample code={snippets.section} title="A minimal section" />
      <Sample code={snippets.captureMode} title="Capture modes on a project_video section" className="mt-6" />
      <Tip className="mt-8">
        Only the fields tagged <span className="font-semibold text-foreground">required</span> must be present —
        optional fields may have a schema default. Native sections use <Code>type</Code> and <Code>options</Code>;
        registered effects require their name, versioned reference and duration. Omit what you don&apos;t need and add
        fields as you go.
      </Tip>
    </DocSection>
  </>
);
