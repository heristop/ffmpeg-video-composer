// The single shared template-editor model consumed by BOTH apps (web Builder + expo
// create-template). See ./templateEditorModel for the editor-friendly section model and its
// bidirectional mapping to a core TemplateDescriptor. Pure — no React/DOM/RN dependency.
export * from './templateEditorModel';

// Pure, UI-free field-level helpers shared by both apps' editors.
export * from './speed-rate';
export * from './capture-modes';
export * from './overlay-flip';

// Generic JSON-schema walker primitives (web docs + control-metadata both build on these) and the
// schema-derived control-metadata registry for the six parity features.
export * from './schema-walk';
export * from './control-metadata';

// `panel:` overlay URL round trip (parse from the engine, build here) for the rounded caption panel
// backdrop customization UI.
export * from './panel-url';

// Curated animation defaults and portable overlay effect recipes shared by both app editors.
export * from './animation-presets';

// The animation library (engine primitives first, legacy APNG samples last), the placement a pick
// inserts, and the schema-derived parameter panel of a library graphic.
export * from './animation-library';
export * from './fx-draft';
export * from './fx-params';
