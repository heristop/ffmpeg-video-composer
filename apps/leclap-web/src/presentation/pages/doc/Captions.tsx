import { Link } from 'react-router-dom';
import {
  CAPTION_STYLES,
  CAPTION_POSITIONS,
  CAPTION_ALIGNS,
} from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { SUBTITLE_KARAOKE } from 'ffmpeg-video-composer/src/schemas/subtitles.schemas.ts';
import { CAPTION_DNA_IDS } from 'ffmpeg-video-composer/src/core/captions/dna.ts';
import { Seo } from '@/presentation/components/Seo';
import { DocSection, Prose, Code, ChipList, RefTable, Sample } from '@/presentation/components/doc/DocBlocks';
import { docGroups } from '@/presentation/components/doc/schemaFields';
import { snippets } from '@/presentation/components/doc/snippets';
import { DocPageHeader } from './DocLayout';

export const DocCaptions = () => (
  <>
    <Seo
      title="Captions — template descriptor"
      description="The caption sugar — localized text drawn over a section — and its style, position and alignment options."
      path="/doc/captions"
    />

    <DocPageHeader kicker="Schema-driven" title="Captions">
      <Code>caption</Code> draws styled, localized text over a section without hand-writing a <Code>drawtext</Code>{' '}
      filter. Set the text and pick a style, position and alignment.
    </DocPageHeader>

    <DocSection id="reference" title="Fields" kicker="`caption`">
      <RefTable
        id="caption"
        title="caption"
        summary="Styled text overlaid on the section, with translation-aware text."
        rows={docGroups.caption()}
      />
      <Sample code={snippets.caption} title="A captioned section" />
    </DocSection>

    <DocSection id="typography" title="Title cards, lower thirds and reveal timing">
      <Prose>
        <p>
          Use a titleCard on color_background for an editorial card, or lowerThird on a visual scene for a
          title/subtitle/badge band. All text blocks support reveal entrances and text legibility effects. Title-card
          stagger is seconds between non-empty line entrances; zero starts lines together. Easing curves travel and
          opacity; ease-out-back overshoots position while clamping opacity.
        </p>
        <p>
          Native exit settings belong to positioned drawtext filters, not caption/titleCard/lowerThird blocks. See the{' '}
          <Link to="/doc/reference#reveal">complete reveal and exit reference</Link> for defaults, font contracts and
          examples, and <Link to="/doc/effects">registered effects</Link> for per-word choreography.
        </p>
      </Prose>
      <RefTable id="title-card" title="titleCard" rows={docGroups.titleCard()} />
      <RefTable id="lower-third" title="lowerThird" rows={docGroups.lowerThird()} />
      <RefTable id="text-reveal" title="reveal (object form)" rows={docGroups.reveal()} />
      <RefTable id="text-effect" title="effect (legibility)" rows={docGroups.textEffect()} />
    </DocSection>

    <DocSection id="enums" title="Style, position & alignment" kicker="Enums">
      <Prose className="mb-5">
        <p>
          <Code>style</Code> picks the visual preset, <Code>position</Code> places the caption vertically, and{' '}
          <Code>align</Code> sets horizontal alignment. Defaults are <Code>bar</Code>, <Code>bottom</Code> and{' '}
          <Code>center</Code>.
        </p>
      </Prose>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">style</h3>
          <ChipList items={CAPTION_STYLES} />
        </div>
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">position</h3>
          <ChipList items={CAPTION_POSITIONS} />
        </div>
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">align</h3>
          <ChipList items={CAPTION_ALIGNS} />
        </div>
      </div>
    </DocSection>

    <DocSection id="subtitles" title="Word-timed subtitles" kicker="`subtitles`">
      <Prose className="mb-5">
        <p>
          A section&apos;s <Code>subtitles</Code> turns speech-to-text <Code>words</Code>, authored <Code>cues</Code> or
          an inline <Code>srt</Code> into designed captions. Words are grouped into phrases at pauses, sentence ends and
          commas, each phrase is fitted to balanced lines with the bundled font, and the spoken word can light up
          (karaoke). A <Code>crown</Code> line is drawn larger once per video. Everything lowers to plain{' '}
          <Code>drawtext</Code> filters, so it renders the same everywhere. See the{' '}
          <a href="https://github.com/heristop/leclap/blob/main/docs/template-configuration.md#subtitles-word-timed-captions">
            subtitles reference
          </a>
          .
        </p>
      </Prose>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">style (caption DNA)</h3>
          <ChipList items={CAPTION_DNA_IDS} />
        </div>
        <div>
          <h3 className="mb-2 font-mono text-sm font-semibold text-foreground">karaoke</h3>
          <ChipList items={SUBTITLE_KARAOKE} />
        </div>
      </div>
    </DocSection>
  </>
);
