// The sound-synthesis surface the Node entry re-exports (MCP analyze_sound, hosts): render and measure a
// composed `sound` or a varied library preset, the schema that bounds it and the advisory thresholds.

export { renderSound, renderSoundWav, soundUsesSeed, type RenderedSound } from './synth/render';
export { soundLength } from './synth/timing';
export { analyzeChannels, type SoundMetrics } from './synth/analysis';
export { SOUND_PRESETS, varyPreset, isVaried, type PresetVariation } from './sound-presets';
export { soundSpec } from './sfx-cue';
export { SoundSchema, type SoundInput } from '../../schemas/sound.schemas';
export { SOUND_THRESHOLDS } from '../../services/sound-advisories';
export { measuredFindings as soundFindings } from '../../services/sound-advisories-spectral';
