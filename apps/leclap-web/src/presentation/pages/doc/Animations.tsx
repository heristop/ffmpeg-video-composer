import recipeFixture from '../../../../../../examples/overlay-effects/preview-template.json';
import { Link } from 'react-router-dom';
import { Seo } from '@/presentation/components/Seo';
import { DocSection, Prose, Code, RefTable, Sample, Tip, JsonBlock } from '@/presentation/components/doc/DocBlocks';
import { docGroups } from '@/presentation/components/doc/schemaFields';
import { snippets } from '@/presentation/components/doc/snippets';
import { DocPageHeader } from './DocLayout';

export const DocAnimations = () => (
  <>
    <Seo
      title="Animations & images — template descriptor"
      description="Animated (APNG / WebM) and still-image overlays composited over a section: formats, position, scale, loop and keep-last-frame."
      path="/doc/animations"
    />

    <DocPageHeader kicker="Schema-driven" title="Animations & images">
      <Code>inputs[]</Code> composites overlays — animated borders, light sweeps, confetti, or still images like a logo
      or branded backdrop — on top of a section. Each input is one file (<Code>type: "animation"</Code> or{' '}
      <Code>type: "image"</Code>) the engine overlays over the section video, in array order.
    </DocPageHeader>

    <DocSection id="formats" title="Formats" kicker="single-file">
      <Prose className="mb-5">
        <p>
          An animation is one single-file animated input. <Code>APNG</Code> and <Code>WebM</Code> (VP9 with alpha) are
          the two recommended formats — APNG decodes natively on every platform (incl. on-device) with lossless alpha;
          WebM is much smaller. <Code>.webp</Code> and <Code>.gif</Code> also work. The file's own frame rate governs
          playback, so <Code>options.fps</Code> is informational. A <Code>type: "image"</Code> input is a still picture
          (PNG/JPG/WebP) held for the whole section — same <Code>position</Code>/<Code>scale</Code> placement, no
          playback fields. Stack several <Code>inputs[]</Code> to layer overlays.
        </p>
      </Prose>
      <RefTable
        id="input-fields"
        title="inputs[]"
        summary="One animated overlay composited over the section video."
        rows={docGroups.inputs()}
      />
    </DocSection>

    <DocSection id="options" title="Overlay options" kicker="`inputs[].options`">
      <Prose className="mb-5">
        <p>
          <Code>position</Code> places the overlay (<Code>x:y</Code> output px) and <Code>scale</Code> sizes it (
          <Code>w:h</Code>, with <Code>-1</Code> to keep aspect). <Code>opacity</Code> fades the whole overlay (
          <Code>0</Code>–<Code>1</Code>; <Code>1</Code> or omitted is fully opaque).
        </p>
        <p>
          The <strong>playback extent</strong> is exactly one of <Code>loop</Code> (forever), <Code>loops</Code> (a
          finite play count), or <Code>duration</Code> (seconds) — precedence <Code>duration</Code> &gt;{' '}
          <Code>loops</Code> &gt; <Code>loop</Code>. <Code>start</Code> delays the overlay before it appears (seconds,
          default 0). <Code>persistent</Code> freezes the last frame once the overlay ends instead of letting the video
          show through. A draw-in that plays once and holds uses <Code>loops: 1</Code> + <Code>persistent: true</Code>;
          a continuous effect (confetti, a glow) uses <Code>loop: true</Code>.
        </p>
      </Prose>
      <RefTable
        id="input-options-fields"
        title="inputs[].options"
        summary="Placement (position/scale/opacity) and playback (loop / loops / duration, start, persistent) for one overlay."
        rows={docGroups.inputOptions()}
      />
      <Sample code={snippets.animation} title="A draw-in border over an image background" />
    </DocSection>

    <DocSection id="whole-video" title="Whole-video animations" kicker="`global.animations`">
      {/* `<wbr />` after each slash below: the slash-joined option names otherwise form one unbreakable
          run that pushes a phone-width page into sideways scroll. */}
      <Prose className="mb-5">
        <p>
          A section <Code>inputs[]</Code> overlay restarts at every section. To run an overlay{' '}
          <strong>continuously across the whole video</strong> — a border that holds through intro → clip → outro, a
          drifting light leak, a grain layer — declare it under <Code>global.animations[]</Code> instead. The engine
          composites these once over the <strong>final joined video</strong> (after sections are concatenated, before
          music is mixed), so the same mechanism that lets music span the whole video lets an animation span it too.
          Each entry takes the same <Code>position</Code>/<wbr />
          <Code>scale</Code>/<wbr />
          <Code>opacity</Code>/<wbr />
          <Code>rotation</Code>/<wbr />
          <Code>loop</Code>/<wbr />
          <Code>persistent</Code> options as a section overlay, minus <Code>name</Code>/<wbr />
          <Code>type</Code>. A whole-video overlay sits above every section; the builder edits these in its{' '}
          <strong>Style &amp; audio</strong> step.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="recipes" title="Six composited effect recipes">
      <Prose>
        <p>
          These landscape examples use the same six native APNG recipes as the app. Each combines two finite overlays:
          interface-focus, product-spotlight, celebration-burst, focus-lock, light-pass and frame-reveal. Copy the
          inputs into your own scene and adjust position, scale, opacity, start and duration around the actual action.
        </p>
        <p>
          These coordinates target 1280×720. Rebuild placement for portrait/square; start is seconds, duration is
          playback extent, not speed, and fps does not retime APNG frame delays. Set persistent explicitly; a frozen
          ring or light sweep can obscure footage. See the{' '}
          <a href="https://github.com/heristop/leclap/blob/main/examples/overlay-effects/README.md">recipe guide</a> and
          <Link to="/doc/reference#complete-field-index"> complete field index</Link> for all overlay controls.
        </p>
      </Prose>
      {recipeFixture.sections.map((section) => (
        <details key={section.name} className="rounded-xl border border-divider p-4">
          <summary className="cursor-pointer font-mono text-sm text-foreground">{section.name}</summary>
          <JsonBlock code={JSON.stringify({ inputs: section.inputs }, null, 2)} />
        </details>
      ))}
    </DocSection>

    <Tip className="mt-8">
      The builder ships a library of ready-made overlays (and accepts your own <Code>.apng</Code> / <Code>.webm</Code>{' '}
      animation or image uploads). Add as many animations and images as you like to a section, then drag each one to
      position and resize it right on the preview frame — so most templates never hand-write an <Code>inputs[]</Code>{' '}
      block.
    </Tip>
  </>
);
