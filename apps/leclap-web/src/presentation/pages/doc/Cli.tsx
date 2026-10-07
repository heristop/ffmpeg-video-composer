import { Link } from 'react-router-dom';
import { Seo } from '@/presentation/components/Seo';
import {
  Callout,
  Code,
  CommandList,
  CommandPill,
  CliGetStarted,
  DefList,
  DocSection,
  Prose,
  Tip,
} from '@/presentation/components/doc/DocBlocks';
import { DocPageHeader } from './DocLayout';

// The CLI reference. Everything here mirrors packages/leclap-cli (src/index.ts and the command
// definitions under src/commands) — when a command, flag or resolution order changes there, it
// changes here.

// `leclap render` flags, in the order the command declares them. `meta` carries the short alias and
// the default, so the shape stays flag · alias/default · meaning.
const RENDER_FLAGS = [
  { term: '--output <path>', meta: '-o', children: 'Copy the finished mp4 somewhere else once the render succeeds.' },
  {
    term: '--field key=value',
    meta: 'repeatable',
    children: (
      <>
        Set a template variable or form value — the <Code>{'{{ placeholders }}'}</Code> in the descriptor.
      </>
    ),
  },
  {
    term: '--set name=value',
    meta: 'repeatable',
    children: (
      <>
        Fill a typed input the template declares in <Code>global.fields</Code>, checked against its type before the
        render starts.
      </>
    ),
  },
  {
    term: '--video section=path',
    meta: 'repeatable',
    children: (
      <>
        Supply the clip for a <Code>project_video</Code> section. Paths resolve against the working directory.
      </>
    ),
  },
  { term: '--locale <code>', meta: 'e.g. en, fr', children: 'Pick which translation of the localised text to draw.' },
  {
    term: '--orientation <value>',
    meta: 'landscape | portrait | square',
    children: (
      <>
        Override <Code>global.orientation</Code> for this render. A typo fails fast, before the compile starts.
      </>
    ),
  },
  {
    term: '--format <name>',
    meta: 'landscape | portrait | square',
    children: (
      <>
        Render one composition of a template that declares <Code>formats</Code>: its override and <Code>$format</Code>{' '}
        values apply.
      </>
    ),
  },
  {
    term: '--formats <list>',
    meta: 'all | landscape,portrait,…',
    children: (
      <>
        Render several formats, each to <Code>&lt;output&gt;-&lt;format&gt;.mp4</Code>; <Code>all</Code> renders every
        declared one.
      </>
    ),
  },
  { term: '--assets <dir>', meta: 'default: ./assets', children: 'Where the render reads media from.' },
  { term: '--build <dir>', meta: 'default: ./build', children: 'Where the render writes its output.' },
  {
    term: '--watch',
    meta: 'default: off',
    children: 'Re-render whenever the template or the assets it references change.',
  },
  { term: '--quiet', meta: '-q', children: 'Print only the final result line — no progress.' },
  {
    term: '--json',
    meta: 'default: off',
    children: (
      <>
        Emit a machine-readable result on stdout. Failures use the same shape (<Code>{'{ ok: false, error }'}</Code>)
        and still exit non-zero, so a script can parse one stream either way.
      </>
    ),
  },
  { term: '--verbose', meta: 'default: off', children: "Stream the underlying engine's own logs." },
] as const;

export const DocCli = () => (
  <>
    <Seo
      title="Command line — LeClap CLI"
      description="Discover LeClap samples, scaffold a project, bind media and copy, validate and render JSON templates with the CLI. Includes render flags and FFmpeg configuration."
      path="/doc/cli"
    />

    <DocPageHeader kicker="The human path" title="Command line">
      <Code>@leclap/cli</Code> is the manual front-end to the engine: write a <Code>template.json</Code>, drop media in{' '}
      <Code>assets/</Code>, render an mp4. <Code>init</Code> exists to take you from nothing to a first render in one
      command.
    </DocPageHeader>

    <DocSection id="quick-start" title="Quick start" kicker="One command to a first render">
      <CliGetStarted />
    </DocSection>

    <DocSection id="commands" title="Commands" kicker="Core verbs">
      <CommandList>
        <CommandPill command="leclap init [name]" label="scaffold a starter project that renders as-is" />
        <CommandPill command="leclap render <template>" label="compile a video from a template JSON" />
        <CommandPill
          command="leclap validate <template>"
          label="check a template against the schema and its text geometry, without rendering"
        />
        <CommandPill
          command="leclap snapshot <template>"
          label="render still frames and contact sheets of chosen moments, to look at the result"
        />
        <CommandPill command="leclap timeline <template>" label="where every section, element, beat and cue sits" />
        <CommandPill
          command="leclap resolve <template>"
          label="the descriptor a render would see, with its fields filled"
        />
        <CommandPill command="leclap style <reference>" label="derive a theme and style guide from an image or clip" />
        <CommandPill
          command="leclap beats <audio>"
          label="measure a track's tempo, beat grid and drop for global.beats"
        />
        <CommandPill
          command="leclap diagnose"
          label="report which FFmpeg your environment provides and what it can render (--json)"
        />
        <CommandPill command="leclap samples list" label="discover packaged showcase samples and requirements" />
      </CommandList>
      <Prose>
        <p>
          <Code>leclap template.json</Code> is shorthand for <Code>leclap render template.json</Code> — any first
          argument that is not a known verb or a flag is treated as a template path. A render reads media from{' '}
          <Code>&lt;cwd&gt;/assets</Code> and writes output under <Code>&lt;cwd&gt;/build</Code>.
        </p>
        <p>
          <Code>leclap --help</Code> and <Code>leclap --version</Code> print the root screen; every subcommand has its
          own <Code>leclap &lt;command&gt; --help</Code>.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="samples" title="Discover samples" kicker="Packaged JSON">
      <CommandList>
        <CommandPill
          command="leclap samples list --backend native --category app-demos"
          label="find a native app demo"
        />
        <CommandPill
          command="leclap samples show web-app-promo"
          label="inspect direction, clip names, copy and assets"
        />
        <CommandPill
          command="leclap samples export web-app-promo --output promo.json"
          label="export JSON to a new file"
        />
      </CommandList>
      <Prose>
        <p>
          The 47 samples are discoverable without FFmpeg or Remotion. Supply or replace their listed media and fonts;
          preview videos are not packaged. Partials are embedded in exports. Use repeatable <Code>--video</Code> and{' '}
          <Code>--field</Code> flags for the sample&apos;s required bindings. Registered-effect samples render through
          the configured <Link to="/doc/mcp">MCP backend</Link>, not directly through <Code>leclap render</Code>.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="render" title="Rendering" kicker="`render`">
      <Prose>
        <p>
          <Code>render</Code> loads the descriptor, resolves FFmpeg, and compiles the sections in order. Everything a
          template leaves open — variables, the clips for <Code>project_video</Code> sections, the locale, the
          orientation, where media comes from and where the mp4 lands — is a flag, so the same{' '}
          <Code>template.json</Code> can produce a whole family of videos:
        </p>
      </Prose>
      <CommandList>
        <CommandPill
          command="leclap render template.json --field title=Summer --video intro=clips/intro.mp4"
          label="fill a variable and supply a clip"
        />
        <CommandPill
          command="leclap render template.json --orientation portrait -o out/reel.mp4"
          label="re-cut the same template vertically, into a named file"
        />
        <CommandPill
          command="leclap render story.json --formats all -o story.mp4"
          label="render every declared format of a template, one mp4 each"
        />
        <CommandPill command="leclap render template.json --watch" label="re-render on every edit while you author" />
        <CommandPill command="leclap render template.json --json --quiet" label="one parseable line, for CI" />
      </CommandList>
      <DefList rows={RENDER_FLAGS} />
      <Callout label="Host configuration">
        Paths resolve from the working directory. <Code>--orientation</Code> overrides descriptor{' '}
        <Code>global.orientation</Code>; frame rate comes from <Code>global.fps</Code>. The published CLI has no codec,
        quality-tier or segment-concurrency flags. Those use the library&apos;s <Code>ProjectConfig</Code>, documented
        in the{' '}
        <a href="https://github.com/heristop/leclap/blob/main/docs/engine-configuration.md">
          engine configuration reference
        </a>
        .
      </Callout>
      <Tip>
        <Code>validate</Code> takes the same template and the same <Code>--json</Code> flag, but never touches FFmpeg —
        it is the fast check to run in a pre-commit hook or before a long render. Beyond the schema, it reads where the
        renderer will draw every piece of text and warns about text that runs off the frame or out of title-safe,
        collides with other text, sits under a band, is too small, lacks contrast, or sits over footage with no box,
        outline or shadow. Those warnings are advisory: they never change the exit code, so the command stays usable as
        a CI gate. On a published install it may fetch fonts from the LeClap catalog to measure them; offline, widths
        are estimated and marked as such. Add <Code>--render</Code> to render the sections that hold text and measure
        their contrast from real pixels — seconds rather than milliseconds, and it settles text over pictures, grades
        and looks.
      </Tip>
    </DocSection>

    <DocSection id="init" title="Scaffolding a project" kicker="`init`">
      <Prose>
        <p>
          <Code>init</Code> writes a project that renders immediately: a <Code>template.json</Code> that needs no
          external media, a <Code>package.json</Code> with a <Code>render</Code> script, a README and an{' '}
          <Code>assets/</Code> folder. It detects the package manager you invoked it with — npm, pnpm, yarn or bun — and
          prints that one&apos;s install and run commands. It then asks whether to also wire two optional pieces:
        </p>
        <ul>
          <li>
            <strong>the MCP server</strong> (default yes) — a project-scoped <Code>.mcp.json</Code> pointing at{' '}
            <Code>@leclap/mcp</Code>, so an agent can author and render inside this project;
          </li>
          <li>
            <strong>a Remotion starter</strong> (default yes) — a self-contained <Code>remotion/</Code> project with an{' '}
            <Code>Intro</Code> composition, for animated intros. Choosing it also switches the starter template to a
            two-section one, with a <Code>project_video</Code> intro slot in front of the title card.
          </li>
        </ul>
        <p>Flags skip the prompts, which is what you want in CI (a non-TTY also auto-defaults):</p>
      </Prose>
      <CommandList>
        <CommandPill command="leclap init my-video --yes" label="accept all defaults (MCP + Remotion)" />
        <CommandPill command="leclap init my-video --no-mcp --no-remotion" label="bare CLI-render starter" />
        <CommandPill command="leclap init my-video --mcp --no-remotion" label="MCP wiring, no Remotion" />
        <CommandPill
          command={
            'leclap init my-video --no-remotion --creative-direction "Screen first, short type entrances, readable CTA."'
          }
          label="store an authoring brief in template metadata; edit JSON settings to implement it"
        />
      </CommandList>
      <Callout label="Absolute paths">
        The generated <Code>.mcp.json</Code> records absolute env paths for the machine that created it — the media dir
        is scoped to the project rather than your home directory. Move the project and you will need to regenerate or
        edit them.
      </Callout>
    </DocSection>

    <DocSection id="ffmpeg" title="FFmpeg" kicker="Resolution order">
      <Prose>
        <p>
          The Node CLI detects system FFmpeg, then <Code>ffmpeg-static</Code>. It has no pure-Node WASM fallback.
          Templates that probe media also need <Code>ffprobe</Code>: system FFmpeg supplies it, while the static path
          needs optional <Code>ffprobe-static</Code> or a staged adjacent binary. Run <Code>leclap diagnose</Code> to
          inspect your environment. Browser hosts use the separate WASM entry.
        </p>
        <p>
          pnpm skips dependency build scripts unless they are approved, and since pnpm 11 it reads approvals only from{' '}
          <Code>pnpm-workspace.yaml</Code> — which is why the scaffold ships one with an <Code>allowBuilds</Code> entry
          for <Code>ffmpeg-static</Code> (and <Code>esbuild</Code>, for the Remotion bundler). Without it the binary
          never downloads and renders fail. npm, yarn and bun ignore the file.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="cli-or-mcp" title="CLI or MCP?" kicker="Two front-ends, one engine">
      <Prose>
        <p>
          Both drive the same engine and the same descriptor format. The CLI is the manual path — you write and render{' '}
          <Code>template.json</Code> yourself. The <Link to="/doc/mcp">MCP server</Link> is the agent path: an AI agent
          authors, validates and renders the same descriptors. A <Code>template.json</Code> produced by{' '}
          <Code>leclap init</Code> is equally usable by the MCP&apos;s <Code>compose_video</Code>, and{' '}
          <Code>leclap validate</Code> is the same check the MCP exposes as <Code>validate_template</Code>.
        </p>
      </Prose>
    </DocSection>
  </>
);
