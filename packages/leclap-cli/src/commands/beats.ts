import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import pc from 'picocolors';
import { analyzeMusicFile, type BeatAnalysis } from 'ffmpeg-video-composer';
import { fail, heading, hint, step, success } from '../ui.js';
import { wordmark } from '../theme.js';

// `leclap beats <audio>`: measure a music track (tempo, beat 1, bar length, confidence, drop/build/end
// cues) and print the `global.beats` grid a template takes. `--json` emits the whole analysis.

function seconds(value: number | undefined): string {
  return value === undefined ? pc.dim('none') : `${value.toFixed(3)}s`;
}

/** The `global.beats` block a template pastes in. */
export function templateBeats(analysis: BeatAnalysis): Record<string, unknown> {
  return {
    bpm: analysis.bpm,
    offset: analysis.offset,
    beatsPerBar: analysis.beatsPerBar,
    confidence: analysis.confidence,
    usable: analysis.usable,
  };
}

// Pure: the human report (no IO), testable without decoding anything.
export function formatBeats(file: string, analysis: BeatAnalysis): string[] {
  const verdict = analysis.usable
    ? success(`${analysis.bpm} BPM, beat 1 at ${analysis.offset.toFixed(3)}s (confidence ${analysis.confidence})`)
    : fail(`no reliable pulse (confidence ${analysis.confidence}, best guess ${analysis.bpm} BPM)`);

  return [
    heading(file),
    verdict,
    step(`${analysis.beatsPerBar} beats per bar, ${analysis.times.length} beats tracked`),
    step(
      `cues: build ${seconds(analysis.cues.build)}, drop ${seconds(analysis.cues.drop)}, end ${seconds(analysis.cues.end)}`
    ),
    analysis.usable
      ? hint(`global.beats: ${JSON.stringify(templateBeats(analysis))}`)
      : hint('Pace this track by phrases: section lengths in seconds, entrances on the words, not on beats.'),
  ];
}

async function assertReadable(file: string): Promise<void> {
  const stats = await fs.stat(file);

  if (!stats.isFile()) throw new Error(`${file} is not a file`);
}

export const beats = defineCommand({
  meta: { name: 'beats', description: 'Measure a music track: tempo, beat grid, confidence and drop/build cues' },
  args: {
    audio: { type: 'positional', description: 'Path to an audio file FFmpeg can read', required: true },
    json: { type: 'boolean', description: 'Emit the analysis as JSON', default: false },
    beatsPerBar: { type: 'string', description: 'Beats per bar for the downbeat estimate (default 4)' },
  },
  async run({ args }) {
    try {
      await assertReadable(args.audio);

      const beatsPerBar = args.beatsPerBar === undefined ? undefined : Number(args.beatsPerBar);

      if (beatsPerBar !== undefined && !(Number.isInteger(beatsPerBar) && beatsPerBar >= 1 && beatsPerBar <= 16)) {
        throw new Error('--beatsPerBar must be an integer from 1 to 16');
      }

      const analysis = await analyzeMusicFile(args.audio, { beatsPerBar });

      if (args.json) {
        process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);

        return;
      }

      process.stdout.write(wordmark());
      console.log(formatBeats(args.audio, analysis).join('\n'));
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
