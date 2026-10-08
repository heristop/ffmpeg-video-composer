import type { McpServer } from '@modelcontextprotocol/server';
import { TemplateDescriptorSchema, motionCatalog } from 'ffmpeg-video-composer';
import { z } from 'zod';

// Every fx primitive the engine lowers, named in the guide (derived, so a new primitive is listed with no edit).
const FX_EFFECTS = Object.keys(motionCatalog().fx.primitives).join(', ');

// Short authoring guide prepended to the JSON Schema so an agent knows how to read it.
const GUIDE = [
  'Template authoring guide:',
  'Use meta.creativeDirection for a 1..4000-character authoring brief: audience, hierarchy, typography, ' +
    'palette, motion, pacing, avoidances and review criteria. Implement it through explicit section settings ' +
    'and effect props; metadata never changes rendering automatically. Keep rendered copy separate. ' +
    'Review entrance, settling, readable hold and ending against the brief. Vary composition by scene purpose.',
  'A template has an optional top-level `global` (project-wide defaults) and an ordered `sections` ' +
    'array — each section becomes a clip and they are composed in order.',
  'Each section has a `name`, a `type` (video, project_video, form, color_background, ' +
    'image_background, music, effect), optional `options`, and optional `filters`/`inputs`/`maps`.',
  'All durations are in SECONDS (options.duration, transition.duration, audioFade durations, etc.); ' +
    'options.duration may also count beats of global.beats as { beats: n } or { bars: n }.',
  'A structured-sugar layer sits above raw filters (prefer it over raw filters): `transition` ({type: an xfade name ' +
    'or "cut", duration?}) on global and/or per section; `look` (cinematic/warm/cool/vintage/noir/' +
    'vivid/dreamy) and `grade` (brightness/contrast/saturation/gamma/hue/colorBalance/blur); `motion` ' +
    '(kenburns [image_background only], rotate, crop, flip); audio polish via global.audio ' +
    '(sourceVolume, musicVolume, normalize, ducking) and options.audioFade; color_background `layers`; ' +
    'and project_video `framingGuide` (a recording-UI overlay, never rendered). They compile to ' +
    'ordinary on-device-safe FFmpeg filters. `filters[]` remains the raw escape hatch (FFmpeg-native keys).',
  'Motion system: section `kinetic` blocks animate copy natively per word or ' +
    'glyph (cascade, rise, drop, slide, pop, impact, tracking-in, typewriter, scramble, wave, highlight, counter, ' +
    'split, fade) with accents and exits; easings add springs (spring(k,c)), cubic-bezier, named curves and ' +
    '$tokens ($snappy, $bouncy, $expo…); `animate` keyframe tracks drive x/y/opacity/scale on drawtext filters; ' +
    'global.motion holds tokens and the energy dial; global.seed makes every random-looking choice repeatable. ' +
    'Kinetic `trail` adds echo smears; section `graphics` add hits (flash, glitch, focus), shapes and data / ' +
    'broadcast graphics (progress, ticker, bars-chart); `type: "fx"` graphics are procedural light primitives ' +
    `and marks on a \`target\` (a card rect, pane, layer or kinetic block), effect one of: ${FX_EFFECTS}. ` +
    'Compose them by ' +
    "tuning each one's parameters (shape, colour, intensity, timing, repeat, seed) for the template instead " +
    'of using one stock look (get_motion_catalog → fx lists every field and when to use it); ' +
    'designed transitions include whip-left/right/up/down; ' +
    '`lowerThird.style` picks clean-bar, side-rule, kicker, stack-bars or pill. ' +
    'Call get_motion_catalog for presets, defaults, art-direction rules and a starter.',
  "Compose motion, don't pick it: derive it from meta.creativeDirection (audience, brand, energy), write a motion " +
    'intent per section, build each from engine primitives (kinetic, animate tracks with ease tokens or springs, ' +
    'camera, designed transitions, graphics, fx, roles, beats/cues for timing), then tune their parameters: never ' +
    'all defaults. Keep one or two signature moves per video. The library animations (inputs[] of type ' +
    '"animation" pointing at animations/*.apng: shine sweep, confetti, light leak…) are samples, a last resort; ' +
    'get_motion_catalog → samples names the primitives that replace each. validate_template flags stock motion ' +
    '(fx_untuned, effect_repeated, library_animation_sample, effect_off_theme, decor_overload).',
  'Masks, layouts and scripts: a kinetic block can `fill` its letters with a gradient, a texture image and/or a ' +
    'shimmer `sweep`; Arabic/Hebrew/Indic copy animates per line (bundled fonts noto-arabic, noto-hebrew). A ' +
    'section `layout` composes several media in one frame: { type: "split", sources: [...] } panes or ' +
    '{ type: "before-after", before, after, wipe }; a source is a section name (its colour, picture, video or ' +
    'clip), a media URL or a #colour.',
  'Word-timed captions: section `subtitles` takes speech-to-text `words` [{text,start,end}] (grouped into phrases ' +
    'by `group`: pauses, sentence ends, maxWords, maxSeconds), authored `cues` [{at,end,text,words?}] or an inline ' +
    '`srt`. A caption DNA `style` (clean, loud, keynote, documentary, boxed, neon) sets font, colours, case, ' +
    'legibility and `karaoke` (word, fill, pop or false); each cue is shrunk to fit `maxLines` balanced lines, ' +
    'split when it still overflows, held for `minDuration`, and kept inside the global.platform safe zones. ' +
    '`crown` ("auto" or a phrase) enlarges the one payoff line. validate_template reports caption_split / ' +
    'caption_shrunk / subtitle_past_end in motionWarnings. The caption sugar also accepts wrap ("balanced") and fit.',
  'Motion roles: tag elements with `role` (micro, panel, camera, headline, accent, mascot) on kinetic blocks, ' +
    'graphics, drawtext filters, titleCard, lowerThird and camera instead of hand-picking eases; the role fills ' +
    'the ease (and duration) the element leaves unset, global.motion.roles overrides a role, and `$role.<name>` ' +
    'works as an ease or keyframe-duration token. Give each section a one-sentence `purpose` and a narrative ' +
    '`role` (hook, problem, product-intro, reveal, proof, cta, outro, bridge): metadata, never rendered; ' +
    'meta.brief or meta.requirePurpose makes validate_template warn section_without_purpose.',
  'Footage editing (video / project_video): options.fit cover|letterbox|blur|off (blur keeps the whole picture ' +
    'over a blurred, dimmed copy; options.fill tunes it), options.focus anchors a cover crop (left/right/top/' +
    'bottom, {x,y}, or keyframes that pan), options.clip {from,to} picks the in/out points in SOURCE seconds, ' +
    'options.speedRamp takes a preset (hero, montage, bullet, flash-in, flash-out) or [{at,speed,ease}] keys, ' +
    'options.freeze [{at,hold,flash}] holds frames. Ramps and freezes change the section length. ' +
    'get_motion_catalog lists footage presets and rules.',
  'Delivery platforms: set global.platform (tiktok, reels/ig, shorts/yt-shorts, youtube, x/twitter, linkedin, ' +
    'facebook, square-feed) when the video has a destination. It defaults the orientation (portrait for ' +
    'tiktok/reels/shorts), lifts the default caption above the app UI, aims loudnorm at the platform loudness, ' +
    'and validate_template then warns platform_ui_overlap (text under the app UI, per-edge safe zones such as ' +
    "TikTok's bottom 22%), platform_duration_exceeded and platform_fps_mismatch. get_motion_catalog lists " +
    'platforms[] with safe zones, max duration and loudness.',
  'Emoji in any drawn text (captions, title cards, lower thirds, kinetic blocks, drawtext filters) render as ' +
    'bundled colour images composited into a measured gap, sharing the text timing, motion and fades ' +
    '(global.emoji "image", the default). About 250 common emoji ship (faces, hands, hearts, symbols, arrows, ' +
    'flags, keycaps, skin tones); validate_template warns emoji_missing_asset for one without an image (it is ' +
    'stripped) and emoji_overlay_cap past 24 per section. global.emoji "strip" drops them, "error" rejects them.',
  'One story, several formats: top-level `formats` ({ landscape?, portrait?, square? }) holds per-orientation ' +
    'compositions, each a deep-merge patch ({ global, sections: { "<name>": patch | { remove: true } } }; arrays ' +
    'replace, or patch by element id with { byId: { "<id>": patch | { remove: true } } }). Any value may be ' +
    '{ "$format": { landscape, portrait, square, default } }. Recompose, do not crop: vertical = fewer elements, ' +
    'larger type, its own camera path; square = tighter type, shorter holds. compose_video { format } renders one; ' +
    'validate_template checks every declared format. get_motion_catalog lists formats.merge.',
  'Text reveal easing accepts linear, ease-out, ease-in-out and ease-out-back. Back easing overshoots travel by ' +
    'about 10% while alpha remains bounded; leave space around the resting position and use it selectively. ' +
    'For per-word blur-rise, split-slide or elastic-stagger discover the optional studio.editorial-type catalog ' +
    'with get_effect_schema. These registered Remotion modes need a Node worker, not the portable native path.',
  'Audio polish: `options.voice` (clean, broadcast, warm, rumble-cut, room-gate) cleans recorded speech on ' +
    'video/project_video sections; `options.audioAutomation` and `global.audio.automation` ([{ at, volume, ease? }], ' +
    'time references allowed) shape the clip sound and the music bed (music automation runs before ducking); ' +
    'section `sfx` / `global.sfx` ([{ id, at, volume? }]) place bundled sound effects (whoosh, swoosh-short, hit, ' +
    'boom, riser, click, tick, pop, shutter, ding, glitch, sparkle, thud, zap, notification, keystroke, blip, ' +
    'rise-short, coin, drum-roll, heartbeat, clap, snap, success, error, swoosh-long, sub-drop, reverse-cymbal, ' +
    'water-drop, whistle-up, camera-focus, paper, tada; riser, rise-short, drum-roll and reverse-cymbal end at ' +
    '`at`) and ' +
    '`global.audio.sfx: "auto"` places ' +
    'them from the motion. get_motion_catalog lists audio.sfx with when to use each sound. A cue may carry a ' +
    'composed `sound` instead of `id` ({ at, sound: { layers: [{ source: tone|noise|strike|silence, pitch, ' +
    'envelope, filter, drive, gain, pan, delay, repeat }], length?, anchor?, fx? } }) or a varied library sound ' +
    '({ sound: { preset, pitch?, length?, brightness?, room? } }): synthesized deterministically (seeded by ' +
    'global.seed and the cue path), bounded to 4 s and 8 layers, peak-normalised like the library. Measure one ' +
    'with analyze_sound; get_motion_catalog audio.compose has recipes by role.',
  'Music timing: call analyze_music on the music file for bpm, offset, beatsPerBar, confidence, usable and ' +
    'cues (build, drop, end); set global.beats to { bpm, offset, beatsPerBar } and put the drop into the cues ' +
    'of the section playing then, so "beat:n", "bar:n" and "cue:drop" land on the music. Section lengths may ' +
    'be options.duration { beats: n } / { bars: n }. global.beats { analyze: "music" } measures the track at ' +
    'compose time on this Node server. When usable is false (calm or ambient music), pace by phrases instead of beats.',
  'Captions from speech: subtitles { transcribe: { from?: "self" | section, language? } } is pinned into ' +
    'subtitles.words by compose_video (whisper.cpp on this server); or call transcribe_media on the clip and pin ' +
    'the words yourself (subtract clip.from). Transcribe once, then pin; have the user review low-confidence words.',
  'Recorded footage (video/project_video): look accepts { preset, strength } for the LUT looks; grade.lut ' +
    '{ url, strength? } applies a user .cube (e.g. Log → Rec.709) first; options.trimSilence cuts silent edges ' +
    'and long pauses (Node analysis; elsewhere pass options.keep [[from,to],…]); cutaways[] overlay B-roll ' +
    '({ url, at, duration, from?, audio: a|b|mix, fit }) while the main clip keeps running (keep/trimSilence/' +
    'cutaways do not combine with clip/speedRamp/freeze). probe_media reports hdr/vfr/rotation; ' +
    'get_motion_catalog lists footage.take rules.',
  'Note: any non-"cut" transition triggers a full-timeline re-encode (costly on WASM/on-device); ' +
    'cut-only templates use a fast stream-copy concat.',
  'Strings may contain `{{ variables }}` (from global.variables), `{{ colorN }}` (1-indexed from ' +
    'colorsList), and `{{ form_field }}` placeholders, all resolved at compose time.',
  'project_video sections need user-supplied clips passed at compose time; the JSON Schema below is ' +
    'the authoritative shape.',
  'Registered effect sections use {name,type:"effect",options:{duration:10},effect:{id:"leclap.title-reveal",version:"1.0.0",props:{},assets:{background,logo,font}}}. Get get_effect_schema for strict defaults/bounds. Configure the trusted Remotion backend, validate_template, edit_template effectProps with its revision, inspect render_preview, then compose_video resolves effects automatically. FFmpeg geometry does not measure Remotion text fit or contrast.',
  'Author the descriptor from this schema — keep it premium and use only on-device-safe filters. ' +
    'For an animated intro that FFmpeg filters cannot produce, call render_remotion_clip with your own ' +
    'Remotion project (entry + compositionId) and add the returned clip as a leading project_video ' +
    'section. Run validate_template (no render) to check it before compose_video.',
].join('\n');

function describeSchema(): string {
  const jsonSchema = z.toJSONSchema(TemplateDescriptorSchema);

  return `${GUIDE}\n\nJSON Schema:\n${JSON.stringify(jsonSchema, null, 2)}`;
}

function fallbackText(): string {
  return `${GUIDE}\n\n(The machine-readable JSON Schema could not be generated. Consult docs/template-configuration.md for the full field reference.)`;
}

function buildText(): string {
  try {
    return describeSchema();
  } catch {
    return fallbackText();
  }
}

export function registerGetTemplateSchema(server: McpServer): void {
  server.registerTool(
    'get_template_schema',
    {
      title: 'Get Template Schema',
      description:
        'Return the JSON Schema for a template descriptor plus a short authoring guide. Use this to ' +
        'understand the full set of fields when building or editing a template for compose_video.',
    },
    () => ({
      content: [{ type: 'text', text: buildText() }],
    })
  );
}
