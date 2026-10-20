import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import AnimationComposer from '@/editor/AnimationComposer';
import { GlobalAnimationSchema } from '@/schemas/global.schemas';
import type { GlobalAnimation, Watermark } from '@/core/types';

function setup(
  animations: GlobalAnimation[],
  opts: {
    hasAudio?: boolean;
    watermark?: Watermark;
    scale?: string;
    mapVariables?: (value: string) => string;
  } = {}
) {
  const executed: string[] = [];
  const moves: Array<[string, string]> = [];
  const unlinked: string[] = [];

  const ffmpegAdapter = {
    execute: vi.fn(async (cmd: string) => {
      executed.push(cmd);

      return { rc: 0 };
    }),
    getInfos: vi.fn(async () => ({
      duration: 10,
      videoCodec: 'h264',
      audioCodec: opts.hasAudio === false ? null : 'aac',
      sampleRate: 48000,
    })),
  };

  const filesystemAdapter = {
    getBuildPath: vi.fn(async (dir: string) => `/build/${dir}`),
    getTempDir: vi.fn(() => '/tmp'),
    resolveLocalAsset: vi.fn(async (url: string) => `/build/assets/${url.split('/').at(-1)}`),
    fetch: vi.fn(async (url: string) => `/tmp/dl_${url.split('/').at(-1)}`),
    move: vi.fn(async (src: string, dst: string) => {
      moves.push([src, dst]);
    }),
    unlink: vi.fn(async (path: string) => {
      unlinked.push(path);
    }),
  };

  const project = {
    config: { videoConfig: opts.scale ? { scale: opts.scale } : undefined },
    finalVideo: '/build/output.mp4',
  };
  const template = { descriptor: { global: { animations, watermark: opts.watermark } } };
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const variableManager = { mapVariables: opts.mapVariables ?? ((value: string) => value) };

  const composer = new AnimationComposer({
    project,
    template,
    logger,
    ffmpegAdapter,
    filesystemAdapter,
    variableManager,
  } as never);

  return { composer, ffmpegAdapter, filesystemAdapter, executed, moves, unlinked };
}

const GLOW = '/assets/animations/glow_border.apng';

describe('AnimationComposer.buildOverlayGraph (fusion params)', () => {
  it('uses a custom base label, input offset and chain prefix without colliding with xfade labels', () => {
    const { composer } = setup([]);
    const staged = [
      { path: '/a.apng', anim: { url: 'a', duration: 6 } },
      { path: '/b.apng', anim: { url: 'b', duration: 6, position: '10:20' } },
    ];

    const graph = composer.buildOverlayGraph(staged as never, {
      baseLabel: '[vfx]',
      firstInputIndex: 4,
      chainPrefix: 'ov',
      outLabel: '[vout]',
    });

    // base is the xfade output; animation inputs start at index 4; chain uses `ov` not `v`.
    expect(graph).toContain('[vfx][4:v]overlay=0:0:eof_action=pass[ov0]');
    expect(graph).toContain('[ov0][5:v]overlay=10:20:eof_action=pass[vout]');
    // must NOT reuse the xfade chain label `[v0]` or hijack `[vout]` mid-chain
    expect(graph).not.toContain('[v0]');
  });

  it('defaults reproduce the standalone graph ([0:v] base, input 1, `v` chain)', () => {
    const { composer } = setup([]);
    const staged = [{ path: '/a.apng', anim: { url: 'a', loop: true } }];

    expect(composer.buildOverlayGraph(staged as never, {})).toBe(
      '[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1[vout]'
    );
  });
});

describe('GlobalAnimationSchema motion', () => {
  it('accepts the motion field the editor emits (bare type and full object)', () => {
    expect(GlobalAnimationSchema.safeParse({ url: GLOW, loop: true, motion: 'fade' }).success).toBe(true);
    expect(
      GlobalAnimationSchema.safeParse({
        url: GLOW,
        loop: true,
        motion: { type: 'rise', delay: 0.2, duration: 0.8, distance: 40, easing: 'ease-out' },
      }).success
    ).toBe(true);
  });

  it('still rejects unknown keys (strict schema)', () => {
    expect(GlobalAnimationSchema.safeParse({ url: GLOW, wobble: true }).success).toBe(false);
  });
});

describe('AnimationComposer.appendAnimations', () => {
  it('no-ops when there are no global animations', async () => {
    const { composer, ffmpegAdapter, moves } = setup([]);

    await composer.appendAnimations('/build/output.mp4');

    expect(ffmpegAdapter.execute).not.toHaveBeenCalled();
    expect(moves).toHaveLength(0);
  });

  it('overlays a single looping animation over the joined video and copies its audio', async () => {
    const { composer, executed, moves, unlinked } = setup([{ url: GLOW, loop: true }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    // the joined video is moved aside to a temp, fed as input 0, and the temp is cleaned up after
    expect(moves[0][0]).toBe('/build/output.mp4');
    const temp = moves[0][1];
    expect(temp).toContain('/tmp/tmp_anim_');
    expect(cmd).toContain(`-i ${temp}`);
    expect(unlinked).toContain(temp);
    // the looped animation source (apng → no codec, -stream_loop -1) staged from the local asset
    expect(cmd).toContain('-stream_loop -1 -i /build/assets/glow_border.apng');
    // one overlay over the base video, bounded to the video via shortest, eof pass (not persistent)
    expect(cmd).toContain('[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1[vout]');
    expect(cmd).toContain('-map "[vout]"');
    expect(cmd).toContain('-map 0:a -c:a copy');
    expect(cmd).toContain('-movflags +faststart');
    expect(cmd).toContain('/build/output.mp4');
  });

  it('applies scale + opacity on the leg and freezes when persistent', async () => {
    const { composer, executed } = setup([
      { url: GLOW, loop: true, persistent: true, scale: '1280:600', opacity: 0.3 },
    ]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('[1:v]scale=1280:600,setsar=1,format=rgba,colorchannelmixer=aa=0.3[anim0]');
    expect(cmd).toContain('[0:v][anim0]overlay=0:0:eof_action=repeat:shortest=1[vout]');
  });

  it('chains multiple animations, last producing [vout]', async () => {
    const { composer, executed } = setup([
      { url: GLOW, loop: true },
      { url: '/assets/animations/light_leak.apng', loop: true, position: '10:20' },
    ]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1[v0]');
    expect(cmd).toContain('[v0][2:v]overlay=10:20:eof_action=pass:shortest=1[vout]');
  });

  it('omits the audio map when the joined video has no audio stream', async () => {
    const { composer, executed } = setup([{ url: GLOW, loop: true }], { hasAudio: false });

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).not.toContain('-map 0:a');
  });

  it('bounds a duration overlay with -t and drops shortest (the overlay ends, the video shows through)', async () => {
    const { composer, executed } = setup([{ url: GLOW, duration: 8 }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-stream_loop -1 -t 8 -i /build/assets/glow_border.apng');
    expect(cmd).toContain('[0:v][1:v]overlay=0:0:eof_action=pass[vout]');
    expect(cmd).not.toContain('shortest=1');
  });

  it('lowers a fade motion to an alpha fade-in on the overlay leg (format+fade, both LGPL)', async () => {
    const { composer, executed } = setup([{ url: GLOW, loop: true, motion: 'fade' }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    // the fade rides the overlay LEG (before compositing) so only the overlay fades in, not the video
    expect(cmd).toContain('[1:v]format=rgba,fade=t=in:st=0.3:d=0.6:alpha=1[anim0]');
    expect(cmd).toContain('[0:v][anim0]overlay=0:0:eof_action=pass:shortest=1[vout]');
  });

  it('appends the fade after the existing leg filters, reusing their rgba frame', async () => {
    const { composer, executed } = setup([{ url: GLOW, loop: true, scale: '1280:600', opacity: 0.3, motion: 'fade' }]);

    await composer.appendAnimations('/build/output.mp4');

    // the opacity path already converted to rgba once; the fade must not re-format
    expect(executed[0]).toContain(
      '[1:v]scale=1280:600,setsar=1,format=rgba,colorchannelmixer=aa=0.3,fade=t=in:st=0.3:d=0.6:alpha=1[anim0]'
    );
  });

  it('lowers a rise motion to overlay x/y time expressions easing back to the static position', async () => {
    const { composer, executed } = setup([
      { url: GLOW, loop: true, position: '10:20', motion: { type: 'rise', delay: 0, duration: 1, distance: 40 } },
    ]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain(
      "[0:v][1:v]overlay=x='10':y='(20)+round((1-(if(lt(t,0),0,if(lt(t,1),(t-0)/1,1))))*40)':eof_action=pass:shortest=1[vout]"
    );
  });

  it('keeps the static positional overlay form for motion none', async () => {
    const { composer, executed } = setup([{ url: GLOW, loop: true, position: '10:20', motion: 'none' }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain('[0:v][1:v]overlay=10:20:eof_action=pass:shortest=1[vout]');
  });

  it('caps a finite loop count with the base-video duration ceiling and drops shortest', async () => {
    // the getInfos stub reports a 10s joined video, so finite loops get -t 10 as a safety ceiling
    const { composer, executed } = setup([{ url: GLOW, loops: 3 }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-stream_loop 2 -t 10 -i /build/assets/glow_border.apng');
    expect(cmd).toContain('[0:v][1:v]overlay=0:0:eof_action=pass[vout]');
    expect(cmd).not.toContain('shortest=1');
  });
});

// A still image (.png/.jpg/.jpeg) in global.animations must decode as a LIVE stream (`-loop 1`), not a
// single frame — the bug this task fixes. `.webp` stays on the animated (`-stream_loop`) path to
// preserve today's behavior, since it can itself be an animation.
describe('AnimationComposer still-image whole-video overlays', () => {
  const LOGO_PNG = '/assets/images/logo.png';
  const LOGO_JPG = '/assets/images/logo.jpg';

  it('loops a .png overlay with -loop 1 instead of stream-looping it', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png');
    expect(cmd).not.toContain('-stream_loop');
  });

  it('loops a .jpg overlay with -loop 1 too', async () => {
    const { composer, executed } = setup([{ url: LOGO_JPG }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain('-loop 1 -i /build/assets/logo.jpg');
  });

  it('keeps .apng/.gif/.webm/.webp on the stream-looped animation path (regression)', async () => {
    const { composer, executed } = setup([
      { url: '/assets/animations/a.apng', loop: true },
      { url: '/assets/animations/b.gif', loop: true },
      { url: '/assets/animations/c.webm', loop: true },
      { url: '/assets/animations/d.webp', loop: true },
    ]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-stream_loop -1 -i /build/assets/a.apng');
    expect(cmd).toContain('-stream_loop -1 -i /build/assets/b.gif');
    expect(cmd).toContain('-c:v libvpx-vp9 -stream_loop -1 -i /build/assets/c.webm');
    expect(cmd).toContain('-stream_loop -1 -i /build/assets/d.webp');
    expect(cmd).not.toContain('-loop 1');
  });

  it('bounds the -loop 1 (infinite) source to the base video via shortest=1, eof pass by default', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain('[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1[vout]');
  });

  it('freezes the still on its last frame when persistent (still gets shortest=1 either way)', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG, persistent: true }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain('[0:v][1:v]overlay=0:0:eof_action=repeat:shortest=1[vout]');
  });

  it('lowers start+duration to an overlay enable gate instead of trimming the (always-looped) source', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG, start: 2, duration: 4 }]);

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    // the source stays a bare infinite loop — start/duration never reach the input flags
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png');
    expect(cmd).not.toContain('-itsoffset');
    expect(cmd).not.toContain('-t 4');
    // the timing is expressed as a video-global `enable` gate on the overlay filter instead
    expect(cmd).toContain("[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1:enable='between(t,2,6)'[vout]");
  });

  it('gates a duration-only still from t=0', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG, duration: 4 }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain("[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1:enable='between(t,0,4)'[vout]");
  });

  it('gates a start-only still with gte (visible until the video ends)', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG, start: 3 }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain("[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1:enable='gte(t,3)'[vout]");
  });

  it('applies scale/opacity leg filters on a still exactly like an animation leg', async () => {
    const { composer, executed } = setup([{ url: LOGO_PNG, scale: '200:-1', opacity: 0.5 }]);

    await composer.appendAnimations('/build/output.mp4');

    expect(executed[0]).toContain('[1:v]scale=200:-1,setsar=1,format=rgba,colorchannelmixer=aa=0.5[anim0]');
  });

  // Fix 1+2: an untyped `global.animations` entry has no `still` flag, so isStillAnimation falls back
  // to sniffing — but against the STAGED path (post `{{ var }}` resolution), not the raw url. Before
  // this fix, `isStillAnimationUrl(anim.url)` always missed a `{{ var }}` url (never matches the still
  // regex), so a variable-authored still .png animation used to wrongly take the animated path.
  it('resolves a {{ var }} plain animation url against the STAGED path, taking the still path for .png', async () => {
    const { composer, executed } = setup([{ url: '{{ logoUrl }}' }], {
      mapVariables: (value) => value.replace('{{ logoUrl }}', '/assets/images/logo.png'),
    });

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png');
    expect(cmd).not.toContain('-stream_loop');
    expect(cmd).toContain('[0:v][1:v]overlay=0:0:eof_action=pass:shortest=1[vout]');
  });
});

// global.watermark wiring: AnimationComposer is the single place that reads global.animations for
// compositing, so prepending the lowered watermark there (rather than in every downstream stage)
// makes it flow through staging/legs/overlay exactly like an authored animations[] entry — including
// the corner position expression reaching `overlay=` UNESCAPED, proven here against the real command
// string (not just the pure watermarkToAnimation unit, which never touches AnimationComposer at all).
describe('AnimationComposer global.watermark wiring', () => {
  const WATERMARK: Watermark = { url: 'pictures/logo.png' };

  it('is a no-op when neither animations nor a watermark are set', async () => {
    const { composer, ffmpegAdapter } = setup([]);

    await composer.appendAnimations('/build/output.mp4');

    expect(ffmpegAdapter.execute).not.toHaveBeenCalled();
  });

  it('prepends the watermark as a still overlay (loop 1) with the default bottom-right position', async () => {
    const { composer, executed } = setup([], { watermark: WATERMARK });

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png');
    // default scale 0.12 * the fallback 1280 output width -> 154; default margin 24 -> bottom-right,
    // reaching overlay= as plain unescaped ffmpeg arithmetic (no quoting around it).
    expect(cmd).toContain('[1:v]scale=154:-1,setsar=1,format=rgba,colorchannelmixer=aa=0.8[anim0]');
    expect(cmd).toContain('[0:v][anim0]overlay=W-w-24:H-h-24:eof_action=pass:shortest=1[vout]');
  });

  it('resolves the watermark scale against the actual project output scale, not the fallback default', async () => {
    const { composer, executed } = setup([], { watermark: WATERMARK, scale: '720:1280' });

    await composer.appendAnimations('/build/output.mp4');

    // 720 * 0.12 = 86.4 -> 86
    expect(executed[0]).toContain('[1:v]scale=86:-1,setsar=1,format=rgba,colorchannelmixer=aa=0.8[anim0]');
  });

  it('prepends the watermark BEFORE an explicit animations entry, which then composites on top of it', async () => {
    const { composer, executed } = setup([{ url: GLOW, loop: true, position: '10:20' }], { watermark: WATERMARK });

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    // watermark staged first -> input 1 (its still source), explicit animation staged second -> input 2
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png -stream_loop -1 -i /build/assets/glow_border.apng');
    // watermark overlays the base video first ([0:v] -> [v0]), the explicit animation overlays on top of THAT
    expect(cmd).toContain('[0:v][anim0]overlay=W-w-24:H-h-24:eof_action=pass:shortest=1[v0]');
    expect(cmd).toContain('[v0][2:v]overlay=10:20:eof_action=pass:shortest=1[vout]');
  });

  // Fix 1+2: watermarkToAnimation sets `still: true` explicitly, so AnimationComposer trusts the flag
  // instead of sniffing `anim.url` — before this fix, a `{{ var }}` watermark url NEVER matched the
  // still regex (isStillAnimationUrl), so it silently took the animated (stream-looped, non-`-loop 1`)
  // path and rendered as a single vanishing frame.
  it('emits -loop 1 for a {{ var }}-url watermark (the flag, not the unresolved url, decides)', async () => {
    const { composer, executed } = setup([], {
      watermark: { url: '{{ logoUrl }}' },
      mapVariables: (value) => value.replace('{{ logoUrl }}', '/assets/images/logo.png'),
    });

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.png');
    expect(cmd).not.toContain('-stream_loop');
    expect(cmd).toContain('[0:v][anim0]overlay=W-w-24:H-h-24:eof_action=pass:shortest=1[vout]');
  });

  // Fix 1+2: `.webp` is deliberately excluded from the still-image regex for untyped `global.animations`
  // entries (it can itself be animated) — but a watermark is NEVER animated, so the `still` flag must
  // win over that extension exclusion for a .webp logo too.
  it('emits -loop 1 for a .webp watermark (the still flag wins over the .webp extension exclusion)', async () => {
    const { composer, executed } = setup([], { watermark: { url: 'pictures/logo.webp' } });

    await composer.appendAnimations('/build/output.mp4');

    const cmd = executed[0];
    expect(cmd).toContain('-loop 1 -i /build/assets/logo.webp');
    expect(cmd).not.toContain('-stream_loop');
    expect(cmd).toContain('[0:v][anim0]overlay=W-w-24:H-h-24:eof_action=pass:shortest=1[vout]');
  });
});
