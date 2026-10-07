# Typed fields: a declared input contract for templates

> Status: phase 1 (engine, CLI, MCP, web form) delivered on `feat/typed-fields`; phases 2–3 proposed ·
> Scope: `ffmpeg-video-composer`, `@leclap/cli`, `@leclap/mcp`, `leclap-web`, `leclap-expo`.

## Why

A template is a function from inputs to a video, but nothing says what those inputs are.
`global.variables` is an untyped `string | string[]` map and form sections declare `{ name, maxLength,
label }`. A `{{ var }}` is replaced late, by string concatenation, wherever the variable manager happens to
look (text, URLs, a colour). So:

- a host cannot tell which values a template needs, nor which ones it can leave out;
- a number cannot go into a numeric slot (`options.duration` is a number, a placeholder is a string);
- a wrong value (`"#zzz"` as a colour, `"fast"` as a duration) surfaces as an FFmpeg error mid-render, or as
  a silently wrong frame;
- a misspelt placeholder renders literally as `{{ TITEL }}`.

Shotstack's merge fields have the same shape, a find-and-replace with no types. LeClap can do better because it
already owns a schema for every slot: substitute first, then let the slot's own schema judge the value.

## Shape

`global.fields` declares the contract, as a map (name → spec) or an array of `{ name, … }`:

```json
"global": {
  "fields": {
    "TITLE": { "type": "text", "required": true, "maxLength": 32, "label": { "en": "Title" } },
    "ACCENT": { "type": "color", "default": "#ff5a36" },
    "HOLD": { "type": "number", "default": 3, "min": 1, "max": 8 },
    "MOOD": { "type": "enum", "options": ["calm", "loud"], "default": "calm" },
    "LOGO": { "type": "media", "default": "logo.png" }
  }
}
```

Types: `text` (string, `maxLength`; blank counts as no value), `color` (FFmpeg's grammar: `#rrggbb(aa)` / `0x` /
an FFmpeg colour name, optional `@alpha` in 0–1; `#rgb(a)` and `rgb()`/`rgba()` are normalised to `#rrggbb(aa)`),
`url` (`http(s)`, `data`, `media://` or a relative path), `media` (path or URL), `number` (decimal, `min`/`max`),
`enum` (`options`), `time` (decimal seconds, or `m:ss(.f)` / `h:mm:ss(.f)` with seconds and minutes below 60,
coerced to seconds). Optional keys: `default`, `required`, `label` (translations),
`description`.

A placeholder that fills a whole string (`"duration": "{{ HOLD }}"`) is replaced by the **typed** value (the
number 3, not `"3"`), so numeric slots work. If the slot only takes the other form, it gets that form: a
number alone in a text slot goes in as text, a numeric enum option alone in a numeric slot as a number. A
placeholder inside a longer string is interpolated as text. A field value with filtergraph separators is refused
in a raw filter value (any `filters[].values` key but `text`); text fields belong in text slots.

## Resolution

Values merge in order: provided (`ProjectConfig.fields`, `leclap render --set`, MCP `fields`) → `default`.
Each value is coerced by its type (pluggable: `resolveFields(…, { coercers, encode })`), then substituted
across the descriptor (after partial expansion, before formats), then the resolved descriptor goes through the
normal schema. A substituted slot that the schema rejects is reported as `field_type_mismatch` at that path.

- Validation without values (`leclap validate`, MCP `validate_template`) runs in **probe** mode: a missing
  value gets a placeholder of its type so the rest of the template still validates; the gap is an advisory.
  The probed descriptor is only checked: validation hands back the authored one, placeholders kept.
- A render (and validation given values) runs **strict**: a missing required value, or one that fails its
  type, fails before anything is encoded. The director resolves again, so `skipValidation`, browser and
  on-device compiles are covered too. Resolution is idempotent: substituted text is never re-scanned and the
  resolved descriptor drops `global.fields`, so a second pass finds nothing to fill.

## Advisories

`TemplateValidator.getFieldWarnings(template, values?)`, also folded into `getMotionWarnings` so every
surface that prints advisories (CLI `validate`, MCP `validate_template`, the web builder) shows them:

| code                     | when                                                                            | hint                          |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
| `field_undefined`        | a `{{ x }}` names no field, variable, form field nor partial variable           | declare it / nearest name     |
| `field_unused`           | a declared field is never referenced                                            | reference it or remove it     |
| `field_type_mismatch`    | a default/provided value fails its type, or a substituted slot fails its schema | fix the value                 |
| `field_missing_required` | required (or non-text) with no value and no default                             | add a default or pass `--set` |

They only run when the template declares `global.fields`; a template without them keeps today's
`undefined_variable` behaviour.

## Forms and fields

A form section field and a declared field share one namespace. Naming a form field after a declared field
**binds** them: the contract owns the type, default, range and options; the form field keeps where and how
the value is asked (`label`, `maxLength`). The web form renders a type-appropriate control for a bound field
(colour picker, number, select, URL). Declared fields bound to no form section are listed by the all-fields
form, so a host can still collect them. Form fields without a declared counterpart behave exactly as today.

## Migration

None required. `global.fields` is optional; `global.variables`, form fields and `ProjectConfig.fields` keep
working unchanged. A template opts in by declaring fields, which turns on the advisories and typed
substitution. Converting a template means: move each user-facing `{{ x }}` into `global.fields` with a type
and default, then replace numeric literals that should be inputs with whole-string placeholders.

## Phases

1. **Engine contract** (done): schema, coercion, resolution (probe/strict), advisories, director gate,
   `resolveFields` export. Surfaces: `leclap render --set` (repeatable, alias of `--field`), `leclap resolve`,
   MCP `fields` on `compose_video`/`render_frames` (string, number or boolean), `get_resolved_template`, the
   field contract in `validate_template`; web builder typed form controls.
2. **Forms derive from the contract** (proposed): make form `label`/`maxLength` optional when a declared field
   supplies them, so a form section can list just names. Needs every consumer of `options.fields`
   (creative-kit editor model, web admin editor, Expo builder) to read through one helper.
3. **Expo** (follow-up): the Expo form (`apps/leclap-expo/src/features/editor/components/FormSection.tsx`) is a
   separate React Native component with its own text inputs; give it the same typed controls (native colour
   swatches, numeric keyboard, picker). The engine already validates and resolves on device.

Out of scope: HTML escaping (no HTML output today; `encode` is the hook), a WebMCP counterpart (the builder's
agent tools edit a template in a page; `get_resolved_template` is an MCP-side inspection tool, and
`SHARED_WITH_MCP` is left unchanged).
