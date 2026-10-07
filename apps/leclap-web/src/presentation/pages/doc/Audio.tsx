import { AFADE_CURVES } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { SFX_IDS } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';
import { VOICE_PRESETS } from 'ffmpeg-video-composer/src/core/audio/voice-presets.ts';
import { Seo } from '@/presentation/components/Seo';
import { DocSection, Prose, Code, ChipList, Tip, RefTable, Sample } from '@/presentation/components/doc/DocBlocks';
import { docGroups } from '@/presentation/components/doc/schemaFields';
import { snippets } from '@/presentation/components/doc/snippets';
import { DocPageHeader } from './DocLayout';

export const DocAudio = () => (
  <>
    <Seo
      title="Audio — template descriptor"
      description="The final-mix audio settings — source and music volumes, normalisation, ducking — plus per-section fade curves."
      path="/doc/audio"
    />

    <DocPageHeader kicker="Schema-driven" title="Audio">
      <Code>global.audio</Code> governs the final mix — how loud the source and music sit, normalisation, and ducking
      music under speech. Per-section, <Code>options.audioFade</Code> shapes the in/out of each clip's audio.
    </DocPageHeader>

    <DocSection id="mix" title="Final mix" kicker="`global.audio`">
      <div className="space-y-9">
        <RefTable
          id="audio"
          title="audio (global)"
          summary="The final-mix audio settings: source/music volumes and normalisation."
          rows={docGroups.globalAudio()}
        />
        <RefTable
          id="ducking"
          title="ducking"
          summary="Automatically dip the music whenever the source audio is present (set audio.ducking to true for defaults, or an object to tune it)."
          rows={docGroups.ducking()}
        />
      </div>
      <Sample code={snippets.audio} title="Global mix with ducking" />
    </DocSection>

    <DocSection id="fades" title="Fade curves" kicker="`options.audioFade`">
      <Prose className="mb-5">
        <p>
          A section's <Code>options.audioFade</Code> has an <Code>in</Code> and <Code>out</Code>, each with a{' '}
          <Code>duration</Code> and a <Code>curve</Code> — one of FFmpeg's <Code>afade</Code> shapes. The default curve
          is <Code>tri</Code>.
        </p>
      </Prose>
      <RefTable
        id="audio-fade"
        title="audioFade.in / .out"
        summary="The shape of one fade — duration in seconds and a curve from the catalogue below."
        rows={docGroups.audioFade()}
      />
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Curve catalogue ({AFADE_CURVES.length})</h3>
        <ChipList items={AFADE_CURVES} />
      </div>
      <Sample code={snippets.audioFade} title="Per-section fade in/out" />
      <Tip className="mt-6">
        <Code>tri</Code> (linear) is the safe default for music. Reach for <Code>exp</Code> or <Code>log</Code> when you
        want a gentler, more gradual fade — handy under voice-over where an abrupt cut is noticeable.
      </Tip>
    </DocSection>

    <DocSection id="voice-and-sfx" title="Voice, automation and sound effects" kicker="`options.voice` · `sfx`">
      <Prose className="mb-5">
        <p>
          On <Code>video</Code> and <Code>project_video</Code> sections, <Code>options.voice</Code> cleans up recorded
          speech and <Code>options.audioAutomation</Code> keys the clip&apos;s volume over time;{' '}
          <Code>global.audio.automation</Code> does the same for the music bed, before ducking. Section <Code>sfx</Code>{' '}
          and <Code>global.sfx</Code> place bundled sounds at a time or a time reference, and{' '}
          <Code>global.audio.sfx: &quot;auto&quot;</Code> adds them from the motion (whooshes on designed transitions,
          hits on impacts, a riser into each drop).
        </p>
      </Prose>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">voice</h3>
          <ChipList items={VOICE_PRESETS} />
        </div>
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">sfx ids</h3>
          <ChipList items={SFX_IDS} />
        </div>
      </div>
    </DocSection>
  </>
);
