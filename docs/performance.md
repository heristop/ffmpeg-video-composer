# Performance & profiling

How to measure where a compile spends its time and turn that into ranked optimizations.

## TL;DR

- `FVC_PERF=1 pnpm compile <template.json>` — print a per-phase timing table and write `build/perf-<name>.json`.
- `pnpm --filter ffmpeg-video-composer bench` — median per-phase wall time across fixtures, with FFmpeg-share % and a delta vs. the previous run.
- Historical local-fixture measurements were FFmpeg-dominated (roughly **95–99%** in the serial baseline). Re-measure the current workload before choosing an optimization; see [`perf-findings.md`](./perf-findings.md).

## Phase timing (`FVC_PERF`)

For runtime controls, see the [engine configuration reference](./engine-configuration.md). Node/static FFmpeg segments default to a concurrency of three, capped by the section count; `ProjectConfig.hardwareConfig.maxRenderConcurrency` can narrow or widen that work. WASM and on-device adapters remain serial. `FVC_RENDER_CONCURRENCY` is a dev compile-script setting, not a published CLI flag.

MCP registered effects use a separate single-job queue with at most eight waiters. Queue wait, asset preflight and worker setup/render each have their own timeout; this is not one request-wide deadline. Preflight probes sequentially and deduplicates real paths within a request. The persistent effect cache saves rendering on a hit, but asset staging, bundling, browser identification and final FFmpeg assembly still run. Measure those stages separately from core compile spans when comparing cold and warm effect renders.

The pipeline is instrumented with a lightweight, gated timer (`packages/ffmpeg-video-composer/src/utils/perf-timer.ts`). Build the core before invoking the dev compile script: `pnpm --filter ffmpeg-video-composer build`. It is a **no-op unless `FVC_PERF` is set** to a truthy value other than `0`, so normal compiles and the test suite pay only a boolean check.

```bash
FVC_PERF=1 pnpm compile packages/ffmpeg-video-composer/tests/fixtures/fast-and-curious.json
```

Emits a table like this historical serial-run example (current timings depend on workload and concurrency):

```
total 666.9ms · ffmpeg share 97.6%
compile:total        666.0ms   1x   99.9%
ffmpeg:execute       603.3ms   4x   90.5%
director:render      493.1ms   1x   73.9%
director:finalize    172.3ms   1x   25.8%
final:assemble       171.7ms   1x   25.8%
segment:filters        0.9ms   3x    0.1%
...
```

and writes the same data as JSON to `build/perf-<descriptor-name>.json` (override the path with `FVC_PERF_OUT=<path>`).

### Span labels

| Label                                                  | Covers                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `compile:total`                                        | the whole `director.construct()`                             |
| `director:init`                                        | concat-file + music setup                                    |
| `director:calculateTotalLength`                        | duration probing (parallel)                                  |
| `director:render`                                      | serial segment builds plus serial/bounded-parallel rendering |
| `director:finalize`                                    | assembly + animations + music                                |
| `segment:{assets,maps,filters,inputs,fonts,luts}`      | per-segment build stages (summed across segments)            |
| `ffmpeg:execute` / `ffmpeg:getInfos`                   | each ffmpeg / ffprobe child process                          |
| `final:assemble`                                       | concat or xfade transition assembly                          |
| `final:animations` / `final:normalize` / `final:music` | whole-video overlay / audio normalization / mix              |

`ffmpeg share %` divides the summed `ffmpeg:*` spans by the report's `totalMs` (elapsed since the timer reset), not by the `compile:total` span. The timer keys open spans by label, so overlapping executions reuse `ffmpeg:execute` and do not produce a true process-time sum or union of wall time. Treat this percentage as a profiling hint; compare `director:render`, `director:finalize`, and total wall time for concurrent runs.

## Benchmark harness (`pnpm bench`)

```bash
pnpm --filter ffmpeg-video-composer bench                 # default curated fixtures
pnpm --filter ffmpeg-video-composer bench gradient transitions   # specific fixtures
BENCH_RUNS=6 pnpm --filter ffmpeg-video-composer bench    # 5 measured runs + 1 warmup
```

The harness (`packages/ffmpeg-video-composer/scripts/bench.ts`) runs each fixture through the **dev compile script importing built core output** `BENCH_RUNS` times (default 3). It discards run 0 when the count exceeds 1, so the default median uses 2 measured runs. It prints the **median** per phase, writes total/share summaries to `build/bench-<gitsha>.json`, and prints total-time deltas against the most recent different bench file. Re-running the same Git SHA overwrites its summary; preserve separate files for A/B comparisons.

Notes:

- It shells out to `dist/` (auto-building if missing) rather than importing `src` via `tsx`, because tsyringe constructor injection needs `emitDecoratorMetadata`, which esbuild/tsx does not emit but tsdown does.
- Rebuild the core after source changes: auto-build only checks whether `dist/index.js` exists, not whether it is current.
- Numbers are I/O/CPU-noisy (real ffmpeg processes). Read the median, note the machine, and treat per-phase deltas under the noise floor as non-actionable.
- Fixtures that fail to render are logged as skipped (no silent caps).

## CPU profiling the TS layer

Use this when measurements of the current workload show meaningful time in the TS layer. Built-in, no extra deps:

```bash
pnpm --filter ffmpeg-video-composer build
mkdir -p build/prof
FVC_PERF=1 node --cpu-prof --cpu-prof-dir=build/prof \
  packages/ffmpeg-video-composer/compile.ts \
  packages/ffmpeg-video-composer/tests/fixtures/drink-and-code.json
# open build/prof/*.cpuprofile in Chrome DevTools (Performance → Load profile) or VS Code
```

For flamegraphs, add `0x` as a devDependency **only if** the data justifies deeper digging — it is intentionally not committed by default.

## Parallel segment rendering

On Node (and ffmpeg-static), segments render concurrently by default — `hardwareConfig.maxRenderConcurrency`
(default 3, capped by segment count) controls the width; set it to `1` to force the serial path.
Build always runs serially (it mutates shared state); only the ffmpeg processes overlap. WASM and
on-device adapters drive a single engine and always render serially. For benching, the dev CLI honors
`FVC_RENDER_CONCURRENCY` (e.g. `FVC_RENDER_CONCURRENCY=1 pnpm --filter ffmpeg-video-composer bench fast-and-curious`). Historical A/B runs observed
~34–40% faster total compile / ~50% faster render on one 3-segment template; these are not current
performance guarantees. See [`perf-findings.md`](./perf-findings.md).

## Folded concat pass

When a template has no non-cut transitions, no whole-video animations or watermark, and a music mix or
audio-normalization pass will run, the standalone concat-copy pass is skipped:
the following audio pass (`appendMusic` or `normalizeAudio`) consumes the concat demuxer directly,
stream-copying video and touching only audio in one invocation. This is automatic on every platform
(Node, ffmpeg-static, React Native/on-device, and WASM — whose adapter bridges the concat segments +
music into MEMFS). It removes one full read/write of the assembled video; the saving is I/O-bound
(stream copy), so the historical short native fixture showed a modest saving. Larger output or WASM/on-device
I/O may offer more headroom, but those gains need separate measurements. Templates with non-cut transitions, whole-video overlays, or no following audio work keep the standard assemble path.
Set `FVC_DISABLE_CONCAT_FOLD=1` to force the two-pass path (bench/debug A/B). See [`perf-findings.md`](./perf-findings.md), concat-fold A/B #3 and implemented optimization #2.

## Fused transition + animation pass

When a template has non-cut transitions **and** whole-video overlay work (animations or a watermark), the xfade assembly and the
animation overlay are composed into a single `-filter_complex` (one re-encode instead of two) — the
overlay chains off the xfade output. Automatic; `overlayAnimations` skips so it isn't applied twice.
Removes one full re-encode of the timeline (historical `director:finalize` −12% on the test fixture). Templates
without both kinds of work use separate applicable passes. Set `FVC_DISABLE_FUSION=1` for the
two-pass path (bench/debug). See [`perf-findings.md`](./perf-findings.md), finalize-fusion A/B #4.

## Hardware encoder (opt-in)

Set `FVC_HWENCODE=1` (Node path) to auto-select a platform hardware H.264 encoder
(`h264_videotoolbox` on macOS, `h264_mediacodec` on Android) when the ffmpeg build exposes one;
or set `codecConfig.videoCodec` explicitly. It is **off by default** because the historical local benchmarks found
hardware encode slower than libx264 `ultrafast` on short multi-segment renders (per-segment
session-setup overhead) and only ~5% faster on a single heavy encode — see `docs/perf-findings.md`.
On-device builds already use hardware/LGPL encoders, so this only affects host/Node renders.

## Turning measurements into work

See [`perf-findings.md`](./perf-findings.md) for the historical measurements and implemented optimizations. The rule: optimize in descending order of measured wall-time share; weight serial→parallel restructuring by segment count (payoff scales with the number of segments). Kill any candidate whose measured cost is below the noise floor.
