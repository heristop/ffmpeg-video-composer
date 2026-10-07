// The timing vocabulary of motionCatalog(): which fields take time references, their grammar and
// bases, and the music analysis guide. Split out of catalog.ts for its max-lines budget.
import { TIME_REF_SYNTAX } from '../timing/grammar';

// Time references: name the moment instead of computing it. Resolved to seconds at compile time.
export const TIMING = {
  fields: [
    'kinetic[].delay',
    'kinetic[].exit.at',
    'graphics[].at',
    'graphics[].until',
    'camera.delay',
    'camera.hits[] / hits[].at',
    'camera.zoom|x|y|rotate[].t',
    'filters[].reveal.delay (drawtext)',
    'filters[].exit.after (drawtext)',
    'filters[].animate.*[].t',
    'subtitles.cues[].at / end',
    'sfx[].at',
    'options.audioAutomation[].at',
    'global.sfx[].at and global.audio.automation[].at (whole-video scope: "<section>.start|end", "cue:<name>", "beat:n", "50%", "end")',
    'options.speedRamp[].at',
    'options.freeze[].at',
    'options.focus[].t',
  ],
  grammar: TIME_REF_SYNTAX,
  bases: {
    '<id>.start': 'When the element with that id (kinetic block, graphic, drawtext filter) in this section starts.',
    '<id>.end':
      'When its entrance has landed: kinetic = last unit arrived; graphic = at + duration; drawtext = reveal delay + duration.',
    '<n>%': 'A fraction of the section duration (needs a known duration).',
    end: 'The section end.',
    'beat:<n>': 'The n-th beat of global.beats (1-based, counted on the whole video), as section time.',
    'bar:<n>': 'The downbeat of bar n of global.beats.',
    'cue:<name>': 'A named point in this section, from sections[].cues.',
  },
  examples: [
    '"title.end + 0.2"',
    '"title.start - 0.1"',
    '"50%"',
    '"end - 0.5"',
    '"beat:12"',
    '"bar:3 - 0.1"',
    '"cue:drop - 0.1"',
  ],
  rules: [
    'Give an element an id only when something references it; ids are unique within a section.',
    'Hits (camera hits, flash graphics) land exactly on the beat: "beat:12".',
    'Entrances read as on the beat when they lead it by 0.04–0.19 s: "beat:12 - 0.1".',
    'Chain beats with references ("headline.end + 0.15") rather than adding seconds by hand.',
    'beat/bar need global.beats ({ bpm, offset?, beatsPerBar? } or { times }) and every earlier section to declare options.duration.',
    'Section lengths can sit on the grid: options.duration { beats: 8 } or { bars: 2 } (needs a bpm on global.beats).',
  ],
  /** Where global.beats comes from: a measurement of the music, never a guess. */
  analysis: {
    measure:
      'Measure the music with `leclap beats <audio> --json` or the analyze_music MCP tool: bpm, offset (beat 1 = ' +
      'first downbeat), beatsPerBar, times, confidence, usable and cues { build?, drop?, end }. Paste ' +
      '{ bpm, offset, beatsPerBar } into global.beats and the drop into the cues of the section playing then.',
    compileTime:
      'global.beats { analyze: "music" } measures the template music track when compiling on Node; the browser ' +
      'and on-device engines reject it with beats_analysis_unavailable, so precompute the grid for them.',
    lowConfidence:
      'usable: false (calm, ambient, rubato music; confidence under 3) raises beat_grid_low_confidence: pace by ' +
      'phrases and section lengths in seconds, time entrances to the words, and keep cuts off the beat grid.',
    cues: 'cue:drop lands on the largest energy rise; cue:build where the rise before it starts; hit the drop.',
  },
  errors: [
    'unknown_time_ref',
    'circular_time_ref',
    'unresolvable_time_ref',
    'negative_time',
    'duplicate_time_id',
    'beat_duration_needs_bpm',
    'beats_analysis_unavailable',
  ],
};
