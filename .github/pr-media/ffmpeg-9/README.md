# FFmpeg 9: PR media

Evidence for the "render with ffmpeg 9 as well as 8" pull request, rendered by the LeClap CLI from this branch. FFmpeg 9.0.2 here is Homebrew's build: it has no `drawtext` (libfreetype) and no `zscale`, so the long-graph template is text-free and the HDR tone-map path could not be shown running (see [HDR](#hdr-tone-mapping)).

## Long filtergraphs

[`long-graph.json`](long-graph.json) is one 4 s photo section stacked with bokeh, dust, two confetti bursts, an orbit glint, corner brackets, a light leak and a breathing vignette. Its filtergraph is 114,217 bytes, past the engine's 64 KB inline limit, so it goes to FFmpeg through a file.

| File                                                             | Caption                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`long-graph-ffmpeg9-sheet.webp`](long-graph-ffmpeg9-sheet.webp) | The FFmpeg 9.0.2 render, every 10th frame (4×3). The 114 KB graph was passed as `-/filter_complex graph-0.txt`.                                                                                                  |
| [`long-graph-ffmpeg9.mp4`](long-graph-ffmpeg9.mp4)               | The FFmpeg 9.0.2 render itself (1280×720, 30 fps, 4 s, H.264, about 540 KB).                                                                                                                                     |
| [`filter-script-ffmpeg9.txt`](filter-script-ffmpeg9.txt)         | The forms the engine used before this PR, run against FFmpeg 9.0.2: `-filter_script:v` and `-filter_complex_script` fail with `Unrecognized option` (exit 8); `-/vf` and `-/filter_complex` read the same files. |
| [`long-graph-parity.txt`](long-graph-parity.txt)                 | The option file each release received (`-/filter_complex` on 9 and 8, `-filter_complex_script` on ffmpeg-static 6.0), frame counts, PSNR and decoded-frame MD5 of the 8 and 9 renders.                           |

## 8 vs 9 parity

| File                                       | Caption                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`parity-8-vs-9.webp`](parity-8-vs-9.webp) | `long-graph.json` at 1.5 s, rendered with FFmpeg 8.1.1 (left) and 9.0.2 (right). The decoded frames are identical: PSNR is `inf` on every frame. |

The two MP4 files differ as bitstreams (the x264 builds differ) but decode to the same pixels.

## Music pass

[`music-cuts.json`](music-cuts.json) is two cut-only 2 s photo sections under a music track: 120 frames planned.

| File                               | Caption                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`music-pass.txt`](music-pass.txt) | Frame counts of the FFmpeg 8.1.1 render, the FFmpeg 9.0.2 render with the pre-fix music fold, and the FFmpeg 9.0.2 render with #78, the mix isolated, and both releases with this fix. |

With #78's fix, this FFmpeg 9.0.2 build still lost the last frames: 117 of 120 (3.9 s), like the pre-fix fold, where FFmpeg 8.1.1 has 120. The isolation shows why. With `-c:v copy -shortest`, FFmpeg 9 cuts 3 frames even from a file it assembled itself, so reading the assembled file instead of the segment list does not help. This branch drops `-shortest` and bounds the mix with `-t <planned length>` on every version: 120 of 120 frames on both 9.0.2 and 8.1.1.

## HDR tone-mapping

| File                                       | Caption                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`filters-parser.txt`](filters-parser.txt) | The engine's `-filters` parser, pre-fix and fixed, on each release. FFmpeg 8 and 9 print a two-character flag column (` .S tonemap`), so the pre-fix pattern found no filter at all; the fixed one finds them all. |

No before/after still: neither FFmpeg 9.0.2 (Homebrew) nor 8.1.1 (mise) here is built with `zscale`, so both still take the SDR fallback (correctly, now that the parser sees that `zscale` is missing). A build with `zscale`, such as the official static ones, runs the tone map.

## Regenerate

From the repository root, after building the engine and the CLI:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
NODE=$(mise which node) FFMPEG9=/opt/homebrew/opt/ffmpeg/bin FFMPEG8=$(dirname "$(mise which ffmpeg)") \
  bash .github/pr-media/ffmpeg-9/make-media.sh
```

`FFMPEG9` and `FFMPEG8` are directories with `ffmpeg` and `ffprobe`; `$FFMPEG8/ffmpeg` also encodes the stills, so it needs `libwebp` and `drawtext`. Pass the real Node binary (`mise which node`): mise's shim puts its own `ffmpeg` back in front of `PATH`. [`make-media.sh`](make-media.sh) writes its scratch output to the git-ignored `build/pr/ffmpeg-9/` and runs these steps:

1. [`filter-script-repro.sh`](filter-script-repro.sh) against FFmpeg 9 → `filter-script-ffmpeg9.txt`.
2. `leclap render long-graph.json` with FFmpeg 9, 8 and ffmpeg-static 6.0, through a pass-through `ffmpeg` that records which option file each release received. Then the contact sheet, the MP4, the parity still and `long-graph-parity.txt` (`psnr` filter, `-f md5`).
3. `leclap render music-cuts.json` with FFmpeg 8 and 9, and the same template with FFmpeg 9 through a scratch copy of the built engine whose FFmpeg 9 branch is turned off (`shortestKeepsConcatVideo: true`, the pre-fix fold). Then the mix alone on files assembled by each release → `music-pass.txt`.
4. [`filters-parse.mjs`](filters-parse.mjs) on each release → `filters-parser.txt`.
