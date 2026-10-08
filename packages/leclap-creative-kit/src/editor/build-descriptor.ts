// Pure: editor state -> core TemplateDescriptor. Section-fragment builders live in
// ./build-descriptor-fragments; the rest are file-local.
import type { TemplateDescriptor, Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { EditorSection, EditorState, FormField, AudioMix, MediaChoice } from './model';
import { pruneEmpty } from './prune';
import { metaFrom } from './template-meta';
import { motionGlobalFrom } from './motion-passthrough';
import { formatsField } from './formats-passthrough';
import { overlayFiltersFrom, videoFiltersFrom } from './overlay-filters';
import {
  DEFAULT_LOCALE,
  globalAnimationFrom,
  markerFromChoice,
  overlayInputsFrom,
  sectionAudioOptions,
  sectionFitOptions,
  sectionPlaybackOptions,
  visualExtras,
  watermarkField,
} from './build-descriptor-fragments';

function formDescriptorFrom(section: { kind: 'form'; fields: FormField[] }, index: number): Section {
  return {
    name: `form_${index}`,
    type: 'form',
    options: {
      fields: section.fields.map((f) => ({ name: f.name, maxLength: f.maxLength, label: { en: f.label } })),
    },
  };
}

type PartialEditorSection = Extract<EditorSection, { kind: 'partial' }>;
type DescriptorSection = NonNullable<TemplateDescriptor['sections']>[number];
type PartialDescriptor = Extract<DescriptorSection, { type: 'partial' }>;

function partialDescriptorFrom(section: PartialEditorSection, index: number): PartialDescriptor {
  const prefix = section.prefix?.trim();
  const variables = Object.fromEntries(
    section.variables
      .filter((variable) => variable.name.trim() !== '')
      .map((variable) => [variable.name, variable.value])
  );

  return {
    name: `partial_${index}`,
    type: 'partial',
    ref: section.ref,
    ...(prefix ? { prefix } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
  };
}

type ColorSection = Extract<EditorSection, { kind: 'color' }>;

function colorDescriptorFrom(section: ColorSection, index: number): Section {
  const filters = overlayFiltersFrom(section.overlays);
  const overlayInputs = overlayInputsFrom(section);

  return {
    name: `color_${index}`,
    type: 'color_background',
    options: {
      duration: section.duration,
      backgroundColor: section.color,
      ...(section.layers && section.layers.length > 0 ? { layers: section.layers } : {}),
      ...sectionAudioOptions(section),
      ...sectionPlaybackOptions(section),
    },
    ...(section.titleCard ? { titleCard: section.titleCard } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...visualExtras(section),
    ...(overlayInputs.length > 0 ? { inputs: overlayInputs } : {}),
  };
}

type VideoSection = Extract<EditorSection, { kind: 'video' }>;

// Asset-backed clip (videoUrl set): a fixed bumper / stock video the engine re-encodes via its
// VideoSegment path — emitted as `type: 'video'` + `options.videoUrl`. Recorder-only metadata
// (countdown, capture modes, framing guide, filming instructions) is dropped: nothing is filmed.
function clipDescriptorFrom(section: VideoSection, videoUrl: MediaChoice, index: number): Section {
  const filters = videoFiltersFrom(section.overlays, section.filterStages);
  const overlayInputs = overlayInputsFrom(section);

  return {
    name: `clip_${index}`,
    type: 'video',
    options: {
      duration: section.duration,
      muteSection: section.mute,
      videoUrl: markerFromChoice(videoUrl),
      ...sectionAudioOptions(section),
      ...sectionPlaybackOptions(section),
      ...sectionFitOptions(section),
    },
    ...(section.lowerThird ? { lowerThird: section.lowerThird } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...visualExtras(section),
    ...(overlayInputs.length > 0 ? { inputs: overlayInputs } : {}),
  };
}

function videoDescriptorFrom(section: VideoSection, index: number): Section {
  if (section.videoUrl) return clipDescriptorFrom(section, section.videoUrl, index);

  const filters = videoFiltersFrom(section.overlays, section.filterStages);
  const description = section.description?.trim();
  const overlayInputs = overlayInputsFrom(section);

  return {
    name: `video_${index}`,
    type: 'project_video',
    options: {
      duration: section.duration,
      muteSection: section.mute,
      ...(section.countdown ? { countdown: true, countdownDuration: section.countdownSeconds } : {}),
      ...(section.framingGuide ? { framingGuide: section.framingGuide } : {}),
      // Recorder metadata (never lowered to filters): the preselected mode and the allowed set,
      // each emitted only when the author set them (omitted = front / all four).
      ...(section.captureMode ? { captureMode: section.captureMode } : {}),
      ...(section.allowedCaptureModes && section.allowedCaptureModes.length > 0
        ? { allowedCaptureModes: section.allowedCaptureModes }
        : {}),
      ...sectionAudioOptions(section),
      ...sectionPlaybackOptions(section),
      ...sectionFitOptions(section),
    },
    // Recording instructions for the filmer, keyed under the app's default locale.
    // A blank/whitespace-only description emits nothing.
    ...(description ? { description: { [DEFAULT_LOCALE]: description } } : {}),
    ...(section.lowerThird ? { lowerThird: section.lowerThird } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...visualExtras(section),
    ...(overlayInputs.length > 0 ? { inputs: overlayInputs } : {}),
  };
}

type IndexedSection = { section: EditorSection; index: number };

// One descriptor section for the given editor section. video/image sections are
// numbered with their own running counter (video_1…, image_1…) so uploaded files
// map to them; form/color use the overall descriptor position. music yields null.
function descriptorFor({ section, index }: IndexedSection): DescriptorSection | null {
  if (section.kind === 'form') return formDescriptorFrom(section, index);

  if (section.kind === 'partial') return partialDescriptorFrom(section, index);

  if (section.kind === 'color') return colorDescriptorFrom(section, index);

  if (section.kind === 'video') return videoDescriptorFrom(section, index);

  if (section.kind === 'image') {
    const filters = overlayFiltersFrom(section.overlays);
    const overlayInputs = overlayInputsFrom(section);

    return {
      name: `image_${index}`,
      type: 'image_background',
      options: {
        duration: section.duration,
        ...sectionAudioOptions(section),
        ...sectionPlaybackOptions(section),
        ...sectionFitOptions(section),
      },
      ...(filters.length > 0 ? { filters } : {}),
      ...visualExtras(section),
      ...(overlayInputs.length > 0 ? { inputs: overlayInputs } : {}),
    };
  }

  return null;
}

// Descriptor sections, in editor order. music sections produce nothing here —
// they are folded into the global media fields.
function mapEditorSections(sections: EditorSection[]): DescriptorSection[] {
  return indexSections(sections)
    .map(descriptorFor)
    .filter((s): s is Section => s !== null);
}

/** The name buildDescriptor gives each editor section (undefined for music), aligned with `sections`. */
export function emittedSectionNames(sections: EditorSection[]): Array<string | undefined> {
  return indexSections(sections).map((indexed) => descriptorFor(indexed)?.name);
}

function indexSections(sections: EditorSection[]): IndexedSection[] {
  let videoIndex = 0;
  let clipIndex = 0;
  let imageIndex = 0;
  let descIndex = 0;

  const counted = sections.map((section): IndexedSection => {
    // Asset-backed clips run on their own counter (clip_1…): the `video_<i>` names are reserved for
    // the camera sections the apps map recorded/uploaded user clips onto, in order.
    if (section.kind === 'video' && section.videoUrl) return { section, index: (clipIndex += 1) };

    if (section.kind === 'video') return { section, index: (videoIndex += 1) };

    if (section.kind === 'image') return { section, index: (imageIndex += 1) };

    return { section, index: (descIndex += 1) };
  });

  return counted;
}

// The emitted names of the sections a whole-video text overlay can target (global.overlays[].sections):
// the renderable ones only. form is metadata (never rendered) and a partial's inner sections carry the
// partial's own (possibly prefixed) names, so neither can be matched by the compiler's per-section filter.
export function renderableSectionNames(sections: EditorSection[]): string[] {
  return mapEditorSections(sections)
    .filter((section) => section.type !== 'form' && section.type !== 'partial')
    .map((section) => section.name)
    .filter((name): name is string => typeof name === 'string');
}

// music section -> global.allowed*/allowUpload*; image sections -> de-duplicated
// global.allowedBackgrounds union + allowUploadBackground (true if any allows it).
function mediaGlobals(sections: EditorSection[]): Partial<NonNullable<TemplateDescriptor['global']>> {
  const out: Partial<NonNullable<TemplateDescriptor['global']>> = {};

  const musicSection = sections.find((s): s is Extract<EditorSection, { kind: 'music' }> => s.kind === 'music');

  if (musicSection) {
    out.musicEnabled = true;
    out.allowedMusic = musicSection.allowed;
    out.allowUploadMusic = musicSection.allowUpload;
  }

  const imageSections = sections.filter((s): s is Extract<EditorSection, { kind: 'image' }> => s.kind === 'image');

  if (imageSections.length > 0) {
    out.allowedBackgrounds = [...new Set(imageSections.flatMap((s) => s.allowed))];
    out.allowUploadBackground = imageSections.some((s) => s.allowUpload);
  }

  return out;
}

// Author-defined global variables as a plain name -> value map, skipping any
// row with a blank name.
function authorVariables(globalVariables: EditorState['globalVariables']): Record<string, string> {
  return Object.fromEntries(globalVariables.filter((v) => v.name.trim() !== '').map((v) => [v.name, v.value]));
}

// Whole-video text overlays, dropping any blank row the builder leaves behind so the descriptor only
// carries real overlays. Emits nothing when none remain.
function globalOverlaysField(
  overlays: EditorState['globalOverlays']
): Partial<NonNullable<TemplateDescriptor['global']>> {
  const kept = overlays.filter((o) => Object.values(o.text).some((value) => value.trim() !== ''));

  return kept.length > 0 ? { overlays: kept } : {};
}

// The ducking field to emit: off emits nothing, on-with-defaults emits `true`, and a fine-tuned
// object passes through — collapsing back to `true` when every knob was cleared.
function duckingField(ducking: AudioMix['ducking']): { ducking?: true | AudioMix['ducking'] } {
  if (ducking === false) return {};

  if (ducking === true) return { ducking: true };

  const tuned = pruneEmpty(ducking);

  return Object.keys(tuned).length > 0 ? { ducking: tuned } : { ducking: true };
}

// editor audio mix -> global.audio, dropping normalize/ducking unless set/enabled.
function audioGlobal(audio: AudioMix): NonNullable<NonNullable<TemplateDescriptor['global']>['audio']> {
  return {
    sourceVolume: audio.sourceVolume,
    musicVolume: audio.musicVolume,
    ...(audio.normalize ? { normalize: audio.normalize } : {}),
    ...duckingField(audio.ducking),
    ...(audio.automation ? { automation: audio.automation } : {}),
    ...(audio.sfx ? { sfx: audio.sfx } : {}),
  };
}

// The template palette with blank swatch rows dropped; empty/absent palettes emit nothing.
function paletteFrom(state: EditorState): string[] {
  return (state.colorsList ?? []).filter((color) => color.trim() !== '');
}

// The template's human-facing identity (descriptor.meta) — name/description trimmed and emitted
// only when non-blank, so an exported JSON stays self-describing while untouched fields stay clean.
// Pure: editor state -> a core TemplateDescriptor.
export function buildDescriptor(state: EditorState): TemplateDescriptor {
  const palette = paletteFrom(state);

  const global: NonNullable<TemplateDescriptor['global']> = {
    orientation: state.orientation,
    musicEnabled: false,
    transition: {
      type: state.defaultTransition.type,
      duration: state.defaultTransition.duration,
      ...(state.defaultTransition.ease === undefined ? {} : { ease: state.defaultTransition.ease }),
    },
    // Motion template settings, carried through from the loaded descriptor.
    ...motionGlobalFrom(state.motion),
    // Audio mix: source (recorded clip) volume and background-music volume, each 0..1 (0 = muted).
    audio: audioGlobal(state.audio),
    ...(state.audio.cues && state.audio.cues.length > 0 ? { sfx: state.audio.cues } : {}),
    ...(state.globalAnimations.length > 0 ? { animations: state.globalAnimations.map(globalAnimationFrom) } : {}),
    // Whole-video text overlays (brand watermark, etc.) authored once and composited onto every section.
    ...globalOverlaysField(state.globalOverlays),
    ...watermarkField(state.watermark),
    ...(state.globalLook ? { look: state.globalLook } : {}),
    ...(state.globalGrade ? { grade: state.globalGrade } : {}),
    // The colour palette lands in BOTH descriptor slots: global.colorsList (user-facing, read by the
    // apps) and global.variables.colorsList (engine — FormatterManager.formatColor resolves the
    // '{{ colorN }}' tokens from there at compile time).
    ...(palette.length > 0 ? { colorsList: palette, variables: { colorsList: palette } } : {}),
    ...mediaGlobals(state.sections),
  };

  const variables = authorVariables(state.globalVariables);

  if (Object.keys(variables).length > 0) {
    global.variables = { ...global.variables, ...variables };
  }

  const sections = mapEditorSections(state.sections);

  return { ...metaFrom(state), global, sections, ...formatsField(state.formats, sections) };
}

// De-duplicated union of every variable name available to the editor: form
// field names (in section order) first, then non-empty author global names.
export function collectVariables(state: EditorState): string[] {
  const formFieldNames = state.sections
    .filter((s): s is Extract<EditorSection, { kind: 'form' }> => s.kind === 'form')
    .flatMap((s) => s.fields.map((f) => f.name));

  const globalNames = state.globalVariables.map((v) => v.name).filter((name) => name.trim() !== '');

  return [...new Set([...formFieldNames, ...globalNames])];
}
