// The formats vocabulary for agents (motionCatalog().formats): syntax, merge rules and art direction.

export const FORMATS_ART_DIRECTION =
  'One story, separate compositions: when a video ships in several orientations, declare `formats` and ' +
  'recompose each one instead of cropping. Vertical (portrait) = fewer simultaneous elements, larger type, ' +
  'a stronger top-to-bottom hierarchy and its own camera path; square = tighter typography and shorter holds. ' +
  'Keep the same sections in the same order in every format; drop a beat with remove rather than reordering.';

export const FORMATS_GUIDE = {
  formats: ['landscape', 'portrait', 'square'],
  syntax: {
    formats:
      '{ "formats": { "portrait": { "global": { …patch… }, "sections": { "<section name>": { …patch… } } } } } ' +
      'at the descriptor top level (it patches both global and sections, so it sits beside them).',
    marker:
      '{ "$format": { "landscape": v, "portrait": v, "square": v, "default": v } } in place of any value: ' +
      'resolves to the rendering format, else default.',
    select:
      'The format is the output orientation: ProjectConfig.format, `leclap render --format portrait`, ' +
      '`--formats all|landscape,portrait` (one <output>-<format>.mp4 each), compose_video { format }; ' +
      'otherwise global.orientation or the global.platform default.',
  },
  merge: [
    'Objects merge key by key; arrays and scalars replace; null deletes a key.',
    'sections.<name>: { "remove": true } drops that section in this format.',
    'Arrays with ids (kinetic, graphics, filters): { "byId": { "<id>": { …patch… } } } patches elements in place; ' +
      '{ "<id>": { "remove": true } } drops one; any other array value replaces the whole array.',
    'Markers resolve first, then the format patch applies, then markers inside the patch resolve.',
    'global.orientation is always the format; set global.platform per format for its safe zones.',
  ],
  validation: [
    'Every declared format (the base one, each formats key, each format a marker names) is validated ' +
      'separately; a finding only some formats raise names them: "[portrait] …".',
    'format_crop_only: a declared format with no overrides at all (a crop, not a composition).',
    'format_story_diverges: a format whose sections differ from the base story beyond explicit removals.',
  ],
  artDirection: FORMATS_ART_DIRECTION,
};
