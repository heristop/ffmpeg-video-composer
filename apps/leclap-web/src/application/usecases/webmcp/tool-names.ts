// The browser-agent tool names, in one dependency-free module so docs and the activity UI can list them
// without pulling the tool layer. Names shared with @leclap/mcp mean the same thing on both surfaces.

/** Read, reference, validate and undoable edits: always registered while the agent is on. */
export const CORE_TOOL_NAMES = [
  'get_template',
  'list_sections',
  'get_template_schema',
  'get_motion_catalog',
  'list_samples',
  'get_sample',
  'validate_template',
  'get_timeline',
  'select_section',
  'edit_template',
  'add_section',
  'remove_section',
  'move_section',
  'set_texts',
  'undo',
  'set_theme',
  'set_format',
  'set_music',
] as const;

/** Consequential actions, each behind a builder capability and an in-page confirmation. */
export const CONSEQUENTIAL_TOOL_NAMES = [
  'replace_template',
  'load_sample',
  'render_preview',
  'render_frames',
  'save_template',
] as const;

/** Every tool the template builder can register. */
export const BUILDER_TOOL_NAMES = [...CORE_TOOL_NAMES, ...CONSEQUENTIAL_TOOL_NAMES] as const;

export type BuilderToolName = (typeof BUILDER_TOOL_NAMES)[number];

/**
 * Names the builder shares with @leclap/mcp: same meaning and arguments where they overlap, same revision
 * contract. Deliberately absent: render_preview (on MCP it previews a registered effect), and list_samples,
 * get_sample and get_timeline, which MCP folded into get_samples and validate_template `include`.
 */
export const SHARED_WITH_MCP = [
  'get_template_schema',
  'get_motion_catalog',
  'validate_template',
  'edit_template',
  'render_frames',
] as const;
