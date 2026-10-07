import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';

const validator = new TemplateValidator();

function template(section: Record<string, unknown>, global: Record<string, unknown> = {}): unknown {
  return { global: { musicEnabled: false, ...global }, sections: [{ name: 'clip', ...section }] };
}

function codes(data: unknown): string[] {
  return (validator.validateTemplate(data).errors ?? []).map((error) => error.code);
}

function warnings(data: unknown): string[] {
  return validator.getMotionWarnings(data).map((warning) => warning.code);
}

describe('footage schema', () => {
  it('accepts every footage option on video and project_video', () => {
    const options = {
      duration: 6,
      fit: 'blur',
      fill: { blur: 24, dim: 0.2, zoom: 1.1 },
      focus: [{ t: 0, x: 0.2, y: 0.5, ease: '$snappy' }],
      clip: { from: 1, to: 5 },
      speedRamp: [
        { at: 0, speed: 1 },
        { at: 1, speed: 0.4, ease: 'ease-in-out' },
      ],
      rampAudio: 'mute',
      freeze: [{ at: 2, hold: 0.5, flash: true, audio: 'continue' }],
    };

    expect(codes(template({ type: 'project_video', options }))).toEqual([]);
    expect(codes(template({ type: 'video', options: { ...options, videoUrl: 'x.mp4' } }))).toEqual([]);
    expect(codes(template({ type: 'project_video', options: { speedRamp: 'hero', focus: 'left' } }))).toEqual([]);
  });

  it('keeps time edits off non-footage sections and checks shapes', () => {
    expect(
      validator.validateTemplate(template({ type: 'color_background', options: { clip: { to: 1 } } })).success
    ).toBe(false);
    expect(validator.validateTemplate(template({ type: 'image_background', options: { fit: 'blur' } })).success).toBe(
      true
    );
    expect(validator.validateTemplate(template({ type: 'video', options: { clip: { from: 3, to: 2 } } })).success).toBe(
      false
    );
    expect(validator.validateTemplate(template({ type: 'video', options: { speedRamp: 'warp' } })).success).toBe(false);
    expect(validator.validateTemplate(template({ type: 'video', options: { fit: 'stretch' } })).success).toBe(false);
  });
});

describe('footage rules', () => {
  it('reports unordered ramp and focus keys', () => {
    const data = template({
      type: 'video',
      options: {
        duration: 4,
        speedRamp: [
          { at: 2, speed: 1 },
          { at: 1, speed: 2 },
        ],
        focus: [
          { t: 1, x: 0, y: 0 },
          { t: 1, x: 1, y: 0 },
        ],
      },
    });

    expect(codes(data)).toEqual(['speed_ramp_unordered', 'focus_keys_unordered']);
  });

  it('reports overlapping freezes and freezes past the clip', () => {
    expect(
      codes(
        template({
          type: 'video',
          options: {
            duration: 6,
            freeze: [
              { at: 1, hold: 1 },
              { at: 1.5, hold: 0.5 },
            ],
          },
        })
      )
    ).toEqual(['freeze_overlap']);
    expect(codes(template({ type: 'project_video', options: { duration: 3, freeze: [{ at: 3, hold: 1 }] } }))).toEqual([
      'freeze_outside_clip',
    ]);
    // A clip range of 2 s ends the clip before a freeze at 2.5 s, even under a longer duration.
    expect(
      codes(template({ type: 'video', options: { duration: 6, clip: { to: 2 }, freeze: [{ at: 2.5, hold: 1 }] } }))
    ).toEqual(['freeze_outside_clip']);
  });

  it('reports unknown ease tokens', () => {
    expect(
      codes(template({ type: 'video', options: { duration: 4, speedRamp: [{ at: 0, speed: 1, ease: '$nope' }] } }))
    ).toContain('unknown_motion_token');
  });

  it('resolves time references before checking', () => {
    const data = template(
      {
        type: 'video',
        options: { duration: 4, freeze: [{ at: 'beat:3', hold: 0.5 }], speedRamp: [{ at: 'beat:2', speed: 1 }] },
      },
      { beats: { bpm: 120 } }
    );

    expect(codes(data)).toEqual([]);
    expect(codes(template({ type: 'video', options: { duration: 4, freeze: [{ at: 'cue:nope', hold: 1 }] } }))).toEqual(
      ['unknown_time_ref']
    );
  });
});

describe('footage advisories', () => {
  it('warns on extreme speeds, ignored focus, blur under overlays and a short clip range', () => {
    expect(
      warnings(template({ type: 'video', options: { duration: 4, speedRamp: [{ at: 0, speed: 0.1 }] } }))
    ).toContain('extreme_speed');
    expect(warnings(template({ type: 'video', options: { duration: 4, fit: 'letterbox', focus: 'left' } }))).toContain(
      'focus_ignored'
    );
    expect(
      warnings(
        template({
          type: 'project_video',
          options: { fit: 'blur' },
          inputs: [{ name: 'fx', type: 'animation', url: 'a.webp' }],
        })
      )
    ).toContain('blur_fit_overlaid');
    expect(warnings(template({ type: 'video', options: { duration: 4, clip: { from: 1, to: 2 } } }))).toContain(
      'footage_shortens_section'
    );
    expect(warnings(template({ type: 'video', options: { duration: 4, speedRamp: 'hero', fit: 'blur' } }))).toEqual([]);
  });
});
