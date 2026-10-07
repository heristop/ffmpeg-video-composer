// The sound-synthesis surface the Node entry re-exports (MCP analyze_sound, hosts): render and measure a
// composed `sound` or a varied library preset, seed it like the mix seeds a cue, the schema that bounds it
// and the advisory thresholds.

export { renderSound, renderSoundWav, soundUsesSeed, type RenderedSound } from './synth/render';
export { noteSeconds, soundLength } from './synth/timing';
export { encodeWav } from './synth/wav';
export { analyzeChannels, type SoundMetrics } from './synth/analysis';
export { SOUND_PRESETS, varyPreset, isVaried, type PresetVariation } from './sound-presets';
export { cueSeed, soundSpec } from './sfx-cue';
export { SoundSchema, type SoundInput } from '../../schemas/sound.schemas';
export { SOUND_THRESHOLDS } from '../../services/sound-advisories';
export { measuredFindings as soundFindings } from '../../services/sound-advisories-spectral';
