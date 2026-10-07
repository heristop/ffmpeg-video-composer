#!/usr/bin/env node
// Synthesize the bundled sound-effect library (src/library/sfx/*.m4a) from FFmpeg lavfi sources: seeded
// noise, swept sines and envelopes, so every file is original, license-free and reproducible from this
// script. Each sound is peak-normalised to PEAK_DBFS, then encoded as AAC (48 kHz stereo) in an .m4a
// container, which every backend decodes (the on-device build enables the mov demuxer and aac decoder).
// Run with `pnpm --dir packages/leclap-creative-kit gen:sfx [id ...]` (needs ffmpeg on PATH; ids limit the run,
// since another FFmpeg build may not reproduce the other files byte for byte). The manifest the
// engine reads (ids, durations, anchors, guidance) lives in ffmpeg-video-composer core/audio/sfx-library.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMO_RECIPES } from './gen-sfx-recipes-promo.ts';
import { RATE, noise, strike, tone, type SfxRecipe } from './gen-sfx-sources.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../src/library/sfx');
const PEAK_DBFS = -3;

const RECIPES: SfxRecipe[] = [
  {
    id: 'whoosh',
    graph:
      `${noise(0.6, 'pink', 7)},highpass=f=300,lowpass=f=5000,` +
      'afade=t=in:d=0.32:curve=qsin,afade=t=out:st=0.32:d=0.28:curve=qsin[a]',
  },
  {
    id: 'swoosh-short',
    graph:
      `${noise(0.3, 'white', 11, 0.6)},highpass=f=900,lowpass=f=8000,` +
      'afade=t=in:d=0.12:curve=qsin,afade=t=out:st=0.12:d=0.18:curve=exp[a]',
  },
  {
    id: 'hit',
    graph:
      `${tone(0.5, 'sin(2*PI*(55*t+140*(1-exp(-30*t))/30))*exp(-7*t)')}[body];` +
      `${noise(0.5, 'white', 3, 0.5)},lowpass=f=2500,afade=t=out:d=0.06[snap];` +
      '[body][snap]amix=inputs=2:normalize=0,afade=t=out:st=0.35:d=0.15[a]',
  },
  {
    id: 'boom',
    graph:
      `${tone(1.2, 'sin(2*PI*(38*t+90*(1-exp(-9*t))/9))*exp(-3.2*t)')}[body];` +
      `${noise(1.2, 'brown', 5, 0.7)},lowpass=f=400,afade=t=out:d=0.5:curve=exp[rumble];` +
      '[body][rumble]amix=inputs=2:normalize=0,afade=t=out:st=0.9:d=0.3[a]',
  },
  {
    id: 'riser',
    graph:
      `${tone(2, '0.5*sin(2*PI*(180*t+60*(exp(1.8*t)-1)))*(t/2)^2')}[sweep];` +
      `${noise(2, 'white', 13, 0.4)},highpass=f=2500,afade=t=in:d=1.9:curve=exp[air];` +
      '[sweep][air]amix=inputs=2:normalize=0,afade=t=out:st=1.97:d=0.03[a]',
  },
  {
    id: 'click',
    graph: `${noise(0.05, 'white', 17, 0.9)},highpass=f=2000,afade=t=out:d=0.05:curve=exp[a]`,
  },
  {
    id: 'tick',
    graph: `${tone(0.06, 'sin(2*PI*2100*t)*exp(-90*t)')}[a]`,
  },
  {
    id: 'pop',
    graph: `${tone(0.15, 'sin(2*PI*(320*t+400*t*t/0.15))*exp(-28*t)*min(1,t*400)')}[a]`,
  },
  {
    id: 'shutter',
    graph:
      `${noise(0.08, 'white', 19, 0.9)},bandpass=f=3200:t=h:w=2400,afade=t=out:d=0.08:curve=exp[open];` +
      `${noise(0.14, 'white', 23, 0.8)},bandpass=f=2600:t=h:w=2000,afade=t=out:d=0.14:curve=exp,adelay=110|110[close];` +
      '[open][close]amix=inputs=2:normalize=0:duration=longest[a]',
  },
  {
    id: 'ding',
    graph:
      tone(1.5, '(sin(2*PI*1318.5*t)+0.3*sin(2*PI*2637*t)+0.1*sin(2*PI*3955.5*t))*exp(-3*t)*min(1,t*300)') +
      ',afade=t=out:st=1.2:d=0.3[a]',
  },
  {
    // 36 slices a second: a hash of the slice index picks its pitch and whether it sounds, so the stutter
    // is fixed; each slice ramps over 0.7 ms so the gaps chop without clicking, then a bitcrusher grits it.
    id: 'glitch',
    graph:
      tone(
        0.4,
        'st(0,floor(t*36));st(1,sin(ld(0)*12.9898)*43758.5453);st(1,ld(1)-floor(ld(1)));' +
          'st(2,sin(ld(0)*78.233)*12345.678);st(2,ld(2)-floor(ld(2)));st(3,t*36-ld(0));' +
          'gt(ld(2),0.28)*min(1,ld(3)*40)*min(1,(1-ld(3))*40)*' +
          'tanh(3*sin(2*PI*(120+1400*ld(1))*t))*(0.55+0.45*ld(2))'
      ) + ',acrusher=bits=6:mode=lin:samples=3:mix=0.8,highpass=f=120,afade=t=out:st=0.37:d=0.03[a]',
  },
  {
    // Five staggered bell notes up a C major arpeggio (C7..E8) over a short airy hiss.
    id: 'sparkle',
    graph:
      tone(
        1.2,
        '0.35*(' +
          [
            strike(0, 2093, 7, 'sin(F)+0.2*sin(2*F)'),
            `0.8*${strike(0.05, 2637, 7, 'sin(F)+0.2*sin(2*F)')}`,
            `0.7*${strike(0.1, 3136, 8, 'sin(F)+0.15*sin(2*F)')}`,
            `0.6*${strike(0.16, 4186, 9, 'sin(F)')}`,
            `0.5*${strike(0.23, 5274, 10, 'sin(F)')}`,
          ].join('+') +
          ')'
      ) +
      `[bells];${noise(1.2, 'white', 29, 0.15)},highpass=f=7000,afade=t=in:d=0.05,` +
      'afade=t=out:st=0.05:d=0.6:curve=exp[air];[bells][air]amix=inputs=2:normalize=0,afade=t=out:st=0.9:d=0.3[a]',
  },
  {
    // A saturated low drop (harmonics so small speakers still hear it) with a muffled knock, no snap.
    id: 'thud',
    graph:
      tone(0.45, 'tanh(2.5*sin(2*PI*(48*t+70*(1-exp(-25*t))/25)))*exp(-10*t)*min(1,t*800)') +
      `[body];${noise(0.45, 'brown', 31, 0.6)},lowpass=f=260,afade=t=out:d=0.12:curve=exp[knock];` +
      '[body][knock]amix=inputs=2:normalize=0,lowpass=f=900,afade=t=out:st=0.33:d=0.12[a]',
  },
  {
    // A clipped, frequency-modulated sweep diving from 2.5 kHz to 160 Hz.
    id: 'zap',
    graph:
      tone(0.35, 'tanh(3*sin(2*PI*(160*t+2400*(1-exp(-11*t))/11)+2.5*sin(2*PI*93*t)))*exp(-6*t)*min(1,t*500)') +
      ',highpass=f=150,lowpass=f=7000,afade=t=out:st=0.27:d=0.08[a]',
  },
  {
    // Two marimba-like notes a fifth apart (G5 then D6).
    id: 'notification',
    graph:
      tone(0.8, `0.5*(${strike(0, 784, 9, 'sin(F)+0.25*sin(4*F)')}+${strike(0.13, 1175, 7, 'sin(F)+0.2*sin(4*F)')})`) +
      ',afade=t=out:st=0.6:d=0.2[a]',
  },
  {
    // A bright key click over a short low thock, then the key's release tick.
    id: 'keystroke',
    graph:
      `${noise(0.09, 'white', 37, 0.9)},bandpass=f=3800:t=h:w=3000,afade=t=out:d=0.03:curve=exp[click];` +
      tone(
        0.09,
        '0.3*sin(2*PI*230*t)*exp(-110*t)*min(1,t*2000)+0.35*gte(t,0.03)*sin(2*PI*1700*(t-0.03))*exp(-180*(t-0.03))'
      ) +
      '[thock];[click][thock]amix=inputs=2:normalize=0,afade=t=out:st=0.07:d=0.02[a]',
  },
  {
    // A soft square-ish beep gliding up from 900 Hz.
    id: 'blip',
    graph:
      tone(0.12, 'tanh(2*sin(2*PI*(900*t+3000*t*t)))*exp(-22*t)*min(1,t*1000)') +
      ',lowpass=f=6000,afade=t=out:st=0.1:d=0.02[a]',
  },
  {
    // A half-second riser: a sweep from 350 Hz with rising air, peaking at its end.
    id: 'rise-short',
    graph:
      `${tone(0.6, '0.5*sin(2*PI*(350*t+900*t*t))*(t/0.6)^1.5')}[sweep];` +
      `${noise(0.6, 'white', 41, 0.35)},highpass=f=3000,afade=t=in:d=0.58:curve=exp[air];` +
      '[sweep][air]amix=inputs=2:normalize=0,afade=t=out:st=0.58:d=0.02[a]',
  },
  {
    // The arcade pickup: a short B5 then a ringing E6, both square-ish.
    id: 'coin',
    graph:
      tone(
        0.6,
        'lt(t,0.07)*tanh(1.6*sin(2*PI*988*t))*min(1,t*800)*min(1,(0.07-t)*800)+' +
          'gte(t,0.07)*tanh(1.6*sin(2*PI*1319*(t-0.07)))*exp(-6*(t-0.07))*min(1,(t-0.07)*800)'
      ) + ',lowpass=f=9000,afade=t=out:st=0.45:d=0.15[a]',
  },
  {
    // Snare strokes at 24 a second, alternating hands, swelling to the end; soft-clipped to keep it dense.
    id: 'drum-roll',
    graph:
      `${noise(1.5, 'white', 43, 0.9)},highpass=f=250,lowpass=f=7000[snare];` +
      tone(
        1.5,
        'st(0,t*24-floor(t*24));(0.35+0.65*(t/1.5)^1.6)*(0.85+0.15*mod(floor(t*24),2))*exp(-3.5*ld(0))*min(1,ld(0)*60)'
      ) +
      '[env];[snare][env]amultiply,volume=3,asoftclip=type=tanh,lowpass=f=6000,afade=t=out:st=1.47:d=0.03[a]',
  },
  {
    // Lub-dub: two saturated low thumps 0.26 s apart, the second softer.
    id: 'heartbeat',
    graph:
      tone(
        1,
        'tanh(2.5*(sin(2*PI*(52*t+40*(1-exp(-20*t))/20))*exp(-14*t)*min(1,t*400)+' +
          '0.75*gte(t,0.26)*sin(2*PI*(46*(t-0.26)+35*(1-exp(-20*(t-0.26)))/20))*exp(-12*(t-0.26))*min(1,(t-0.26)*400)))'
      ) + ',lowpass=f=380,afade=t=out:st=0.8:d=0.2[a]',
  },
];

// FFmpeg reports on stderr; returned whole so volumedetect's peak can be read from it.
function ffmpeg(args: string[]): string {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr}`);
  }

  return result.stderr;
}

function measurePeak(wav: string): number {
  const report = ffmpeg(['-i', wav, '-af', 'volumedetect', '-f', 'null', '-']);
  const match = /max_volume: (-?[\d.]+) dB/.exec(report);

  return match ? Number(match[1]) : 0;
}

function render(recipe: SfxRecipe): void {
  const raw = path.join(outDir, `${recipe.id}.raw.wav`);
  const out = path.join(outDir, `${recipe.id}.m4a`);

  ffmpeg(['-y', '-filter_complex', recipe.graph, '-map', '[a]', '-ac', '2', '-c:a', 'pcm_s16le', raw]);
  const gain = (PEAK_DBFS - measurePeak(raw)).toFixed(2);
  const level = ['-af', `volume=${gain}dB`, '-ar', String(RATE), '-ac', '2'];
  const encode = [
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
  ];

  ffmpeg(['-y', '-i', raw, ...level, ...encode, out]);
  rmSync(raw);
  console.log(`wrote ${out} (gain ${gain} dB)`);
}

mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);

for (const recipe of [...RECIPES, ...PROMO_RECIPES]) {
  if (only.length === 0 || only.includes(recipe.id)) render(recipe);
}
