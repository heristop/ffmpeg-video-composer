# Typed fields: PR media

Media for the typed template fields pull request. One sample template, [`promo.json`](promo.json), declares five typed inputs in `global.fields` and fills them into its slots: a required `TITLE` (text, at most 24 characters), an `ACCENT` colour with a default, a `HOLD` number between 2 and 6 used as `"duration": "{{ HOLD }}"`, a `STYLE` enum used as a reveal type, and a `LINK` URL. Its form section asks for the first four; `LINK` is left to the builder's "Template inputs" scene. It was rendered twice by the branch's CLI with different `--set` values:

| Render | Values                                                                                |
| ------ | ------------------------------------------------------------------------------------- |
| A      | `--set "TITLE=Spring Launch" --set ACCENT=#b8adff --set HOLD=3 --set STYLE=rise`      |
| B      | `--set "TITLE=Night Market" --set ACCENT=#ff6f61 --set HOLD=5 --set STYLE=slide-left` |

## Video

| File                                     | Caption                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`typed-fields.mp4`](typed-fields.mp4)   | Render A (5.1 s) then render B (7.1 s), 1280×720, 30 fps, H.264 with faststart, no audio, about 280 KB. A strip at the bottom shows each render's `--set` values. |
| [`typed-fields.webp`](typed-fields.webp) | The same clip as an animated WebP for inline embedding (640 px, 15 fps, about 1.2 MB).                                                                            |

## Images

| File                                                 | Caption                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-same-moment.webp`](01-same-moment.webp)         | The same moment (1.5 s) of both renders: `TITLE` and `ACCENT` filled into the title card, the accent bar and the hold/entrance line.                                                                                                                                                                                                                                                                        |
| [`02-three-moments.webp`](02-three-moments.webp)     | Three moments of both renders: the entrance at 0.25 s (`STYLE` rise vs slide-left), the held card at 1.5 s, and 3.8 s, where `HOLD=3` has handed over to the outro while `HOLD=5` still holds the title.                                                                                                                                                                                                    |
| [`03-builder-form.webp`](03-builder-form.webp)       | `promo.json` imported through the template editor's "Import template JSON" and opened with "Save & film". The form is filled with render B's values: a text input with its character counter, a colour picker for `ACCENT`, a number field with its 2–6 range for `HOLD` and a select of the `STYLE` options, each with its type's icon. The scene strip shows the "Template inputs" scene before the form. |
| [`04-builder-invalid.webp`](04-builder-invalid.webp) | Inline problems. Left: the form with its required title emptied. Right: the "Template inputs" scene, which lists `LINK` because no form asks for it, refusing an `ftp://` link.                                                                                                                                                                                                                             |

The stills are WebP, at most 1280 px on each side and under 50 KB. The builder stills are captured at 1.25× device pixels; `03` is scaled down to 1280 px.

## CLI transcripts

- [`cli-resolve.txt`](cli-resolve.txt): `leclap resolve promo.json --set …` for render B. The resolved `global` has no `fields` left, `"duration": "{{ HOLD }}"` comes out as the number `5`, and the colour and enum placeholders are filled in their slots.
- [`cli-wrong-values.txt`](cli-wrong-values.txt): `leclap validate` without values (the `field_missing_required` advisory), then renders refused before encoding: `HOLD=abc`, `ACCENT=#ff6f6`, `ACCENT=notacolor` (named colours are checked against FFmpeg's list), `STYLE=bounce`, and `HOLD=9` without a title. The CLI banner and engine/assets lines are left out.

## Regenerate

From the repository root, with `ffmpeg` (drawtext, libx264, libwebp) and `python3` with Pillow on `PATH`:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash .github/pr-media/typed-fields/make-media.sh
```

[`make-media.sh`](make-media.sh) validates and renders both versions (scratch output in the git-ignored `build/pr/typed-fields/`), writes the stills with [`stills.py`](stills.py), encodes the MP4 and the animated WebP, and writes the two transcripts.

The builder stills come from [`record.mjs`](record.mjs), against your own dev server of the web app:

```bash
node scripts/copy-core-assets.ts
(cd apps/leclap-web && npx vite --port 5411 --strictPort) &
BASE=http://localhost:5411 node .github/pr-media/typed-fields/record.mjs
```

Set `CHROMIUM=/path/to/chrome` if `@playwright/test` has no browser of its own. `copy-core-assets.ts` also copies music into `apps/leclap-expo/assets/musics`; in a checkout without LFS, put the pointers back with `git checkout -- apps/leclap-expo/assets/musics`.

## Known issues

- Importing `promo.json` through the template editor renames its form scene from "Your promo" to "Section": the editor does not keep a form section's `title`.
- `HOLD` and `STYLE` cannot be made invalid in the builder (the number field clamps to 2–6, the select only offers the options), so `04` shows a URL refused instead.
