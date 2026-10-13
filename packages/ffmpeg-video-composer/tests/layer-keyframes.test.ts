import { describe, expect, it } from 'vitest';
import { layerKeyframes } from '@/editor/presets/layer-keyframes';
import { overlayMotionExpr } from '@/editor/utils/input-sources';
import { InputSchema } from '@/schemas/template.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { motionTimeline } from '@/core/motion/timeline';

// Keyframe tracks on image / animation / html layer inputs (`inputs[].options.animate`): the exact
// filter strings each property lowers to, and the schema and validator findings that guard them.

const LINEAR_1S = 'if(lt(t,0),0,if(lt(t,1),(t-0)/1,1))';
const LINEAR_HALF = 'if(lt(t,0),0,if(lt(t,0.5),(t-0)/0.5,1))';

describe('layerKeyframes: position tracks', () => {
  it('lowers an absolute x track to an overlay x expression, y stays at rest, no leg filters', () => {
    const plan = layerKeyframes({ position: '100:200', animate: { x: [{ v: 0 }, { t: 1, v: 300 }] } }, 30);

    expect(plan).toEqual({ legFilters: [], x: `0+300*(${LINEAR_1S})`, y: '200' });
  });

  it('keeps relative values relative to options.position', () => {
    const plan = layerKeyframes(
      { position: '100:200', animate: { x: [{ v: '-40' }, { t: 0.5, v: '+0' }], y: [{ v: '+30' }] } },
      30
    );

    expect(plan.x).toBe(`(100)-40+40*(${LINEAR_HALF})`);
    expect(plan.y).toBe('(200)+30');
  });

  it('defaults the resting position to the frame origin', () => {
    expect(layerKeyframes({ animate: { y: [{ v: '+10' }] } }, 30)).toEqual({
      legFilters: [],
      x: '0',
      y: '(0)+10',
    });
  });
});

describe('layerKeyframes: scale', () => {
  const S = `0+1*(${LINEAR_HALF})`;

  it('scales per frame from the layer box, about its centre, on the section frame rate', () => {
    const plan = layerKeyframes(
      { position: '100:50', scale: '200:100', animate: { scale: [{ v: 0 }, { t: 0.5, v: 1 }] } },
      30
    );

    expect(plan).toEqual({
      legFilters: ['fps=30', `scale=w='max(2,2*trunc(100*(${S})+0.5))':h='max(2,2*trunc(50*(${S})+0.5))':eval=frame`],
      x: '200-w/2',
      y: '100-h/2',
    });
  });

  it('multiplies scale with scaleX / scaleY for squash and stretch', () => {
    const plan = layerKeyframes(
      {
        position: '0:0',
        scale: '200:100',
        animate: { scale: [{ v: 0 }, { t: 0.5, v: 1 }], scaleX: [{ v: 1.2 }], scaleY: [{ v: 0.8 }] },
      },
      30
    );

    expect(plan.legFilters[1]).toBe(
      `scale=w='max(2,2*trunc(100*((${S})*(1.2))+0.5))':h='max(2,2*trunc(50*((${S})*(0.8))+0.5))':eval=frame`
    );
  });

  it('pins the chosen origin: top-left keeps the corner, bottom keeps the bottom edge centre', () => {
    const scale = [{ v: 0.5 }];
    const topLeft = layerKeyframes({ position: '10:20', scale: '200:100', origin: 'top-left', animate: { scale } }, 30);
    const bottom = layerKeyframes({ position: '10:20', scale: '200:100', origin: 'bottom', animate: { scale } }, 30);

    expect([topLeft.x, topLeft.y]).toEqual(['10', '20']);
    expect([bottom.x, bottom.y]).toEqual(['110-w/2', '120-h']);
  });

  it('keeps the static fit box (contain) and scales the boxed frame', () => {
    const plan = layerKeyframes(
      { position: '0:0', scale: '200:100', fit: 'contain', animate: { scale: [{ v: 2 }] } },
      30
    );

    expect(plan.legFilters).toEqual([
      'fps=30',
      'scale=200:100:force_original_aspect_ratio=decrease',
      'format=rgba',
      'pad=200:100:(ow-iw)/2:(oh-ih)/2:color=black@0',
      'setsar=1',
      "scale=w='max(2,2*trunc(100*(2)+0.5))':h='max(2,2*trunc(50*(2)+0.5))':eval=frame",
    ]);
  });

  it('reads w / h in an authored position as the resting box', () => {
    const plan = layerKeyframes({ position: '(W-w)/2:(H-h)/2', scale: '200:100', animate: { scale: [{ v: 1 }] } }, 30);

    expect(plan.x).toBe('((W-200)/2)+100-w/2');
    expect(plan.y).toBe('((H-100)/2)+50-h/2');
  });

  it('refuses a transform track when the layer box is unknown', () => {
    expect(() => layerKeyframes({ position: '0:0', animate: { scale: [{ v: 1 }] } }, 30)).toThrow(/options\.scale/);
  });
});

describe('layerKeyframes: rotate', () => {
  const R = `-60+80*(${LINEAR_1S})`;

  it('turns the layer in a transparent square that holds its diagonal, centre fixed', () => {
    const plan = layerKeyframes(
      { position: '100:50', scale: '200:100', animate: { rotate: [{ v: -60 }, { t: 1, v: 20 }] } },
      30
    );

    expect(plan).toEqual({
      legFilters: [
        'fps=30',
        'scale=200:100',
        'setsar=1',
        'format=rgba',
        `rotate=a='(${R})*PI/180':ow=226:oh=226:c=black@0`,
      ],
      x: '200-w/2',
      y: '100-h/2',
    });
  });

  it('pivots about a non-centre origin (a needle about its base)', () => {
    const plan = layerKeyframes(
      { position: '300:100', scale: '40:200', origin: 'bottom', animate: { rotate: [{ v: -60 }, { t: 1, v: 20 }] } },
      30
    );
    const angle = `(${R})*PI/180`;

    expect(plan.x).toBe(`320+100*sin(${angle})-w/2`);
    expect(plan.y).toBe(`300-100*cos(${angle})-h/2`);
  });

  it('applies relative rotate keys on top of options.rotation, and folds a static rotation into the turn', () => {
    const relative = layerKeyframes(
      { position: '0:0', scale: '100:100', rotation: 10, animate: { rotate: [{ v: '+5' }] } },
      30
    );
    const folded = layerKeyframes(
      { position: '0:0', scale: '100:100', rotation: 10, animate: { scale: [{ v: 1.5 }] } },
      30
    );

    expect(relative.legFilters.at(-1)).toBe("rotate=a='((10)+5)*PI/180':ow=144:oh=144:c=black@0");
    expect(folded.legFilters).toEqual([
      'fps=30',
      'scale=100:100',
      'setsar=1',
      'format=rgba',
      "rotate=a='(10)*PI/180':ow=144:oh=144:c=black@0",
      "scale=w='max(2,2*trunc(72*(1.5)+0.5))':h='max(2,2*trunc(72*(1.5)+0.5))':eval=frame",
    ]);
  });

  it('scales the turned square in screen space and moves the centre with the scale', () => {
    const plan = layerKeyframes(
      {
        position: '0:0',
        scale: '40:200',
        origin: 'bottom',
        rotation: 90,
        animate: { scale: [{ v: 2 }] },
      },
      30
    );

    // A constant angle is folded at compile time: cos 90° = 0, sin 90° = 1.
    expect(plan.x).toBe('20+100*(2)-w/2');
    expect(plan.y).toBe('200-h/2');
  });
});

describe('layerKeyframes: opacity', () => {
  it('steps the alpha once per frame, one gated colorchannelmixer per level, opaque frames untouched', () => {
    const plan = layerKeyframes({ position: '0:0', animate: { opacity: [{ v: 0 }, { t: 0.3, v: 1 }] } }, 10);

    expect(plan.legFilters).toEqual([
      'fps=10',
      'format=rgba',
      "colorchannelmixer=aa=0:enable='lt(t,0.05)'",
      "colorchannelmixer=aa=0.34:enable='gte(t,0.05)*lt(t,0.15)'",
      "colorchannelmixer=aa=0.66:enable='gte(t,0.15)*lt(t,0.25)'",
    ]);
  });

  it('joins every window of a level that comes back (fade in, then out)', () => {
    const plan = layerKeyframes(
      { position: '0:0', animate: { opacity: [{ v: 0 }, { t: 0.1, v: 1 }, { t: 0.2, v: 0 }] } },
      10
    );

    expect(plan.legFilters).toEqual([
      'fps=10',
      'format=rgba',
      "colorchannelmixer=aa=0:enable='lt(t,0.05)+gte(t,0.15)'",
    ]);
  });

  it('multiplies the static opacity, ungated when the track holds one level throughout', () => {
    const plan = layerKeyframes({ position: '0:0', opacity: 0.5, animate: { opacity: [{ v: 0.5 }] } }, 10);

    expect(plan.legFilters).toEqual(['fps=10', 'format=rgba', 'colorchannelmixer=aa=0.5', 'colorchannelmixer=aa=0.5']);
  });

  it('clamps values into 0..1: a key above 1 draws the layer opaque', () => {
    const plan = layerKeyframes({ position: '0:0', animate: { opacity: [{ v: 1.4 }] } }, 10);

    expect(plan.legFilters).toEqual(['fps=10', 'format=rgba']);
  });
});

describe('layerKeyframes: with an entrance motion', () => {
  it('lets a y track override a rise on its axis, the other axis keeps the entrance', () => {
    const motion = overlayMotionExpr('slide-left', '100:200');
    const plan = layerKeyframes({ position: '100:200', motion: 'slide-left', animate: { y: [{ v: '+20' }] } }, 30);

    expect(plan.x).toBe(motion.x);
    expect(plan.y).toBe('(200)+20');
  });

  it('keeps a fade entrance unless an opacity track replaces it', () => {
    const kept = layerKeyframes({ position: '0:0', motion: 'fade', animate: { x: [{ v: 5 }] } }, 30);
    const replaced = layerKeyframes({ position: '0:0', motion: 'fade', animate: { opacity: [{ v: 1 }] } }, 30);

    expect(kept.legFilters).toEqual(['format=rgba', 'fade=t=in:st=0.3:d=0.6:alpha=1']);
    expect(replaced.legFilters).toEqual(['fps=30', 'format=rgba']);
  });
});

describe('layer animate schema', () => {
  const card = { name: 'card', type: 'image', url: 'card.png' };

  it('accepts every track, the origin and the text key shape', () => {
    const parsed = InputSchema.safeParse({
      ...card,
      options: {
        scale: '200:100',
        origin: 'bottom-left',
        animate: {
          x: [{ v: '+80' }, { t: 1, v: '+0', ease: '$snappy' }],
          y: [{ v: 10 }],
          scale: [{ v: 0 }, { t: 0.4, v: 1, ease: 'spring(300, 14)' }],
          scaleX: [{ v: 1 }],
          scaleY: [{ v: 1 }],
          rotate: [{ v: -10 }, { t: 'end - 0.5', v: 10 }],
          opacity: [{ v: 0 }, { t: '+0.3', v: 1 }],
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown track and an unknown origin', () => {
    expect(InputSchema.safeParse({ ...card, options: { animate: { rotation: [{ v: 1 }] } } }).success).toBe(false);
    expect(InputSchema.safeParse({ ...card, options: { origin: 'middle' } }).success).toBe(false);
  });
});

describe('layer animate validation', () => {
  const validator = new TemplateValidator();

  function findings(options: Record<string, unknown>, input: Record<string, unknown> = {}) {
    const descriptor = {
      sections: [
        {
          name: 'card',
          type: 'color_background',
          options: { backgroundColor: '#141416', duration: 3 },
          inputs: [{ name: 'card', type: 'image', url: 'card.png', ...input, options }],
        },
      ],
    };

    return (validator.validateTemplate(descriptor).errors ?? []).map((error) => [
      error.code,
      error.path,
      error.message,
    ]);
  }

  it('accepts a well-formed layer animation', () => {
    expect(
      findings({ scale: '200:100', animate: { scale: [{ v: 0 }, { t: 0.4, v: 1.2 }, { t: 0.6, v: 1 }] } })
    ).toEqual([]);
  });

  it('names an unknown track with the nearest one', () => {
    const errors = validator.validateTemplate({
      sections: [
        {
          name: 'card',
          type: 'color_background',
          options: { backgroundColor: '#141416', duration: 3 },
          inputs: [{ name: 'card', type: 'image', url: 'card.png', options: { animate: { scalex: [{ v: 1 }] } } }],
        },
      ],
    }).errors;

    expect(errors?.map((error) => [error.code, error.suggestion])).toEqual([['unknown_key', 'scaleX']]);
  });

  it('reports unsorted and duplicate keys', () => {
    expect(
      findings({
        animate: {
          x: [
            { t: 1, v: 0 },
            { t: 0.5, v: 10 },
          ],
        },
      })
    ).toEqual([['invalid_keyframes', 'sections[0].inputs[0].options.animate.x', 'key 1 (t=0.5) is not after key 0']]);
    expect(
      findings({
        animate: {
          y: [
            { t: 1, v: 0 },
            { t: 1, v: 10 },
          ],
        },
      })
    ).toEqual([['invalid_keyframes', 'sections[0].inputs[0].options.animate.y', 'key 1 (t=1) is not after key 0']]);
  });

  it('reports out-of-range opacity and scale, and relative keys where they mean nothing', () => {
    expect(findings({ animate: { opacity: [{ v: 0 }, { t: 1, v: 1.5 }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].inputs[0].options.animate.opacity',
        'opacity keys take values from 0 to 1 (got 1.5)',
      ],
    ]);
    expect(findings({ scale: '10:10', animate: { scaleX: [{ v: -1 }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].inputs[0].options.animate.scaleX',
        'scaleX keys take values from 0 to 10 (got -1)',
      ],
    ]);
    expect(findings({ scale: '10:10', animate: { scale: [{ v: '+1' }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].inputs[0].options.animate.scale',
        'scale keys take plain numbers, not relative offsets',
      ],
    ]);
  });

  it('asks for the layer box before a scale or rotate track, except on an html layer', () => {
    expect(findings({ animate: { rotate: [{ v: 10 }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].inputs[0].options.animate.rotate',
        'a rotate track needs the layer size: set options.scale to "W:H" pixels',
      ],
    ]);
    expect(
      findings(
        { animate: { scale: [{ v: 1 }] } },
        { type: 'html', url: undefined, html: '<div>Hi</div>', width: 200, height: 100 }
      )
    ).toEqual([]);
  });

  it('refuses tracks on an input that is not an image, animation or html layer', () => {
    expect(findings({ animate: { x: [{ v: 1 }] } }, { type: undefined })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].inputs[0].options.animate',
        'animate tracks apply to image, animation and html inputs',
      ],
    ]);
  });

  it('resolves time references in layer keys to section seconds', () => {
    const { descriptor } = resolveTimeRefs(
      {
        sections: [
          {
            name: 'card',
            type: 'color_background',
            options: { backgroundColor: '#141416', duration: 3 },
            inputs: [
              {
                name: 'card',
                type: 'image',
                url: 'card.png',
                options: { animate: { x: [{ v: 0 }, { t: 'end - 1', v: 9 }] } },
              },
            ],
          },
        ],
      } as unknown as Parameters<typeof resolveTimeRefs>[0],
      { deferBeatsAnalysis: true }
    );

    expect(
      ((descriptor as { sections: unknown[] }).sections as Array<Record<string, any>>)[0].inputs[0].options.animate.x[1]
        .t
    ).toBe(2);
  });
});

describe('layer keyframes on the motion timeline', () => {
  const descriptor = {
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#141416', duration: 4 },
        inputs: [
          {
            name: 'card',
            type: 'image',
            url: 'card.png',
            options: {
              scale: '200:100',
              start: 0.5,
              animate: {
                scale: [
                  { t: 0.5, v: 0 },
                  { t: 1, v: 1, ease: 'ease-out' },
                ],
                x: [
                  { t: 3, v: 0 },
                  { t: 3.6, v: 90 },
                ],
              },
            },
          },
        ],
      },
    ],
  };

  it('is one animate event from the first key to the last, visible from the layer start', () => {
    const [event] = motionTimeline(descriptor).sections[0].events;

    expect(event).toMatchObject({
      path: 'sections[0].inputs[0].options.animate',
      element: 'inputs[0]',
      kind: 'animate',
      start: 0.5,
      end: 3.6,
      ease: 'ease-out',
      visibleFrom: 0.5,
      visibleUntil: 4,
    });
  });

  it('counts as motion for the pacing lint (no dead air while the layer moves)', () => {
    const warnings = new TemplateValidator().getMotionWarnings(descriptor as never);

    expect(warnings.map((warning) => warning.code)).not.toContain('dead_air');
  });
});
