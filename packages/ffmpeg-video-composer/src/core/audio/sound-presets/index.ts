// The 33 library sounds as `sound` recipes: what `sound.preset` starts from and what the motion catalog
// shows as worked examples. The shipped .m4a files (rendered by leclap-creative-kit/scripts/gen-sfx.ts)
// still play for `id` cues and for an unvaried preset; a varied preset renders its recipe through the
// synth (vary.ts). Each recipe lasts exactly its library length. Pure data.

export { SOUND_PRESETS, varyPreset, isVaried, type PresetVariation } from './vary';
