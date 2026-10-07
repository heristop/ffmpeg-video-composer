// Feature exports of the Node entry, kept out of index.ts for its line budget: per-format compositions
// (core/formats), probed media traits, and music analysis (the platform-neutral analyzer, and decoding a file with FFmpeg first).
export * from './core/formats';
export { analyzeBeats, detectOnsets, MIN_CONFIDENCE, type BeatAnalysis, type MusicCues } from './core/audio/beats';
export { applyMusicAnalysis, beatsFromAnalysis, type MusicAnalysis } from './core/audio/apply-analysis';
export { analyzeMusicFile, type AnalyzeMusicOptions } from './services/beats-analysis-node';
export { decodeMonoPcm, ANALYSIS_SAMPLE_RATE } from './platform/ffmpeg/decode-pcm-node';
// Probed source traits (HDR transfer, bit depth, VFR, rotation), shared with the MCP probe_media tool.
export { mediaTraits, type ProbeVideoStream } from './core/footage/media-traits';
// The FFmpeg capability doctor (`leclap diagnose --json`, MCP get_capabilities).
export * from './platform/ffmpeg/capability-exports-node';
// Partial expansion with its advisories (partial_compressed) and structured failures.
export { expandPartialsReport, PartialError, type PartialFinding } from './core/partials';
// Frame snapshots, comparisons, the whole-video timeline and catalog search (services/snapshot-api-node.ts).
export * from './services/snapshot-api-node';
// Agent-facing helpers shared with @leclap/mcp and the web builder: RFC 6902 patches over a template and
// plain-text validation findings (template revisions come with core/determinism).
export {
  applyJsonPatch,
  parsePointer,
  JsonPatchError,
  JSON_PATCH_MAX_DEPTH,
  type ApplyJsonPatchOptions,
  type JsonPatchErrorCode,
  type JsonPatchOperation,
} from './core/json-patch';
export { findingLine, invalidTemplateText, summarizeErrors } from './services/validation-format';
// Sound synthesis (pure): render and measure a composed `sound` or a varied library preset (MCP analyze_sound).
export * from './core/audio/sound-api';
// Typed template fields (`global.fields`): coercion, resolution, advisories and the resolved descriptor.
export * from './core/fields';
export { fieldAdvisories } from './services/field-advisories';
export { resolveTemplate, type ResolvedTemplate } from './services/resolve-template';
export {
  FIELD_TYPES,
  FieldsSchema,
  type FieldType,
  type FieldSpec,
  type TemplateField,
  type FieldsDeclaration,
} from './schemas/fields.schemas';
