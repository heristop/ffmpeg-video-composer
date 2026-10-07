// The audio part of the motion catalog (motionCatalog().audio): the sound-effect library with when to use
// each sound, the voice presets, volume automation and the rules for mixing them, so an agent can place
// sound without reading the engine.

import { SFX_IDS, SFX_LIBRARY, type SfxEntry } from './sfx-library';
import { VOICE_PRESETS, VOICE_PRESET_STAGES, type VoicePreset } from './voice-presets';
import { AUTO_SFX_CAP } from './auto-sfx';
import { composeCatalog, type ComposeCatalog } from './compose-catalog';

export interface AudioCatalog {
  sfx: Array<Omit<SfxEntry, 'file'>>;
  voice: Record<VoicePreset, string>;
  automation: { fields: string[]; example: unknown; ducking: string };
  rules: string[];
  compose: ComposeCatalog;
}

const VOICE_USE: Record<VoicePreset, string> = {
  clean: 'Default for talking-head and phone recordings: clearer and more even, without sounding processed.',
  broadcast: 'Announcements, ads and voice-over that must cut through music.',
  warm: 'Thin or harsh voices, intimate storytelling.',
  'rumble-cut': 'Outdoor or handheld clips with wind, handling or traffic rumble; touches nothing else.',
  'room-gate': 'Echoey rooms: closes between phrases so the room tone drops away.',
};

function voiceEntry(preset: VoicePreset): string {
  const chain = VOICE_PRESET_STAGES[preset].map((stage) => stage.filter).join(' → ');

  return `${VOICE_USE[preset]} (${chain})`;
}

export function audioCatalog(): AudioCatalog {
  return {
    sfx: SFX_IDS.map((id) => {
      const { file: _file, ...entry } = SFX_LIBRARY[id];

      return entry;
    }),
    voice: Object.fromEntries(VOICE_PRESETS.map((preset) => [preset, voiceEntry(preset)])) as Record<
      VoicePreset,
      string
    >,
    automation: {
      fields: ['global.audio.automation (music bed, video time)', 'options.audioAutomation (clip sound, section time)'],
      example: [
        { at: 0, volume: 1 },
        { at: 'cue:drop - 0.5', volume: 0.3, ease: 'ease-in-out' },
        { at: 'cue:drop', volume: 1.2, ease: '$snappy' },
      ],
      ducking:
        'Music automation multiplies the per-section musicVolume and runs before ducking: under speech the ' +
        'sidechain still dips the automated level, so automate the shape and let ducking handle the voice.',
    },
    rules: [
      'One sound per visual event, on the frame it happens: a hit on the impact landing ("title.end"), a whoosh ' +
        'where a designed transition starts, a riser at the moment it builds into ("cue:drop"; it ends there).',
      'Fewer is better: at most one sound per second on average; leave calm beats silent.',
      `global.audio.sfx: "auto" places whooshes, hits and risers from the motion (at most ${AUTO_SFX_CAP}); ` +
        'authored sfx always win over auto ones at the same moment.',
      'Levels: sounds mix at their library default (0.35–0.7); lower them under speech, raise them only for ' +
        'the one big moment. Normalisation (loudnorm) runs after the sounds, so peaks stay under the target.',
      'voice on a recorded section (video / project_video) cleans speech; combine with audioEffect only for ' +
        'a creative colour (telephone, echo).',
    ],
    compose: composeCatalog(),
  };
}
