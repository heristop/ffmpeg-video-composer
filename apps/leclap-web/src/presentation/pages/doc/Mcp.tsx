import { Link } from 'react-router-dom';
import { Seo } from '@/presentation/components/Seo';
import {
  Callout,
  Code,
  CommandList,
  CommandPill,
  DefList,
  DocSection,
  JsonBlock,
  Prose,
  Sample,
  Tip,
} from '@/presentation/components/doc/DocBlocks';
import { mcpDoc } from '@/presentation/components/doc/mcpDocs';
import { DocPageHeader } from './DocLayout';

// The MCP reference. The tool list, config table and sample configs live in `mcpDocs.ts`, which
// mirrors packages/leclap-mcp/README.md — tool names, config keys and defaults must match the
// server, so change them together.

const toolRows = mcpDoc.tools.map((tool) => ({
  term: tool.name,
  meta: tool.args,
  children: (
    <>
      {tool.optIn ? <strong className="text-accent-700 dark:text-accent-400">Opt-in. </strong> : null}
      {tool.purpose} {tool.when}
    </>
  ),
}));

const configRows = mcpDoc.config.map((entry) => ({
  term: `${entry.flag} · ${entry.env}`,
  meta: `default: ${entry.fallback}`,
  children: entry.detail,
}));

export const DocMcp = () => (
  <>
    <Seo
      title="MCP server — agent-callable video tools"
      description="Configure LeClap MCP for sample discovery, deterministic JSON effects and video rendering: tools, startup flags, environment variables, deadlines, cache and trusted Remotion setup."
      path="/doc/mcp"
    />

    <DocPageHeader kicker="The agent path" title="MCP server">
      <Code>@leclap/mcp</Code> exposes the engine as agent-callable tools. The agent is the LLM; the server helps it
      author a descriptor from the schema, then validates and renders it deterministically to an mp4.
    </DocPageHeader>

    <DocSection id="what" title="What it is" kicker="Authoring, not generating">
      <Prose>
        <p>
          The server includes <strong>48 packaged showcase samples</strong> with creative direction and input
          requirements. Discovery reads data only; rendering uses your media and the configured backend. Keep the
          descriptor, assets, fonts, configuration and runtime versions together for reproducibility. Different encoders
          and platforms can produce different bytes.
        </p>
        <p>
          It is the second front-end to the engine behind <Link to="/doc/cli">the CLI</Link>, over the same{' '}
          <Link to="/doc/schema">template descriptor</Link>. Anything you can hand-write as a <Code>template.json</Code>{' '}
          an agent can author here, and vice versa.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="tools" title="Tools" kicker={`${mcpDoc.tools.length} tools`}>
      <Prose>
        <p>
          Fourteen tools are always registered. Remotion opt-in adds <Code>get_effect_schema</Code>,{' '}
          <Code>render_preview</Code> and <Code>render_remotion_clip</Code>. Every argument below is the literal key the
          agent passes. Effect-prop edits do not bypass effect-backend validation.
        </p>
        <p>
          The web builder&apos;s <Link to="/doc/webmcp">browser-agent tools</Link> reuse five of these names (
          <Code>validate_template</Code>, <Code>edit_template</Code>, <Code>render_frames</Code>…) with the same meaning
          and the same template revision.
        </p>
      </Prose>
      <DefList rows={toolRows} />
      <Callout label="Typical flow">
        <Code>get_samples</Code> → <Code>get_samples</Code> with an <Code>id</Code> → inspect requirements and customize
        → <Code>validate_template</Code> → <Code>render_frames</Code> to look at the result and check safe zones →
        preview and edit registered effect props when needed → <Code>compose_video</Code> → open the returned{' '}
        <Code>outputPath</Code>.
      </Callout>
    </DocSection>

    <DocSection id="prompt" title="Guided prompt" kicker="`compose-video`">
      <Prose>
        <p>
          The server also ships a prompt, <Code>compose-video</Code>, which surfaces as <Code>/compose-video</Code> in
          clients like Claude Desktop. It takes optional <Code>goal</Code>, <Code>orientation</Code> and{' '}
          <Code>creativeDirection</Code> arguments and primes the agent with the schema, the building-block recipes
          (which filters give which look, the bundled fonts, the on-device filter allowlist) and the validate → compose
          loop.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="agentic-review" title="Agentic PR evidence" kicker="A review-ready recipe">
      <Prose>
        <p>{mcpDoc.agenticReview.intro}</p>
        <ol>
          {mcpDoc.agenticReview.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Prose>
      <Callout label="Upload boundary">{mcpDoc.agenticReview.uploadBoundary}</Callout>
      <Tip>
        Start from the runnable{' '}
        <a
          href="https://github.com/heristop/leclap/tree/main/examples/agentic-pr-video"
          target="_blank"
          rel="noopener noreferrer"
        >
          agentic PR video example
        </a>
        , then replace its walkthrough and fields with safe evidence from the change under review.
      </Tip>
    </DocSection>

    <DocSection id="run" title="Run it" kicker="stdio">
      <CommandList>
        <CommandPill command="npx -y @leclap/mcp" label="published — no checkout needed" />
        <CommandPill
          command="node packages/leclap-mcp/dist/index.js"
          label="from a checkout, after building the engine and the server"
        />
        <CommandPill
          command="npx @modelcontextprotocol/inspector node packages/leclap-mcp/dist/index.js"
          label="poke the tool surface by hand in the MCP Inspector"
        />
      </CommandList>
      <Prose>
        <p>
          The published binary is <Code>leclap-mcp</Code>. It speaks MCP over stdio, where stdout is the protocol
          channel — every diagnostic goes to stderr, including render progress (
          <Code>[compose_video] render &lt;id&gt; NN%</Code>).
        </p>
      </Prose>
    </DocSection>

    <DocSection id="configuration" title="Configuration" kicker="Flags and env">
      <Prose>
        <p>
          Each setting resolves in one order: <strong>CLI flag → environment variable → default</strong>. Directories
          are resolved to absolute paths at start-up. Supplied tilde paths are not expanded; use absolute paths.
        </p>
      </Prose>
      <DefList rows={configRows} />
      <Prose>
        <p>
          These are server settings, separate from template JSON and the library&apos;s <Code>ProjectConfig</Code>.
          <Code>compose_video</Code> binds <Code>fields</Code>, <Code>userVideoPaths</Code> and <Code>locale</Code>; it
          uses the media directory as the asset root and creates one build folder per render. Set orientation and fps in{' '}
          <Code>template.global</Code>. Codec and quality overrides use the library API.
        </p>
        <p>
          One registered-effect preflight or render job runs at a time, with at most eight waiters. Queue wait,
          preflight and worker setup/render have separate deadlines. Preflight probes sequentially and reuses results
          for the same real file within a request. Cancellation kills active probes before releasing the queue slot.
          Cache hits still perform staging and bundling; final FFmpeg assembly also runs.
        </p>
        <p>
          The full{' '}
          <a href="https://github.com/heristop/leclap/blob/main/docs/engine-configuration.md">
            engine configuration reference
          </a>{' '}
          covers output precedence, encoder defaults and platform limits.
        </p>
      </Prose>
      <Callout label="Containment">
        Local input paths — <Code>userVideoPaths</Code>, <Code>probe_media</Code>, <Code>extract_style</Code>,{' '}
        <Code>analyze_music</Code> and <Code>transcribe_media</Code> — must resolve inside the media dir. The check is
        symlink-safe, so a link pointing outside is rejected rather than followed. Remote template URLs are SSRF-guarded
        (http(s) only, private and metadata IPs and redirects blocked), and FFmpeg is invoked through{' '}
        <Code>execFile</Code>, never a shell.
      </Callout>
    </DocSection>

    <DocSection id="claude-desktop" title="Claude Desktop" kicker="`claude_desktop_config.json`">
      <Prose>
        <p>
          Add the server to <Code>~/Library/Application Support/Claude/claude_desktop_config.json</Code> (
          <Code>%APPDATA%\Claude\</Code> on Windows):
        </p>
      </Prose>
      <JsonBlock code={mcpDoc.sampleConfig} />
      <Tip>
        Use absolute paths — env values are not tilde-expanded. From a checkout, swap the command for <Code>node</Code>{' '}
        and point it at <Code>packages/leclap-mcp/dist/index.js</Code>.
      </Tip>
      <Prose>
        <p>
          Then ask for a video in plain language and the agent fetches the schema, authors a descriptor, validates it
          and renders. Or ask it to list app demos, retrieve a sample, replace its copy and bind your recording.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="project-scoped" title="Project-scoped wiring" kicker="`.mcp.json`">
      <Prose>
        <p>
          For a per-project server — the shape Claude Code and Cursor read — let the CLI write it:{' '}
          <Code>leclap init my-video --mcp</Code> drops a <Code>.mcp.json</Code> beside the template, with the media dir
          scoped to the project instead of your home directory. Adding <Code>--remotion</Code> also scaffolds a{' '}
          <Code>remotion/</Code> starter and sets the entry and the opt-in:
        </p>
      </Prose>
      <Sample title=".mcp.json written by leclap init --mcp --remotion" code={mcpDoc.projectConfig} />
      <Callout label="Absolute paths">
        The generated env paths are absolute and belong to the machine that ran <Code>init</Code>. Move the project and
        you will need to regenerate or edit them.
      </Callout>
    </DocSection>

    <DocSection id="remotion" title="Remotion intros" kicker="Optional, bring your own">
      <Prose>
        <p>
          <Code>render_remotion_clip</Code> renders a composition from <em>your</em> Remotion project — spring physics
          and kinetic typography an FFmpeg filtergraph cannot express — to an mp4. Point it at an <Code>entry</Code>{' '}
          (the module that calls <Code>registerRoot</Code>) or a prebuilt <Code>serveUrl</Code>, plus a{' '}
          <Code>compositionId</Code> and optional <Code>inputProps</Code>. Feed the returned clip back to{' '}
          <Code>compose_video</Code> as a <Code>project_video</Code> and the engine composites it in front of your
          scenes.
        </p>
        <p>
          It needs the optional peer deps <Code>@remotion/renderer</Code> and <Code>@remotion/bundler</Code>, and is
          rendered on Node through headless Chromium. Native/browser hosts can compose the resulting clip but do not run
          React scenes locally. The <Link to="/doc/cli">CLI</Link> never needs it.
        </p>
      </Prose>
      <Tip>
        Because it bundles and executes JavaScript from your project, the tool is an arbitrary-code surface and is off
        by default. Register it with <Code>--allow-remotion</Code> or <Code>LECLAP_MCP_ALLOW_REMOTION=1</Code>, and only
        for a client you trust.
      </Tip>
      <Callout label="Registered JSON effects">
        Configure a trusted <Code>--remotion-entry</Code> and optional <Code>--effect-catalog</Code>, then discover
        strict versioned contracts through <Code>get_effect_schema</Code>. JSON controls props/assets, never source
        modules. The registered output contract is opaque H.264, landscape 1280×720, 30 fps and 300 frames; other
        orientations and frame rates are rejected. <Code>render_remotion_clip</Code> is a separate composition route.
      </Callout>
    </DocSection>

    <DocSection id="architecture" title="How a render is isolated" kicker="Forked worker">
      <Prose>
        <p>
          <Code>compose_video</Code> never compiles in the server process. The engine logs to stdout during a render,
          which would corrupt the JSON-RPC stream — so the render runs in a forked child worker and the result comes
          back over the IPC channel, never the child&apos;s stdout. That also buys clean error capture, the render
          timeout, and dependency-injection state isolation between renders.
        </p>
        <p>
          The result is returned as a <Code>resource_link</Code> pointing at the file rather than megabytes of inlined
          base64: the client opens or fetches it from <Code>&lt;output-dir&gt;/&lt;renderId&gt;/</Code>.
        </p>
      </Prose>
    </DocSection>
  </>
);
