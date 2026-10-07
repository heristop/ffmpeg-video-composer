import { describe, expect, it } from 'vitest';
import { VOICE_PRESETS, voiceChain } from '@/core/audio/voice-presets';
import { automationExpr, automationFilter } from '@/core/audio/automation';
import { buildAudioFadeArg } from '@/editor/utils/audio-fade';
import { musicAutomationSuffix, musicMixGraph } from '@/editor/utils/music-mix';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import type { ProjectConfig, SectionOptions, TemplateDescriptorGlobal } from '@/core/types';

const CHANNEL = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';

function gainAt(expr: string, t: number): number {
  return evaluateExpr(expr, { t }) as number;
}

describe('voice presets', () => {
  it('lowers clean to highpass, light denoise, presence EQ, gentle compression and a -1 dB limiter', () => {
    expect(voiceChain('clean')).toEqual([
      'highpass=f=80',
      'afftdn=nr=8:nf=-45',
      'equalizer=f=250:t=o:w=1:g=-3',
      'equalizer=f=3000:t=o:w=1:g=3',
      'acompressor=threshold=0.125:ratio=2.5:attack=20:release=250:makeup=1.5',
      'alimiter=limit=0.891:level=0:latency=1',
    ]);
  });

  it('gives broadcast stronger compression and presence than clean', () => {
    const chain = voiceChain('broadcast').join(',');

    expect(chain).toContain('ratio=4');
    expect(chain).toContain('equalizer=f=3500:t=o:w=1:g=5');
  });

  it('keeps rumble-cut to a single highpass and room-gate to a gate', () => {
    expect(voiceChain('rumble-cut')).toEqual(['highpass=f=100']);
    expect(voiceChain('room-gate').at(-1)).toMatch(/^agate=/);
    expect(voiceChain('warm').join(',')).toContain('equalizer=f=200:t=o:w=2:g=3');
  });

  it('degrades to the stages the engine has instead of failing', () => {
    const old = new Set(['highpass', 'lowpass', 'afftdn']);

    expect(voiceChain('clean', old)).toEqual(['highpass=f=80', 'afftdn=nr=8:nf=-45']);
    expect(voiceChain('room-gate', old)).toEqual(['highpass=f=80']);

    for (const preset of VOICE_PRESETS) {
      expect(voiceChain(preset, DEVICE_FILTERS)).toEqual(voiceChain(preset));
    }
  });
});

describe('section audio chain', () => {
  const device = { codecConfig: { videoCodec: 'libopenh264' } } as unknown as ProjectConfig;

  it('orders voice, effect, automation, then fades', () => {
    const options: SectionOptions = {
      duration: 4,
      voice: 'rumble-cut',
      audioEffect: 'muffled',
      audioAutomation: [
        { at: 0, volume: 1 },
        { at: 2, volume: 0.5 },
      ],
      audioFade: { in: { duration: 0.5 } },
    };
    const arg = buildAudioFadeArg(options, false, device);

    expect(arg).toBe(
      ` -af "highpass=f=100,lowpass=f=1200,volume=eval=frame:volume='max(0,1+-0.5*(if(lt(t,0),0,if(lt(t,2),(t-0)/2,1))))',afade=t=in:st=0:d=0.5" `
    );
  });

  it('emits nothing for a muted section', () => {
    expect(buildAudioFadeArg({ voice: 'clean', muteSection: true })).toBe('');
  });

  it('refuses an unresolved time reference rather than rendering a wrong level', () => {
    expect(() => buildAudioFadeArg({ audioAutomation: [{ at: 'cue:drop', volume: 1 }] })).toThrow(/not resolved/);
  });
});

describe('volume automation', () => {
  it('holds the first level, ramps linearly between keys and holds the last', () => {
    const expr = automationExpr([
      { at: 1, volume: 1 },
      { at: 3, volume: 0.2 },
      { at: 4, volume: 0.6 },
    ]) as string;

    expect(gainAt(expr, 0)).toBeCloseTo(1, 6);
    expect(gainAt(expr, 1)).toBeCloseTo(1, 6);
    expect(gainAt(expr, 2)).toBeCloseTo(0.6, 6);
    expect(gainAt(expr, 3)).toBeCloseTo(0.2, 6);
    expect(gainAt(expr, 3.5)).toBeCloseTo(0.4, 6);
    expect(gainAt(expr, 10)).toBeCloseTo(0.6, 6);
  });

  it('eases through the shared Hermite lowering and never goes negative', () => {
    const expr = automationExpr([
      { at: 0, volume: 0 },
      { at: 1, volume: 1, ease: 'ease-in-out' },
      { at: 1.5, volume: 0, ease: 'spring(300,10)' },
    ]) as string;

    expect(gainAt(expr, 0.5)).toBeCloseTo(0.5, 2);
    // ease-in-out is slow at the start: below the linear ramp at a quarter.
    expect(gainAt(expr, 0.25)).toBeLessThan(0.25);
    expect(gainAt(expr, 1)).toBeCloseTo(1, 3);

    for (let t = 1; t <= 3; t += 0.05) expect(gainAt(expr, t)).toBeGreaterThanOrEqual(0);
  });

  it('orders keys by time and turns a repeated time into a 1 ms step', () => {
    const expr = automationExpr([
      { at: 2, volume: 0 },
      { at: 0, volume: 1 },
      { at: 2, volume: 1 },
    ]) as string;

    expect(gainAt(expr, 1)).toBeCloseTo(0.5, 6);
    expect(gainAt(expr, 2)).toBeCloseTo(0, 6);
    expect(gainAt(expr, 2.5)).toBeCloseTo(1, 6);
  });

  it('is absent without keys', () => {
    expect(automationExpr([])).toBeNull();
    expect(automationFilter(undefined)).toBeNull();
  });
});

describe('music bed automation', () => {
  const global: TemplateDescriptorGlobal = {
    audio: {
      ducking: true,
      automation: [
        { at: 0, volume: 1 },
        { at: 2, volume: 0.25 },
      ],
    },
  };

  it('runs on the formatted bed, before the ducking sidechain', () => {
    const graph = musicMixGraph({
      global,
      musicFilters: [],
      multipleSegments: false,
      audioVolumeLevel: 1,
      reduceNoiseConfig: 'afftdn=nr=20:nf=-20',
      channelConfig: CHANNEL,
      hasSegmentAudio: true,
    });
    const music = graph.indexOf(`[1:a]${CHANNEL}${musicAutomationSuffix(global)}[music_formatted]`);

    expect(music).toBeGreaterThan(-1);
    expect(graph.indexOf('sidechaincompress')).toBeGreaterThan(music);
  });

  it('leaves the graph untouched without automation', () => {
    const plain = musicMixGraph({
      global: { audio: { ducking: true } },
      musicFilters: [],
      multipleSegments: false,
      audioVolumeLevel: 1,
      reduceNoiseConfig: 'afftdn=nr=20:nf=-20',
      channelConfig: CHANNEL,
      hasSegmentAudio: true,
    });

    expect(plain).not.toContain('eval=frame');
    expect(plain).toContain('[1:a]' + CHANNEL + '[music_formatted]');
  });
});
