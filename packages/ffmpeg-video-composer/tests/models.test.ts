import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import Template from '@/core/models/Template';
import Project from '@/core/models/Project';
import Segment from '@/core/models/Segment';
import DefaultConfig from '@/core/default.config';

// A minimal descriptor that satisfies TemplateDescriptorSchema (global? + sections?).
const validDescriptor = {
  global: { orientation: 'landscape' as const },
  sections: [
    {
      name: 'main',
      type: 'video' as const,
      options: { duration: 5 },
    },
  ],
};

describe('Template', () => {
  let template: Template;

  beforeEach(() => {
    template = new Template();
  });

  it('starts with an empty descriptor and empty asset buckets', () => {
    expect(template.descriptor).toEqual({});
    expect(template.assets).toEqual({ fonts: {}, musics: {}, inputs: [] });
  });

  describe('init / clean', () => {
    it('resets assets back to empty buckets', () => {
      template.assets.fonts = { Roboto: '/fonts/roboto.ttf' };
      template.assets.inputs = ['something'] as unknown as [];

      template.init();

      expect(template.assets).toEqual({ fonts: {}, musics: {}, inputs: [] });
    });

    it('clean() delegates to init() and resets assets', () => {
      template.assets.musics = { theme: '/m.mp3' };

      template.clean();

      expect(template.assets).toEqual({ fonts: {}, musics: {}, inputs: [] });
    });
  });

  describe('setDescriptor', () => {
    it('stores the descriptor and returns a successful validation result for valid input', () => {
      const result = template.setDescriptor(validDescriptor);

      expect(result.success).toBe(true);
      expect(template.descriptor).toEqual(validDescriptor);
    });

    it('does not mutate the descriptor and returns failure for invalid input', () => {
      const result = template.setDescriptor(42);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(template.descriptor).toEqual({});
    });

    it('accepts an empty object as a valid descriptor', () => {
      const result = template.setDescriptor({});

      expect(result.success).toBe(true);
      expect(template.descriptor).toEqual({});
    });
  });

  describe('validateDescriptor', () => {
    it('validates the currently stored descriptor', () => {
      template.setDescriptor(validDescriptor);

      const result = template.validateDescriptor();

      expect(result.success).toBe(true);
    });

    it('reports success for the default empty descriptor', () => {
      expect(template.validateDescriptor().success).toBe(true);
    });
  });

  describe('loadFromJSON', () => {
    it('parses and stores a descriptor from a valid JSON string', () => {
      const result = template.loadFromJSON(JSON.stringify(validDescriptor));

      expect(result.success).toBe(true);
      expect(template.descriptor).toEqual(validDescriptor);
    });

    it('returns failure and leaves descriptor untouched for malformed JSON', () => {
      const result = template.loadFromJSON('{ not valid json');

      expect(result.success).toBe(false);
      expect(template.descriptor).toEqual({});
    });

    it('returns failure for JSON that is valid but fails schema validation', () => {
      const result = template.loadFromJSON(JSON.stringify(42));

      expect(result.success).toBe(false);
      expect(template.descriptor).toEqual({});
    });
  });
});

describe('Project', () => {
  let project: Project;

  beforeEach(() => {
    project = new Project();
  });

  it('initializes config empty and buildInfos with zeroed counters', () => {
    expect(project.config).toEqual({});
    expect(project.finalVideo).toBe('');
    expect(project.progress).toBe(0);
    expect(project.errors).toEqual([]);
    expect(project.buildInfos).toEqual({
      totalSegments: 0,
      totalLength: 0,
      currentLength: 0,
      currentProgress: 0,
      currentIncrement: 0,
      durations: {},
      sourceDurations: {},
      sourceHasAudio: {},
      videoInputs: [],
      musicInputs: [],
      musicFilters: [],
      fileConcatPath: '',
      musicPath: '',
      transitions: [],
    });
  });

  describe('init / clean', () => {
    it('resets buildInfos to its initial shape', () => {
      project.buildInfos.totalSegments = 9;
      project.buildInfos.durations = { intro: 1, body: 2, outro: 3 };

      project.init();

      expect(project.buildInfos.totalSegments).toBe(0);
      expect(project.buildInfos.durations).toEqual({});
    });

    it('clean() delegates to init()', () => {
      project.buildInfos.currentProgress = 50;

      project.clean();

      expect(project.buildInfos.currentProgress).toBe(0);
    });
  });

  describe('resetBuildState', () => {
    it('clears every build-accumulated field IN PLACE, plus errors and finalVideo', () => {
      // Same array references before/after — components hold this singleton and must keep seeing them.
      const videoInputs = project.buildInfos.videoInputs;
      project.buildInfos.videoInputs.push('/build/stale_output.mp4');
      project.buildInfos.musicInputs.push('/build/m.mp4');
      project.buildInfos.musicFilters.push('[stale];');
      project.buildInfos.transitions.push({ type: 'fade', duration: 0.3 });
      project.buildInfos.durations = { stale: 12 };
      project.buildInfos.sourceHasAudio = { stale: true };
      project.buildInfos.currentIncrement = 4;
      project.buildInfos.currentLength = 42;
      project.buildInfos.totalLength = 42;
      project.buildInfos.musicPath = '/build/loop_music.mp4';
      project.errors.push('prior-section');
      project.finalVideo = '/build/old.mp4';

      project.resetBuildState();

      expect(project.buildInfos.videoInputs).toBe(videoInputs); // same reference (in-place)
      expect(project.buildInfos.videoInputs).toEqual([]);
      expect(project.buildInfos.musicInputs).toEqual([]);
      expect(project.buildInfos.musicFilters).toEqual([]);
      expect(project.buildInfos.transitions).toEqual([]);
      expect(project.buildInfos.durations).toEqual({});
      expect(project.buildInfos.sourceHasAudio).toEqual({});
      expect(project.buildInfos.currentIncrement).toBe(0);
      expect(project.buildInfos.currentLength).toBe(0);
      expect(project.buildInfos.totalLength).toBe(0);
      // A compile whose music is enabled but resolves no track must not mix, or loop over, the last build's copy.
      expect(project.buildInfos.musicPath).toBe('');
      expect(project.errors).toEqual([]);
      expect(project.finalVideo).toBe('');
    });
  });

  describe('applyDefault', () => {
    it('fills in every default config block when config is empty', () => {
      project.applyDefault();

      expect(project.config.codecConfig).toEqual({
        videoCodec: DefaultConfig.VIDEO_CODEC,
        audioCodec: DefaultConfig.AUDIO_CODEC,
      });
      expect(project.config.hardwareConfig).toEqual({
        hwaccel: DefaultConfig.HWACCEL,
        preset: DefaultConfig.PRESET,
      });
      expect(project.config.audioConfig).toEqual({
        sampleRate: DefaultConfig.SAMPLE_RATE,
        channelLayout: DefaultConfig.CHANNEL_LAYOUT,
      });
      expect(project.config.videoConfig).toEqual({
        orientation: DefaultConfig.ORIENTATION,
        scale: DefaultConfig.SCALE,
        setsar: DefaultConfig.SETSAR,
      });
      expect(project.config.currentLocale).toBe(DefaultConfig.CURRENT_LOCALE);
    });

    it('merges a user-provided nested config block over the defaults, keeping unset fields', () => {
      project.config = {
        currentLocale: 'fr',
        hardwareConfig: { preset: 'fast' },
        videoConfig: { scale: '1920:1080' },
      };

      project.applyDefault();

      expect(project.config.currentLocale).toBe('fr');
      expect(project.config.hardwareConfig?.preset).toBe('fast');
      // A partial block only overrides the fields it names; the rest keep their defaults.
      expect(project.config.hardwareConfig?.hwaccel).toBe(DefaultConfig.HWACCEL);
      expect(project.config.videoConfig?.scale).toBe('1920:1080');
      expect(project.config.videoConfig?.orientation).toBe(DefaultConfig.ORIENTATION);
      // Blocks the user did NOT provide still receive their full defaults.
      expect(project.config.audioConfig).toEqual({
        sampleRate: DefaultConfig.SAMPLE_RATE,
        channelLayout: DefaultConfig.CHANNEL_LAYOUT,
      });
      expect(project.config.codecConfig).toEqual({
        videoCodec: DefaultConfig.VIDEO_CODEC,
        audioCodec: DefaultConfig.AUDIO_CODEC,
      });
    });

    // Regression guard: the old trailing `...this.config` spread re-applied the caller's RAW
    // partial blocks over the merged ones, so `audioConfig: { sampleRate }` dropped
    // channelLayout and addBlankAudio emitted `anullsrc=channel_layout=:…`, which ffmpeg
    // rejects on every color/image-background section.
    it('keeps channelLayout when the caller provides only a sampleRate', () => {
      project.config = { audioConfig: { sampleRate: 44100 } };

      project.applyDefault();

      expect(project.config.audioConfig).toEqual({
        sampleRate: 44100,
        channelLayout: DefaultConfig.CHANNEL_LAYOUT,
      });
    });

    it('preserves config fields outside the merged blocks', () => {
      project.config = { buildDir: '/tmp/b', userVideoPaths: { intro: '/tmp/a.mp4' } };

      project.applyDefault();

      expect(project.config.buildDir).toBe('/tmp/b');
      expect(project.config.userVideoPaths).toEqual({ intro: '/tmp/a.mp4' });
    });

    it('keeps an explicitly provided currentLocale via the nullish branch', () => {
      project.config = { currentLocale: 'es' };

      project.applyDefault();

      expect(project.config.currentLocale).toBe('es');
    });
  });
});

describe('Segment', () => {
  it('initializes all collection and counter fields to empty defaults', () => {
    const segment = new Segment();

    expect(segment.currentSection).toBeUndefined();
    expect(segment.filtersList).toEqual([]);
    expect(segment.filtersMapList).toEqual([]);
    expect(segment.mapsList).toEqual([]);
    expect(segment.assetsDir).toBe('');
    expect(segment.fontsDir).toBe('');
    expect(segment.tempFonts).toEqual([]);
    expect(segment.inputsAsset).toEqual([]);
    expect(segment.inputsMapCount).toBe(0);
  });

  it('allows mutating its public fields', () => {
    const segment = new Segment();

    segment.assetsDir = '/assets';
    segment.inputsMapCount = 3;
    segment.filtersList.push('scale=1280:720');

    expect(segment.assetsDir).toBe('/assets');
    expect(segment.inputsMapCount).toBe(3);
    expect(segment.filtersList).toEqual(['scale=1280:720']);
  });
});
