<div align="center">

<img src="apps/leclap-web/public/pwa-512x512.png" alt="LeClap" width="88" height="88" />

# LeClap — Design

The LeClap visual language: a bold, juicy, lavender-to-pink identity on near-black surfaces. The web app (Tailwind `@theme`) and the Expo app (Tamagui) mirror each other so the product feels like one brand everywhere.

</div>

> **Source of truth.** Web tokens: [`apps/leclap-web/src/index.css`](apps/leclap-web/src/index.css) (`@theme`); Expo tokens: [`apps/leclap-expo/tamagui.config.ts`](apps/leclap-expo/tamagui.config.ts) + [`apps/leclap-expo/src/styles/theme.ts`](apps/leclap-expo/src/styles/theme.ts). Bundled video fonts: [`packages/leclap-creative-kit/src/fonts.ts`](packages/leclap-creative-kit/src/fonts.ts). All colors are authored in **OKLCH**; the hex values below are the design reference.

## Logo

The clapperboard mark — a rounded square with a lavender→pink gradient and a play glyph. Files: `apps/leclap-web/public/pwa-512x512.png` and `favicon.svg`. Don't recolor it; it carries the brand gradient.

## Colors

![Lavender #7C83FD](https://img.shields.io/badge/Lavender-%237C83FD-7C83FD?style=flat-square&labelColor=7C83FD)&nbsp;![Pink #FF8AAE](https://img.shields.io/badge/Pink-%23FF8AAE-FF8AAE?style=flat-square&labelColor=FF8AAE)&nbsp;![Accent #FFF685](https://img.shields.io/badge/Accent-%23FFF685-FFF685?style=flat-square&labelColor=FFF685)&nbsp;![Ink #141416](https://img.shields.io/badge/Ink-%23141416-141416?style=flat-square&labelColor=141416)

| Role          | Hex (ref) | Token                   | Notes                                                  |
| ------------- | --------- | ----------------------- | ------------------------------------------------------ |
| **Primary**   | `#7C83FD` | `--color-brand-500`     | Lavande — actions, focus, links, the gradient's start. |
| **Secondary** | `#FF8AAE` | `--color-secondary-500` | Rose — accents, the gradient's end.                    |
| **Accent**    | `#FFF685` | `--color-accent-500`    | Pastel yellow — sparing highlights.                    |
| **Ink**       | `#141416` | surfaces (dark)         | Near-black surface; the brand's default canvas.        |

Each hue ships a full **50–900 scale** (`--color-brand-*`, `--color-secondary-*`, `--color-accent-*`). Semantic tokens: `--color-success`, `--color-error`, `--color-warning`.

### Theme switching

Surfaces and text are **semantic tokens** that default to **light** in `@theme` and swap under a `.dark` class on `<html>` (class-based dark mode). The **brand / secondary / accent** scales stay constant across themes — only the canvas changes.

| Token                | Light      | Dark           |
| -------------------- | ---------- | -------------- |
| `--color-background` | near-white | near-black ink |
| `--color-surface`    | off-white  | raised ink     |
| `--color-foreground` | ink        | off-white      |
| `--color-divider`    | light gray | dark gray      |

## Typography

- **UI / display:** **Oswald** (`--font-sans`, `--font-display`) — a condensed face for the bold, headline-forward feel.
- **Video text (bundled in `@leclap/creative-kit/fonts`):** the on-device-safe set used by templates and overlays — **Bebas Neue, Oswald, Anton, Archivo Black, Bungee, Righteous, Abril Fatface, Playfair Display, Lobster, Pacifico, Rubik, Roboto Mono**. These are the only fonts guaranteed to render identically on Node, WASM, and on-device.

## Gradient, motion & elevation

- **Brand gradient:** `linear-gradient(135deg, brand-500 → secondary-400)` (`brand-gradient` utility, the logo and primary CTAs); `--grad-text` for gradient headings.
- **Motion:** three shared easing curves for a cohesive "juicy" feel — `--ease-smooth`, `--ease-spring`, `--ease-out-expo`. Prefer these over ad-hoc transitions.
- **Elevation:** brand-tinted shadows — `--shadow-md`, `--shadow-lg`, and `--shadow-glow` (a lavender glow). Surfaces use restrained glassmorphism over the ink canvas.
- **Radii:** `sm 6px · md 8px · lg 12px · xl 16px · 2xl 20px`.

## Video player

Every video in the web app plays in one player family ([`apps/leclap-web/src/presentation/components/player/`](apps/leclap-web/src/presentation/components/player/)): the studio result, test renders, camera takes, the landing films and reel, and the showcase. It speaks the app's language rather than a stock player's:

- **Film-strip timeline:** the played part in the brand gradient over a lavender-tinted track (buffered a paler tint), a hairline notch where each template scene starts, sprocket perforations underneath, and the app's playhead thumb (off-white ringed in rose). Hover or scrub floats a frame from that moment, framed like a monitor, with a mono pill reading the scene and the time.
- **Controls:** glass capsules like the header's pills; play/pause morph; the speed is a lavender chip whose figure rolls as it changes (0.5×–2×, kept for the session, pitch preserved); time in the slates' mono; captions; picture-in-picture (standard API, Safari's presentation mode as the fallback, hidden in Firefox); fullscreen. All 44 px.
- **Cover and moments:** the poster wears a title card (LeClap chip, frame shape, length, the title in Oswald) inside the program monitor's corner brackets; the centre button is the brand-gradient call to action with its glow; a clapperboard claps as playback starts; Clappy runs the loader and calls "cut" on an error; fullscreen turns cinematic (large title, display-face timecode).
- **Tokens:** `--color-player-ink` / `--color-player-fg` (theme-constant, over footage, always on a scrim) plus the brand scales; menus use the app's dark popover surface. Motion is 150–300 ms on transform and opacity, still under reduced motion.
- **Behaviour:** controls fade over a playing video after 2.5 s without pointer movement and return on move, tap or keyboard focus; space/k, ←/→, j/l, ↑/↓, 0–9, m, f, c, p (picture-in-picture), `<`/`>`. Mini frames shed the time, speed, frame preview, perforations, title and Clappy, never play, sound, seek or fullscreen.

---

Part of the [LeClap monorepo](README.md). Recording/UI overlays (framing guide) and in-video captions are documented in the [template configuration reference](docs/template-configuration.md).
