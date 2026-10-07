# Sound synthesis: sounds an agent composes, not samples it picks

> Status: proposed · Scope: `ffmpeg-video-composer` (schema, synth, mix), `leclap-creative-kit` (presets),
> `leclap-mcp` (catalog, analysis tool) · Audience: LLM and MCP authoring first; the builder keeps picking presets.

## Why

The bundled sound-effect library (33 sounds: `whoosh`, `hit`, `clap`, …) is a set of samples. Every template that
cues `whoosh` gets the same whoosh, so agent-made videos all sound alike, the same problem the motion system solved
for animation ("compose motion from the engine; library animations are samples, not building blocks").

The library sounds are already compositions: each is a short recipe in `scripts/gen-sfx.ts` (seeded noise, swept
tones, struck notes, envelopes, filters). This spec exposes that vocabulary to templates, so an agent can shape the
sound a moment needs, and keeps the 33 sounds as named presets anyone can still pick.

## Decisions

1. **LLM-first.** The vocabulary is designed to be written by agents through MCP (schema, catalog, analysis). The
   web builder and the app keep offering the preset list; no synth editor UI in this effort.
2. **Presets stay pickable.** `sfx: [{ id: "whoosh", at }]` keeps working unchanged. Each preset is re-expressed in
   the new vocabulary and published as a worked example, so "pick" and "compose" are the same thing at two depths.
3. **Synthesized in TypeScript, mixed by FFmpeg.** A pure, dependency-free synth module renders each sound to PCM
   and writes a WAV; the existing sfx mix places it like a bundled file. Rationale:
   - **Identical everywhere.** JS float math is IEEE-754 on Node, browsers and Hermes, so a sound renders the same on
     every platform. Building sounds out of FFmpeg filters would not: the phone build lacks `anoisesrc`, `bandpass`,
     `flanger`, `chorus` and the bit-crusher, and filter internals differ between FFmpeg versions.
   - **Deterministic.** Seeded noise (from `global.seed` and the cue's path, like fx), no wall-clock.
   - **Cheap.** A 1 s mono 48 kHz sound is 48 k samples; rendering is milliseconds. Results are cached by content
     hash in the build cache, so a repeated sound renders once.
   - **No new native surface.** The device engine only ever sees a WAV input and the filters the mix already uses.
4. **Typed and bounded.** No raw FFmpeg or JS expressions in templates. Every parameter has a range and a default,
   like fx ceilings, so a careless value can't produce a 20-second shriek.

## The vocabulary

A cue either names a preset or carries a `sound`:

```jsonc
"sfx": [
  { "id": "whoosh", "at": "title.start" },                       // preset, unchanged
  { "at": "cue:reveal", "sound": { "preset": "sparkle", "pitch": 1.2, "length": 0.8 } }, // preset, tuned
  { "at": "beat:4", "sound": {                                    // composed
      "length": 0.45,
      "layers": [
        { "source": "noise", "color": "pink", "filter": { "type": "lowpass", "from": 9000, "to": 600 },
          "envelope": { "attack": 0.01, "decay": 0.35, "curve": "exp" }, "gain": 0.8 },
        { "source": "tone", "wave": "sine", "pitch": { "from": 180, "to": 55 },
          "envelope": { "attack": 0.002, "decay": 0.3 }, "gain": 0.6 }
      ],
      "fx": { "saturate": 0.2, "room": 0.15 }
  } }
]
```

- **Sources:** `tone` (sine, triangle, square, saw; pitch fixed or swept, linear or exponential; optional vibrato),
  `noise` (white, pink, brown; seeded), `strike` (a struck/mallet note: tone plus a short noise transient, the
  `strike()` helper already in `gen-sfx-sources.ts`), `silence` (for spacing inside a sequence).
- **Shaping:** per-layer `envelope` (attack, hold, decay, release; linear or exponential), `filter` (lowpass,
  highpass, bandpass as a cascade; cutoff fixed or swept; resonance bounded), `gain`, `delay` (layer offset), `pan`.
- **Sequences:** `repeat` with `every` and optional `accelerate` (drum rolls, ticks), plus a seeded `jitter` so
  repeats don't sound mechanical.
- **Whole-sound fx:** `saturate` (soft clip), `crush` (bit/sample-rate reduction), `room` (a small deterministic
  reverb), `echo`. All implemented in the synth, so none needs a device filter.
- **Bounds:** `length` ≤ 4 s, ≤ 8 layers, pitch 20–12 000 Hz, every gain 0–1; the render is peak-normalised to the
  library's −3 dBFS, then the cue's `volume` applies as today.
- **Presets:** `sound.preset` starts from a library sound and lets `pitch`, `length`, `brightness` (filter tilt) and
  `room` vary it, the cheapest route to "not the same whoosh as everyone".

## Guardrails for an author who can't hear

Agents can't listen, so they need numbers and pictures, the way they check frames:

- **Validation (advisory, like the motion lint):** `sound_clipped` (peak before normalisation far over 0 dBFS),
  `sound_harsh` (too much energy above 8 kHz), `sound_muddy` (a dense low end that will fight the music),
  `sound_long` (longer than the moment it marks), `sound_repeated` (the same sound on every cue in a section),
  `sound_overlap` (cues stacking into a wall of sound).
- **MCP `analyze_sound`:** renders a `sound` and returns length, peak, loudness, spectral centroid ("brightness"),
  attack time and a spectrogram + waveform PNG. An agent iterates until the numbers match the intent ("a soft, warm
  pop: centroid under 2 kHz, attack under 10 ms").
- **Catalog guidance:** `motionCatalog().audio` gains a `compose` section: how to build impacts, risers, UI blips,
  textures; the preset recipes as examples; "one signature sound per beat, vary pitch rather than repeat".

## Implementation outline

1. **Engine synth** (`core/audio/synth/`): oscillators, seeded noise, envelopes, biquad filters, the fx, a WAV
   writer. Pure functions, unit-tested sample by sample against golden checksums (determinism) and against
   analytic expectations (a 440 Hz sine's zero crossings, an envelope's peak time).
2. **Schema:** `SfxCueSchema` accepts `id` or `sound` (exactly one); `SoundSchema` with the bounds above;
   regenerate `docs/template-descriptor.schema.json`.
3. **Mix:** before the sfx mix, render each distinct `sound` to `build/sfx/<hash>.wav` through the platform
   filesystem adapter (Node, browser MEMFS, Expo), then hand the mix a path like a library file. Cache by hash.
4. **Presets in the vocabulary:** port the 33 recipes from `gen-sfx.ts` to `sound` objects in the creative kit.
   Keep the shipped `.m4a` files for `id` cues (no render cost, byte-identical to today); a parity test checks each
   preset renders close to its file (loudness and centroid within tolerance).
5. **Lint + MCP:** the validation rules; `analyze_sound`; catalog `compose` section; `get_template_schema` and
   docs (`docs/template-configuration.md` "Sound effects").
6. **Proof:** the effects tour's sound chapter gains a "composed" scene; a sample template whose sounds are all
   composed.

## Out of scope

- A synth editor in the builder or the app (presets stay the UI).
- Arbitrary audio files from external generators as cues (a separate, smaller feature: an `sfx` cue with a `url`,
  with licensing and offline concerns of its own).
- Music generation.

## Risks

- **Quality.** Synthesized sound can be thin. Mitigation: start agents from presets, keep a small reverb and
  saturation in the vocabulary, and lint for the common failures.
- **Hermes performance.** A long, many-layer sound renders slower on device. Bounds (4 s, 8 layers) cap it; measure
  on the Pixel 3a emulator against a 50 ms budget per sound.
- **Schema size.** The generation prompt's size budget is tight (see the AI system-prompt test). The `sound` schema
  is described compactly and the catalog's `compose` section is trimmed for the prompt.
