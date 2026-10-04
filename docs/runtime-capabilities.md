# Runtime filter capabilities

> GENERATED — do not edit. Regenerate with `pnpm --filter ffmpeg-video-composer generate:capabilities`.
> Sources: `ENGINE_EMITTED_FILTERS` + `FILTER_COMPAT` (engine) and the `--enable-filter` list in `scripts/ffmpeg/common.sh` (device build).
> Guarded by `tests/capability-matrix.test.ts` (freshness) and `tests/lgpl-filter-audit.test.ts` (no uncovered emission).

| filter              | node (full build) | browser wasm (full build) | on-device (lgpl allowlist) |
| ------------------- | ----------------- | ------------------------- | -------------------------- |
| `acrossfade`        | yes               | yes                       | yes                        |
| `aecho`             | yes               | yes                       | yes                        |
| `aevalsrc`          | yes               | yes                       | yes                        |
| `afade`             | yes               | yes                       | yes                        |
| `afftdn`            | yes               | yes                       | yes                        |
| `aformat`           | yes               | yes                       | yes                        |
| `amix`              | yes               | yes                       | yes                        |
| `anullsrc`          | yes               | yes                       | yes                        |
| `asetpts`           | yes               | yes                       | yes                        |
| `asplit`            | yes               | yes                       | yes                        |
| `atempo`            | yes               | yes                       | yes                        |
| `atrim`             | yes               | yes                       | yes                        |
| `color`             | yes               | yes                       | yes                        |
| `colorbalance`      | yes               | yes                       | yes                        |
| `colorchannelmixer` | yes               | yes                       | yes                        |
| `colorkey`          | yes               | yes                       | yes                        |
| `crop`              | yes               | yes                       | yes                        |
| `curves`            | yes               | yes                       | yes                        |
| `drawbox`           | yes               | yes                       | yes                        |
| `drawtext`          | yes               | yes                       | yes                        |
| `dynaudnorm`        | yes               | yes                       | yes                        |
| `edgedetect`        | yes               | yes                       | yes                        |
| `eq`                | yes               | yes                       | via compat: eq-to-lutyuv   |
| `fade`              | yes               | yes                       | yes                        |
| `format`            | yes               | yes                       | yes                        |
| `fps`               | yes               | yes                       | yes                        |
| `gblur`             | yes               | yes                       | yes                        |
| `gradients`         | yes               | yes                       | yes                        |
| `hflip`             | yes               | yes                       | yes                        |
| `highpass`          | yes               | yes                       | yes                        |
| `hue`               | yes               | yes                       | yes                        |
| `loudnorm`          | yes               | yes                       | yes                        |
| `lowpass`           | yes               | yes                       | yes                        |
| `lut3d`             | yes               | yes                       | yes                        |
| `lutyuv`            | yes               | yes                       | yes                        |
| `noise`             | yes               | yes                       | yes                        |
| `null`              | yes               | yes                       | yes                        |
| `overlay`           | yes               | yes                       | yes                        |
| `pad`               | yes               | yes                       | yes                        |
| `rgbashift`         | yes               | yes                       | yes                        |
| `rotate`            | yes               | yes                       | yes                        |
| `scale`             | yes               | yes                       | yes                        |
| `setparams`         | yes               | yes                       | yes                        |
| `setpts`            | yes               | yes                       | yes                        |
| `setsar`            | yes               | yes                       | yes                        |
| `sidechaincompress` | yes               | yes                       | yes                        |
| `split`             | yes               | yes                       | yes                        |
| `vflip`             | yes               | yes                       | yes                        |
| `volume`            | yes               | yes                       | yes                        |
| `xfade`             | yes               | yes                       | yes                        |
| `zoompan`           | yes               | yes                       | yes                        |

Device allowlist size: 62 filters. The on-device engine binary must be rebuilt (`scripts/ffmpeg/build-engine.sh`) whenever the allowlist changes; until then, older installed engines lack newly added filters and affected renders can fail. Expo compilation stays local; there is no server fallback.
