import { Link } from 'react-router-dom';
import { Seo } from '@/presentation/components/Seo';
import { Callout, Code, DefList, DocSection, Prose } from '@/presentation/components/doc/DocBlocks';
import { webMcpTools, type WebMcpToolKind } from '@/presentation/components/doc/webmcpDocs';
import { DocPageHeader } from './DocLayout';

// The browser-agent (WebMCP) reference. The tool table lives in `webmcpDocs.ts`, checked against the
// builder's registry; docs/webmcp.md is the repo copy of this page.

const CONFIRM_LABEL = {
  never: 'No confirmation',
  'ask-before-edit': 'Confirmed when “Ask before every edit” is on',
  always: 'Always confirmed in the page',
} as const;

const countOf = (kind: WebMcpToolKind): string => String(webMcpTools.filter((tool) => tool.kind === kind).length);

const TROUBLESHOOTING = [
  {
    term: 'No Agent button',
    children:
      'The browser exposes no document.modelContext. Turn on the flag or use a deployment with the origin trial, over HTTPS or localhost.',
  },
  {
    term: 'The agent sees no tools',
    children:
      'The switch is off, or you left the builder: tools exist only while a builder page is open with the switch on.',
  },
  {
    term: 'Some tools could not be registered',
    children: 'The browser refused those names (a duplicate, or a policy refusal). The other tools still work.',
  },
  {
    term: 'needs_user_attention',
    children: 'The tab is in the background. Bring it to the front and ask the agent to retry.',
  },
  {
    term: 'revision_conflict',
    children:
      'The draft changed since the agent read it, often by your own edit. The agent reads it again and retries.',
  },
  {
    term: 'render_frames → not_found',
    children: 'It reads the agent’s own open preview: allow a render_preview first and keep its dialog open.',
  },
];

const toolRows = webMcpTools.map((tool) => ({
  term: tool.name,
  meta: `${tool.kind} · ${tool.args}`,
  children: (
    <>
      {tool.sharedWithMcp ? <strong className="text-accent-700 dark:text-accent-400">Shared with MCP. </strong> : null}
      {tool.purpose} {CONFIRM_LABEL[tool.confirm]}.
    </>
  ),
}));

export const DocWebMcp = () => (
  <>
    <Seo
      title="Browser agents (WebMCP) — drive the template builder"
      description="Let the AI agent built into your browser read, validate and edit a LeClap template in the builder through WebMCP: enabling it, the tools, confirmations, undo and security."
      path="/doc/webmcp"
    />

    <DocPageHeader kicker="The in-browser agent path" title="Browser agents (WebMCP)">
      The template builder registers its tools with your browser&apos;s agent through WebMCP. The agent reads the draft,
      validates it and edits it in place, each step undoable, using your browser&apos;s own model: the page holds no API
      key.
    </DocPageHeader>

    <DocSection id="enable" title="Turn it on" kicker="Chrome origin trial or flag">
      <Prose>
        <p>
          WebMCP exposes <Code>document.modelContext</Code> to pages. Chrome ships it behind an origin trial; for local
          work enable <Code>chrome://flags/#enable-webmcp-testing</Code>. Open the builder (
          <Link to="/studio/builder">Build from scratch</Link> or a template&apos;s editor): when the browser offers
          WebMCP an <strong>Agent</strong> button appears in the titlebar. Its drawer holds the switch “Let browser
          agents use this builder” (on by default), “Ask before every edit”, and the activity log with an Undo on each
          edit that is still current. Turning the switch off removes every tool at once.
        </p>
        <p>
          Then ask your browser&apos;s agent to work on the open template, for example “list the scenes, then set a
          darker theme”. Each call shows up under Recent activity, changed scene cards glow, and Ctrl/Cmd+Z undoes an
          agent edit like your own.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="tools" title="Tools" kicker={`${String(webMcpTools.length)} tools`}>
      <Prose>
        <p>
          {countOf('read')} read tools change nothing; {countOf('edit')} edit tools each land as one undo step;{' '}
          {countOf('consequential')} consequential tools need your OK in the page.
        </p>
        <p>
          Every edit checks <Code>expectedRevision</Code> (from <Code>get_template</Code>), is all-or-nothing, may not
          add validation errors and lands as one undo step, so Ctrl/Cmd+Z reverts it like your own edit. Fields the
          builder cannot hold are reported as <Code>dropped</Code>.
        </p>
      </Prose>
      <DefList rows={toolRows} />
    </DocSection>

    <DocSection id="confirm" title="Confirmations" kicker="Nothing consequential runs unseen">
      <Prose>
        <p>
          Replacing the draft, opening a sample, rendering a preview and saving always wait for your answer in the page;
          Cancel has the focus, and dismissing or ignoring the dialog for two minutes declines (the agent hears{' '}
          <Code>user_declined</Code>). A preview render shows its estimated time and can be allowed for the rest of the
          session; it runs one at a time, at most every 30 seconds. While the tab is in the background these tools
          answer <Code>needs_user_attention</Code> instead of opening a dialog you cannot see.{' '}
          <Code>render_frames</Code> asks nothing new: it only reads stills from a preview you already allowed.
        </p>
      </Prose>
      <Callout label="Filming stays yours">
        No tool films with real footage or uploads media: the agent asks you to click <strong>Save &amp; film</strong>.
      </Callout>
    </DocSection>

    <DocSection id="security" title="Security" kicker="Same origin, no secrets">
      <Prose>
        <p>
          Tools are registered for this origin only. Outputs never carry AI keys, upload file names, blob or data URLs;
          uploads stay opaque <Code>media://</Code> keys. Inputs are size-limited and rate-limited, agent text is
          sanitized, new media must be library ids or same-origin URLs, and template content is marked as untrusted data
          for the agent.
        </p>
      </Prose>
    </DocSection>

    <DocSection id="troubleshooting" title="Troubleshooting" kicker="When the agent cannot reach the builder">
      <DefList rows={TROUBLESHOOTING} />
    </DocSection>

    <DocSection id="compare" title="Which agent path" kicker="WebMCP, Generate with AI or MCP">
      <Prose>
        <p>
          <strong>Generate with AI</strong> is a one-shot generator in the builder with your own API key.{' '}
          <strong>WebMCP</strong> lets your browser&apos;s agent work incrementally on the open draft.{' '}
          <Link to="/doc/mcp">
            <Code>@leclap/mcp</Code>
          </Link>{' '}
          runs locally for desktop agents and renders final videos. Names they share (<Code>validate_template</Code>,{' '}
          <Code>edit_template</Code>, <Code>render_frames</Code>…) mean the same and agree on the template revision.
        </p>
      </Prose>
    </DocSection>
  </>
);
