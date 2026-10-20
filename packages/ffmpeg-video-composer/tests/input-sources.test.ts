import { describe, it, expect } from 'vitest';
import {
  buildAnimationLegFilters,
  buildGradientSource,
  buildSingleFileAnimationSource,
  isStillAnimation,
  isStillAnimationUrl,
  overlayMotionExpr,
  resolveLayerGeometry,
} from '@/editor/utils/input-sources';

// overlayMotionExpr maps a reveal intent to overlay-filter (W,H,w,h,t) coordinates. These assert the
// exact expressions so a regression in the entrance math is caught.
describe('overlayMotionExpr', () => {
  const RAMP = 'if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))';

  it('returns nothing for undefined or "none"', () => {
    expect(overlayMotionExpr(undefined, '0:0')).toEqual({});
    expect(overlayMotionExpr('none', '0:0')).toEqual({});
  });

  it('rise lifts y from below the base position', () => {
    expect(overlayMotionExpr('rise', '40:200')).toEqual({ x: '40', y: `(200)+round((1-(${RAMP}))*60)` });
  });

  it('slide-left enters from the right of the base x', () => {
    expect(overlayMotionExpr('slide-left', '40:200')).toEqual({ x: `(40)+round((1-(${RAMP}))*60)`, y: '200' });
  });

  it('slide-right enters from the left of the base x', () => {
    expect(overlayMotionExpr('slide-right', '40:200')).toEqual({ x: `(40)-round((1-(${RAMP}))*60)`, y: '200' });
  });

  it('fade emits an alpha fade-in leg filter, no position change', () => {
    expect(overlayMotionExpr('fade', '40:200')).toEqual({ legFilter: 'fade=t=in:st=0.3:d=0.6:alpha=1' });
  });

  it('honours custom timing/distance overrides', () => {
    const expr = overlayMotionExpr({ type: 'rise', delay: 0.5, duration: 1, distance: 100 }, '0:0');
    expect(expr.y).toBe('(0)+round((1-(if(lt(t,0.5),0,if(lt(t,1.5),(t-0.5)/1,1))))*100)');
  });

  // easing wraps the linear ramp p in a curve — pure expression math on the overlay x/y, no new
  // filter, so the LGPL on-device build keeps parity. ease-out = 1-(1-p)^3, ease-in-out = smoothstep.
  const EASE_OUT = `1-pow(1-(${RAMP}),3)`;
  const SMOOTHSTEP = `(${RAMP})*(${RAMP})*(3-2*(${RAMP}))`;

  it('ease-out wraps the rise/slide ramp in a cubic-out curve', () => {
    expect(overlayMotionExpr({ type: 'rise', easing: 'ease-out' }, '40:200')).toEqual({
      x: '40',
      y: `(200)+round((1-(${EASE_OUT}))*60)`,
    });
    expect(overlayMotionExpr({ type: 'slide-left', easing: 'ease-out' }, '40:200')).toEqual({
      x: `(40)+round((1-(${EASE_OUT}))*60)`,
      y: '200',
    });
  });

  it('ease-in-out wraps the ramp in a smoothstep curve', () => {
    expect(overlayMotionExpr({ type: 'slide-right', easing: 'ease-in-out' }, '40:200')).toEqual({
      x: `(40)-round((1-(${SMOOTHSTEP}))*60)`,
      y: '200',
    });
  });

  it('explicit linear easing emits the same ramp as the default', () => {
    expect(overlayMotionExpr({ type: 'rise', easing: 'linear' }, '40:200')).toEqual(
      overlayMotionExpr('rise', '40:200')
    );
  });

  it('fade ignores easing (it lowers to the fade filter, which is linear only)', () => {
    expect(overlayMotionExpr({ type: 'fade', easing: 'ease-out' }, '40:200')).toEqual({
      legFilter: 'fade=t=in:st=0.3:d=0.6:alpha=1',
    });
  });
});

// The animation-leg filter chain shared by the per-section overlay (MapManager.addAnimationOverlay)
// and the whole-video overlay pass (AnimationComposer) — scale the leg, then fade it when opacity < 1.
describe('buildAnimationLegFilters', () => {
  it('returns no filters when neither scale nor a fade is set', () => {
    expect(buildAnimationLegFilters({})).toEqual([]);
    expect(buildAnimationLegFilters({ opacity: 1 })).toEqual([]);
  });

  it('scales and squares the SAR when scale is set', () => {
    expect(buildAnimationLegFilters({ scale: '640:360' })).toEqual(['scale=640:360', 'setsar=1']);
  });

  it('fades via format+colorchannelmixer when opacity < 1', () => {
    expect(buildAnimationLegFilters({ opacity: 0.5 })).toEqual(['format=rgba', 'colorchannelmixer=aa=0.5']);
  });

  it('appends the fade after the scale on one chain when both are set', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', opacity: 0.4 })).toEqual([
      'scale=640:360',
      'setsar=1',
      'format=rgba',
      'colorchannelmixer=aa=0.4',
    ]);
  });

  it('rotates via the rotate filter when a nonzero rotation is set', () => {
    expect(buildAnimationLegFilters({ rotation: 30 })).toEqual([
      'format=rgba',
      'rotate=a=30*PI/180:ow=rotw(30*PI/180):oh=roth(30*PI/180):c=none',
    ]);
  });

  it('adds no rotate filter when rotation is omitted or zero', () => {
    expect(buildAnimationLegFilters({})).toEqual([]);
    expect(buildAnimationLegFilters({ rotation: 0 })).toEqual([]);
  });

  it('rotates after the scale and before the opacity fade on one chain', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', rotation: 45, opacity: 0.4 })).toEqual([
      'scale=640:360',
      'setsar=1',
      'format=rgba',
      'rotate=a=45*PI/180:ow=rotw(45*PI/180):oh=roth(45*PI/180):c=none',
      'colorchannelmixer=aa=0.4',
    ]);
  });

  // flip mirrors the overlay leg itself (before compositing) — hflip/vflip are the same core LGPL
  // filters the section motion flip emits, placed after the scale and before the rotate.
  it('mirrors horizontally via hflip', () => {
    expect(buildAnimationLegFilters({ flip: 'horizontal' })).toEqual(['hflip']);
  });

  it('mirrors vertically via vflip', () => {
    expect(buildAnimationLegFilters({ flip: 'vertical' })).toEqual(['vflip']);
  });

  it('mirrors both axes via hflip then vflip', () => {
    expect(buildAnimationLegFilters({ flip: 'both' })).toEqual(['hflip', 'vflip']);
  });

  it('flips after the scale and before the rotate on one chain', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', flip: 'horizontal', rotation: 30, opacity: 0.4 })).toEqual([
      'scale=640:360',
      'setsar=1',
      'hflip',
      'format=rgba',
      'rotate=a=30*PI/180:ow=rotw(30*PI/180):oh=roth(30*PI/180):c=none',
      'colorchannelmixer=aa=0.4',
    ]);
  });

  // fit maps the overlay into its "w:h" box without distortion: contain letterboxes inside it with
  // transparent padding, cover fills it and centre-crops the overflow. scale/pad/crop are core LGPL.
  it('contain letterboxes inside the box with transparent padding', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', fit: 'contain' })).toEqual([
      'scale=640:360:force_original_aspect_ratio=decrease',
      'format=rgba',
      'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0',
      'setsar=1',
    ]);
  });

  it('cover fills the box and centre-crops the overflow', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', fit: 'cover' })).toEqual([
      'scale=640:360:force_original_aspect_ratio=increase',
      'crop=640:360',
      'setsar=1',
    ]);
  });

  it('stretch (explicit or omitted) keeps the plain free scale', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', fit: 'stretch' })).toEqual(['scale=640:360', 'setsar=1']);
  });

  it('ignores fit without a scale box or with a keep-aspect (-1) component', () => {
    expect(buildAnimationLegFilters({ fit: 'contain' })).toEqual([]);
    expect(buildAnimationLegFilters({ scale: '640:-1', fit: 'cover' })).toEqual(['scale=640:-1', 'setsar=1']);
  });

  it('reuses the contain rgba frame for the opacity fade (no second format)', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', fit: 'contain', opacity: 0.4 })).toEqual([
      'scale=640:360:force_original_aspect_ratio=decrease',
      'format=rgba',
      'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0',
      'setsar=1',
      'colorchannelmixer=aa=0.4',
    ]);
  });

  it('rotates and fades after a cover fit on one chain', () => {
    expect(buildAnimationLegFilters({ scale: '640:360', fit: 'cover', rotation: 45, opacity: 0.4 })).toEqual([
      'scale=640:360:force_original_aspect_ratio=increase',
      'crop=640:360',
      'setsar=1',
      'format=rgba',
      'rotate=a=45*PI/180:ow=rotw(45*PI/180):oh=roth(45*PI/180):c=none',
      'colorchannelmixer=aa=0.4',
    ]);
  });
});

// A background layer's x/y/w/h are authored as pixels or `iw*<f>`/`ih*<f>` fraction expressions
// (the builder UI emits the latter). resolveLayerGeometry lowers them to concrete pixels against
// the project scale so the gradients source can be sized and the overlay positioned.
describe('resolveLayerGeometry', () => {
  it('defaults to a full-frame box at the origin', () => {
    expect(resolveLayerGeometry({}, '1280:720')).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('passes plain pixel numbers through, rounded to whole pixels', () => {
    expect(resolveLayerGeometry({ x: 100, y: 50.4, w: 640, h: 360 }, '1280:720')).toEqual({
      x: 100,
      y: 50,
      w: 640,
      h: 360,
    });
  });

  it('resolves iw/ih fraction expressions against the scale', () => {
    expect(resolveLayerGeometry({ x: 'iw*0.25', y: 'ih*0.25', w: 'iw*0.5', h: 'ih*0.5' }, '1280:720')).toEqual({
      x: 320,
      y: 180,
      w: 640,
      h: 360,
    });
  });

  it('resolves an ih-based width and an iw-based height by their own basis', () => {
    // A square box authored as ih on both axes: w follows the expression's basis, not the axis.
    expect(resolveLayerGeometry({ w: 'ih*0.5', h: 'ih*0.5' }, '1280:720')).toEqual({ x: 0, y: 0, w: 360, h: 360 });
  });

  it('falls back for unresolvable expressions (w/h to full frame, x/y to 0)', () => {
    expect(resolveLayerGeometry({ x: 't*10', y: 'main_h/2', w: 'foo', h: 'bar' }, '1280:720')).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    });
  });

  it('clamps w/h to at least 1 pixel', () => {
    expect(resolveLayerGeometry({ w: 0, h: 'ih*0.0001' }, '1280:720')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('falls back to 1280x720 when the scale is not plain positive pixels', () => {
    expect(resolveLayerGeometry({ w: 'iw*0.5' }, '1280:-1')).toEqual({ x: 0, y: 0, w: 640, h: 720 });
  });
});

// The gradients lavfi source must be sized to the LAYER's box (not the full frame) so a 50%-wide
// gradient layer actually renders half-frame; the sweep coords span the box, up to its last
// column/row (w-1, h-1: see "keeps every coordinate inside the box" below).
describe('buildGradientSource geometry', () => {
  const gradient = { from: '#000000', to: '#ffffff' };

  it('sizes the source to the full scale when the layer has no w/h', () => {
    const src = buildGradientSource({ gradient }, '1280:720', 4);
    expect(src).toContain('gradients=s=1280x720:c0=#000000:c1=#ffffff:d=4');
    expect(src).toContain('x0=0:y0=0:x1=0:y1=719');
  });

  it('sizes the source to the resolved w/h box and sweeps across it', () => {
    const src = buildGradientSource(
      { gradient: { ...gradient, direction: 'diagonal' }, w: 'iw*0.5', h: 'ih*0.5' },
      '1280:720',
      4
    );
    expect(src).toContain('gradients=s=640x360');
    expect(src).toContain('x0=0:y0=0:x1=639:y1=359');
  });

  it('sweeps a horizontal gradient across the layer width, not the frame', () => {
    const src = buildGradientSource(
      { gradient: { ...gradient, direction: 'horizontal' }, w: 320, h: 720 },
      '1280:720',
      2
    );
    expect(src).toContain('gradients=s=320x720');
    expect(src).toContain('x0=0:y0=0:x1=319:y1=0');
  });
});

// The gradients source's default speed (0.01) slowly rotates the gradient over the section — an
// unexposed side effect; the layer must render a STILL gradient, so a frozen speed is always
// explicit. It must be 0.00001, not 0: older FFmpeg builds (the ffmpeg.wasm core) enforce the
// option's 0.00001 minimum and abort on 0 ("Error setting option speed to value 0").
// `shape` lowers to the source's `type` option (linear|radial|circular|spiral); non-linear shapes
// radiate from a point, so their origin is centred in the layer box instead of using the linear
// direction sweep coords (which would pin a radial at the top-left corner).
describe('buildGradientSource shape', () => {
  const gradient = { from: '#000000', to: '#ffffff' };

  it('freezes the gradient with the minimum speed and emits no type token when shape is unset', () => {
    const src = buildGradientSource({ gradient }, '1280:720', 4);
    expect(src).toContain('speed=0.00001');
    expect(src).not.toContain('type=');
  });

  it('lowers shape=linear to type=linear and keeps the direction sweep coords', () => {
    const src = buildGradientSource(
      { gradient: { ...gradient, shape: 'linear', direction: 'horizontal' } },
      '1280:720',
      4
    );
    expect(src).toContain('type=linear');
    expect(src).toContain('x0=0:y0=0:x1=1279:y1=0');
  });

  it('centres a radial gradient in the layer box and reaches its far corner', () => {
    const src = buildGradientSource({ gradient: { ...gradient, shape: 'radial' } }, '1280:720', 4);
    expect(src).toContain('type=radial');
    expect(src).toContain('x0=640:y0=360:x1=1279:y1=719');
    expect(src).toContain('speed=0.00001');
  });

  it('centres circular and spiral shapes the same way', () => {
    const circular = buildGradientSource(
      { gradient: { ...gradient, shape: 'circular' }, w: 'iw*0.5', h: 'ih*0.5' },
      '1280:720',
      4
    );
    expect(circular).toContain('type=circular');
    expect(circular).toContain('x0=320:y0=180:x1=639:y1=359');

    const spiral = buildGradientSource({ gradient: { ...gradient, shape: 'spiral' } }, '1280:720', 4);
    expect(spiral).toContain('type=spiral');
    expect(spiral).toContain('x0=640:y0=360:x1=1279:y1=719');
  });
});

// A free `angle` (degrees, CSS convention: 0=bottom→top, 90=left→right, 180=top→bottom,
// 270=right→left) lowers to sweep endpoints computed against the layer box: a ray through the
// centre, cut at the box edges and kept inside [0, w-1]×[0, h-1], the range the gradients source accepts.
// It unlocks the reverse sweeps the direction enum lacks; the enum stays as sugar.
describe('buildGradientSource angle', () => {
  const gradient = { from: '#000000', to: '#ffffff' };

  it('lowers angle=0 to a bottom→top sweep up the centre column', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 0 } }, '1280:720', 4);
    expect(src).toContain('x0=640:y0=719:x1=640:y1=0');
  });

  it('lowers angle=90 to a left→right sweep along the centre row', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 90 } }, '1280:720', 4);
    expect(src).toContain('x0=0:y0=360:x1=1279:y1=360');
  });

  it('lowers angle=180 to a top→bottom sweep (the vertical default, recentred)', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 180 } }, '1280:720', 4);
    expect(src).toContain('x0=640:y0=0:x1=640:y1=719');
  });

  it('lowers angle=270 to the right→left sweep the direction enum lacks', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 270 } }, '1280:720', 4);
    expect(src).toContain('x0=1279:y0=360:x1=0:y1=360');
  });

  it('cuts a 45° sweep at the box corners of a square layer (bottom-left→top-right)', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 45 }, w: 400, h: 400 }, '1280:720', 4);
    expect(src).toContain('gradients=s=400x400');
    expect(src).toContain('x0=0:y0=399:x1=399:y1=0');
  });

  it('computes the sweep against the resolved layer box, not the frame', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 270 }, w: 'iw*0.5', h: 'ih*0.5' }, '1280:720', 4);
    expect(src).toContain('gradients=s=640x360');
    expect(src).toContain('x0=639:y0=180:x1=0:y1=180');
  });

  it('normalises angles outside 0..360 (450 ≡ 90, -90 ≡ 270)', () => {
    const wrapped = buildGradientSource({ gradient: { ...gradient, angle: 450 } }, '1280:720', 4);
    expect(wrapped).toContain('x0=0:y0=360:x1=1279:y1=360');

    const negative = buildGradientSource({ gradient: { ...gradient, angle: -90 } }, '1280:720', 4);
    expect(negative).toContain('x0=1279:y0=360:x1=0:y1=360');
  });

  it('wins over the direction enum when both are set', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 0, direction: 'horizontal' } }, '1280:720', 4);
    expect(src).toContain('x0=640:y0=719:x1=640:y1=0');
  });

  it('is ignored for non-linear shapes, which keep their centred origin', () => {
    const src = buildGradientSource({ gradient: { ...gradient, angle: 90, shape: 'radial' } }, '1280:720', 4);
    expect(src).toContain('x0=640:y0=360:x1=1279:y1=719');
  });
});

// FFmpeg's gradients source swaps any point outside [0, w-1]×[0, h-1] (x ≥ w and y ≥ h included) for
// a random one drawn from its seed, so an end point ON the far edge renders a different radius or
// sweep length on every run. Every coordinate the builder emits must sit inside the box, whatever the
// shape, direction, angle or box size.
describe('buildGradientSource keeps every coordinate inside the box', () => {
  const gradient = { from: '#000000', to: '#ffffff' };
  const boxes = [
    { label: 'the full frame', layer: {}, w: 1280, h: 720 },
    { label: 'a half-frame box', layer: { w: 'iw*0.5', h: 'ih*0.5' }, w: 640, h: 360 },
    { label: 'an odd 321x181 box', layer: { w: 321, h: 181 }, w: 321, h: 181 },
    { label: 'a 1px box', layer: { w: 1, h: 1 }, w: 1, h: 1 },
  ];
  const variants = [
    ...([undefined, 'horizontal', 'vertical', 'diagonal'] as const).map((direction) => ({ direction })),
    ...(['linear', 'radial', 'circular', 'spiral'] as const).map((shape) => ({ shape })),
    ...[0, 30, 45, 90, 135, 180, 225, 270, 315, -90, 450].map((angle) => ({ angle })),
  ];
  const cases = boxes.flatMap((box) => variants.map((variant) => ({ ...box, variant })));

  it.each(cases)('$label with $variant', ({ layer, w, h, variant }) => {
    const src = buildGradientSource({ gradient: { ...gradient, ...variant }, ...layer }, '1280:720', 4);
    const coords = Object.fromEntries(
      [...src.matchAll(/\b([xy][01])=(-?\d+)/g)].map(([, key, value]) => [key, Number(value)])
    );

    expect(Object.keys(coords).sort()).toEqual(['x0', 'x1', 'y0', 'y1']);

    for (const x of [coords.x0, coords.x1]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(w);
    }

    for (const y of [coords.y0, coords.y1]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(h);
    }
  });
});

// Detects a still image (.png/.jpg/.jpeg) among global.animations URLs, mirroring the animated-format
// gate SegmentBuilder.resolveAnimationSource already uses for the section path. `.webp` stays classified
// as ANIMATED (not still) to preserve today's whole-video behavior of stream-looping it — an animated
// .webp overlay must keep working exactly as before.
describe('isStillAnimationUrl', () => {
  it('is true for png/jpg/jpeg', () => {
    expect(isStillAnimationUrl('/a/b/logo.png')).toBe(true);
    expect(isStillAnimationUrl('/a/b/logo.jpg')).toBe(true);
    expect(isStillAnimationUrl('/a/b/logo.jpeg')).toBe(true);
    expect(isStillAnimationUrl('/a/b/LOGO.PNG')).toBe(true);
  });

  it('is false for the animated single-file formats, including .webp', () => {
    expect(isStillAnimationUrl('/a/b/glow.apng')).toBe(false);
    expect(isStillAnimationUrl('/a/b/glow.gif')).toBe(false);
    expect(isStillAnimationUrl('/a/b/glow.webm')).toBe(false);
    expect(isStillAnimationUrl('/a/b/glow.webp')).toBe(false);
  });

  it('is false for an unrelated/unknown extension', () => {
    expect(isStillAnimationUrl('/a/b/clip.mp4')).toBe(false);
  });
});

// isStillAnimation is AnimationComposer's single source of truth for the still/animated decision: it
// prefers an explicit `still` flag (set by watermarkToAnimation, since a watermark KNOWS it's a still)
// over sniffing, and falls back to isStillAnimationUrl against the STAGED path only for untyped entries.
describe('isStillAnimation', () => {
  it('trusts an explicit still: true even against an animated-looking (.webp) path', () => {
    expect(isStillAnimation({ still: true }, '/build/assets/logo.webp')).toBe(true);
  });

  it('trusts an explicit still: true even against an unresolved {{ var }} (non-extension) path', () => {
    expect(isStillAnimation({ still: true }, '{{ logoUrl }}')).toBe(true);
  });

  it('falls back to the path extension heuristic when still is unset (untyped global.animations entry)', () => {
    expect(isStillAnimation({}, '/build/assets/logo.png')).toBe(true);
    expect(isStillAnimation({}, '/build/assets/glow.webp')).toBe(false);
    expect(isStillAnimation({}, '/build/assets/glow.apng')).toBe(false);
  });
});

// The `-i` source fragment: loop/loops/duration map to `-stream_loop` and `-t` input options. An
// overlay can be bounded by a finite loop count (-stream_loop N-1) or a duration (-t seconds);
// `loop: true` is the legacy infinite case. webm keeps `-c:v libvpx-vp9` before the flags.
describe('buildSingleFileAnimationSource', () => {
  const src = (options: Record<string, unknown>, url = '/tmp/a.apng', opts?: { maxDuration?: number }) =>
    buildSingleFileAnimationSource({ url, options }, url, opts);

  it('plays once (no stream_loop) when neither loop, loops nor duration is set', () => {
    expect(src({})).toBe('-i /tmp/a.apng');
    expect(src({ loop: false })).toBe('-i /tmp/a.apng');
    expect(src({ loops: 1 })).toBe('-i /tmp/a.apng');
  });

  it('loops forever with -stream_loop -1 when loop is true', () => {
    expect(src({ loop: true })).toBe('-stream_loop -1 -i /tmp/a.apng');
  });

  it('repeats a finite number of times with -stream_loop (N-1)', () => {
    expect(src({ loops: 3 })).toBe('-stream_loop 2 -i /tmp/a.apng');
  });

  it('bounds by duration with -stream_loop -1 -t <seconds>', () => {
    expect(src({ duration: 8 })).toBe('-stream_loop -1 -t 8 -i /tmp/a.apng');
  });

  it('caps a finite loop count with -t when a maxDuration ceiling is given', () => {
    expect(src({ loops: 3 }, '/tmp/a.apng', { maxDuration: 10 })).toBe('-stream_loop 2 -t 10 -i /tmp/a.apng');
  });

  it('ignores the maxDuration ceiling for the duration mode (its own -t wins)', () => {
    expect(src({ duration: 8 }, '/tmp/a.apng', { maxDuration: 10 })).toBe('-stream_loop -1 -t 8 -i /tmp/a.apng');
  });

  it('does not apply the maxDuration ceiling to a forever loop (keeps it infinite)', () => {
    expect(src({ loop: true }, '/tmp/a.apng', { maxDuration: 10 })).toBe('-stream_loop -1 -i /tmp/a.apng');
  });

  it('puts -c:v libvpx-vp9 before the flags for a webm overlay', () => {
    expect(src({ duration: 8 }, '/tmp/a.webm')).toBe('-c:v libvpx-vp9 -stream_loop -1 -t 8 -i /tmp/a.webm');
  });

  it('delays the overlay with -itsoffset when start is set', () => {
    expect(src({ start: 3 })).toBe('-itsoffset 3 -i /tmp/a.apng');
    expect(src({ start: 3, duration: 8 })).toBe('-stream_loop -1 -itsoffset 3 -t 8 -i /tmp/a.apng');
    expect(src({ start: 3, loops: 3 })).toBe('-stream_loop 2 -itsoffset 3 -i /tmp/a.apng');
    expect(src({ start: 3, loop: true })).toBe('-stream_loop -1 -itsoffset 3 -i /tmp/a.apng');
  });

  it('omits -itsoffset for start 0 or undefined', () => {
    expect(src({ start: 0, duration: 8 })).toBe('-stream_loop -1 -t 8 -i /tmp/a.apng');
  });
});
