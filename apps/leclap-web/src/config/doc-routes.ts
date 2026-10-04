// English-only routes: the template-descriptor reference and the design system. They get a single
// canonical URL at the root and no hreflang — their body content isn't translated, so a localized
// wrapper around English content would only be indexed as a near-duplicate.
//
// Kept apart from site.ts because this is ~100 lines of build-time <head> copy that only
// scripts/seo-prerender.ts and the drift test read. site.ts is imported by the app bundle; this file
// must not be, so the copy never ships to a visitor. Same import rules as site.ts apply (no runtime
// imports, erasable syntax only) — the prerender script loads it as `../src/config/doc-routes.ts`.

export type DocRoute = {
  path: string;
  title: string;
  description: string;
  priority: string;
  changefreq: string;
};

export const DOC_ROUTES: readonly DocRoute[] = [
  {
    path: '/doc',
    title: 'Template descriptor — overview',
    description:
      'What the LeClap template descriptor is, the two layers you compose with, how rendering chooses its path, and how to get started with the CLI.',
    priority: '0.7',
    changefreq: 'monthly',
  },
  {
    path: '/doc/sections',
    title: 'Sections & types — template descriptor',
    description:
      'LeClap section types, including registered JSON effects, shared native fields, reusable partials and per-section options.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/transitions',
    title: 'Transitions — template descriptor',
    description:
      'The full live catalogue of LeClap transition types — every xfade name plus cut — and the transition field reference.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/looks',
    title: 'Looks — template descriptor',
    description:
      'The named colour-grade presets a LeClap section can apply via the look field, and how they combine with a manual grade.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/grade',
    title: 'Colour grade — template descriptor',
    description:
      'The manual colour-grade controls — brightness, contrast, saturation, gamma, hue, per-range colour balance, blur and curves — layered on top of any look.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/motion',
    title: 'Motion & layers — template descriptor',
    description:
      'Per-section motion effects (Ken Burns, rotate, crop, flip, shake, pulse), the recording framing guide, and composited background layers.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/audio',
    title: 'Audio — template descriptor',
    description:
      'The final-mix audio settings — source and music volumes, normalisation, ducking — plus per-section fade curves.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/captions',
    title: 'Captions — template descriptor',
    description:
      'The caption sugar — localized text drawn over a section — and its style, position and alignment options.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/animations',
    title: 'Animations & images — template descriptor',
    description:
      'Animated (APNG / WebM) and still-image overlays composited over a section: formats, position, scale, loop and keep-last-frame.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/filters',
    title: 'Filters & maps — template descriptor',
    description:
      'The raw FFmpeg escape hatch: pass filter names and arguments through verbatim, and wire explicit filtergraph maps for full control.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/examples',
    title: 'Examples — template descriptor',
    description: 'Copy-paste LeClap template descriptors you can save as JSON and render with the CLI.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/schema',
    title: 'JSON Schema — template descriptor',
    description:
      'The full machine-readable JSON Schema for the LeClap template descriptor, for editor tooling and validation.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/cli',
    title: 'Command line — LeClap CLI',
    description:
      'Scaffold a LeClap project and render a template descriptor to mp4 from your terminal: init, render, validate, diagnose, every render flag, and how FFmpeg is resolved.',
    priority: '0.7',
    changefreq: 'monthly',
  },
  {
    path: '/doc/mcp',
    title: 'MCP server — agent-callable video tools',
    description:
      'Expose the LeClap engine to an AI agent over MCP: sample discovery, effect contracts, preview and composition tools and their arguments, the authoring loop, every flag and env var, containment rules, and wiring it into Claude Desktop or a project .mcp.json.',
    priority: '0.7',
    changefreq: 'monthly',
  },
  {
    path: '/doc/reference',
    title: 'Template configuration — LeClap reference',
    description:
      'Every native template feature, field, timing rule and example, with a complete schema-derived field index.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/effects',
    title: 'Registered effects — LeClap reference',
    description:
      'Every built-in and example catalog effect: props, defaults, bounds, asset slots, timing, registration, preview and reproducibility.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/engine',
    title: 'Engine configuration — LeClap reference',
    description:
      'ProjectConfig, encoder tiers, configuration precedence, CLI bindings, MCP runtime settings and platform limits.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/doc/creative-direction',
    title: 'Creative direction — LeClap reference',
    description:
      'Turn a visual brief into explicit, validated motion settings; discover samples and inspect the rendered result.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/design',
    title: 'Design System',
    description: 'The LeClap design system — colors, typography, motion and UI components.',
    priority: '0.6',
    changefreq: 'monthly',
  },
];
