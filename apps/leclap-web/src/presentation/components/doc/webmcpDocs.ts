// The browser-agent (WebMCP) reference data behind /doc/webmcp. Mirrors the builder's tool layer
// (src/application/usecases/webmcp): names, kinds and confirmation policies must match the registry —
// webmcpDocs.test.ts checks them — so change them together, along with docs/webmcp.md.
import type { BuilderToolName } from '@/application/usecases/webmcp/tool-names';

export type WebMcpToolKind = 'read' | 'edit' | 'consequential';
export type WebMcpConfirm = 'never' | 'ask-before-edit' | 'always';

export interface WebMcpToolDoc {
  name: BuilderToolName;
  kind: WebMcpToolKind;
  confirm: WebMcpConfirm;
  /** The tool's input arguments; `?` marks an optional one. */
  args: string;
  purpose: string;
  /** Same name and meaning on @leclap/mcp. */
  sharedWithMcp?: boolean;
}

const EDIT = { kind: 'edit', confirm: 'ask-before-edit' } as const;
const READ = { kind: 'read', confirm: 'never' } as const;
const ASK = { kind: 'consequential', confirm: 'always' } as const;

export const webMcpTools: readonly WebMcpToolDoc[] = [
  {
    name: 'get_template',
    ...READ,
    args: 'includeEditorState?',
    purpose: 'The current descriptor (uploads redacted) with its revision, name, partials and editor state.',
  },
  {
    name: 'list_sections',
    ...READ,
    args: '—',
    purpose: 'Scenes in timeline order: position, pointer, timing, transition, on-screen texts and error count.',
  },
  {
    name: 'get_template_schema',
    ...READ,
    args: 'pointer?',
    purpose: 'Builder guide plus the descriptor JSON Schema, sliced by JSON Pointer.',
    sharedWithMcp: true,
  },
  {
    name: 'get_motion_catalog',
    ...READ,
    args: 'query?, kind?',
    purpose: 'Motion presets, themes and doctrine, or ranked matches.',
    sharedWithMcp: true,
  },
  {
    name: 'list_samples',
    ...READ,
    args: 'category?, backend?, query?',
    purpose: 'Packaged samples, each flagged openable when the builder can hold it.',
  },
  {
    name: 'get_sample',
    ...READ,
    args: 'id',
    purpose: 'One sample with its self-contained descriptor.',
  },
  {
    name: 'validate_template',
    ...READ,
    args: 'template?',
    purpose: 'Render-free validation in the MCP shape, with motion and geometry advisories.',
    sharedWithMcp: true,
  },
  {
    name: 'get_timeline',
    ...READ,
    args: 'template?, format?',
    purpose: 'Whole-video timeline: sections, motion events, beats and cues.',
  },
  {
    name: 'select_section',
    ...READ,
    args: 'name? | position?',
    purpose: 'Selects a scene so the user sees it; never changes the template.',
  },
  {
    name: 'edit_template',
    ...EDIT,
    args: 'expectedRevision, operations, note?',
    purpose: 'JSON Patch (RFC 6902) over the descriptor, atomic, one undo step.',
    sharedWithMcp: true,
  },
  {
    name: 'add_section',
    ...EDIT,
    args: 'expectedRevision, type, position?, section?, note?',
    purpose: 'Inserts a scene with builder defaults, optionally merged with a fragment.',
  },
  {
    name: 'remove_section',
    ...EDIT,
    args: 'expectedRevision, name? | position?, note?',
    purpose: 'Removes one scene.',
  },
  { name: 'move_section', ...EDIT, args: 'expectedRevision, from, to, note?', purpose: 'Moves one scene.' },
  {
    name: 'set_texts',
    ...EDIT,
    args: 'expectedRevision, edits, note?',
    purpose: 'Replaces on-screen copy at the pointers list_sections reports.',
  },
  {
    name: 'undo',
    kind: 'edit',
    confirm: 'never',
    args: '—',
    purpose: 'Reverts the agent’s own last step while it is still the present state.',
  },
  {
    name: 'set_theme',
    ...EDIT,
    args: 'expectedRevision, theme, note?',
    purpose: 'A built-in theme name, a theme object, or null.',
  },
  {
    name: 'set_format',
    ...EDIT,
    args: 'expectedRevision, orientation?, platform?, note?',
    purpose: 'Orientation and delivery platform.',
  },
  {
    name: 'set_music',
    ...EDIT,
    args: 'expectedRevision, tracks?, allowUpload?, musicVolume?, sourceVolume?, ducking?, note?',
    purpose: 'Library tracks, upload, volumes and ducking.',
  },
  {
    name: 'replace_template',
    ...ASK,
    args: 'template, name?, note?',
    purpose: 'Replaces the whole draft with a valid descriptor; Undo brings the previous one back.',
  },
  {
    name: 'load_sample',
    ...ASK,
    args: 'id, theme?, note?',
    purpose: 'Opens an openable sample as a new draft; Undo brings the previous one back.',
  },
  {
    name: 'render_preview',
    ...ASK,
    args: 'note?',
    purpose: 'Renders the draft in the browser (placeholder media) into the page’s preview dialog; once per 30 s.',
  },
  {
    name: 'render_frames',
    kind: 'consequential',
    confirm: 'never',
    args: 'at',
    purpose: 'Experimental: up to 4 JPEG stills of the agent’s own open preview, covered by its consent.',
    sharedWithMcp: true,
  },
  {
    name: 'save_template',
    ...ASK,
    args: 'note?',
    purpose: 'Saves to the template library on this device; reports what blocks saving.',
  },
];
