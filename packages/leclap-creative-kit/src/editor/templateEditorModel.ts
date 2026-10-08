// Shared, pure template-editor model consumed by BOTH apps (web + expo). This is the single
// source of truth for the editor-friendly section model and its bidirectional mapping to a core
// TemplateDescriptor. It carries NO React/DOM/RN dependency — only the core types + schemas in
// this same package — so the web Builder and the expo create-template screen can re-export it
// verbatim and stay in lock-step.
export * from './model';
export * from './font-label';
export * from './accent-bar';
export * from './countdown';
export * from './build-descriptor';
export * from './operations';
export * from './to-editor-state';
export * from './overlay-parsing';
export * from './overlay-filters';
export * from './starter-presets';
export * from './color-token';
export * from './html-layer';
