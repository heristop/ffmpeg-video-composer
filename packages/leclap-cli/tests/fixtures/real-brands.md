# Brand kits read from real sites

The record of `leclap brand <url>` run against live sites, one row per site, judged against the site itself.
Each fix ships with a small synthetic fixture reproducing the site's pattern in
`packages/ffmpeg-video-composer/tests/brand-{css,html,theme}.test.ts`; no copy of any site is stored.

- **Date:** 2026-10-16 (first run, then again after the review fixes; the table is the second run)
- **Command:** `node packages/leclap-cli/dist/index.js brand <url> -o <dir>` (HTTPS, public hosts, 2 MB and 10 s
  per response, the first 3 stylesheets after ranking)
- **Verdicts:** good (name, brand colour, readable fg/bg, the site's own fonts and its mark), partial (one of these
  is off: the row says which), blocked (the site refused, or the page could not be read under the caps)
- **Fonts:** unknown display families map to `bebas`, the condensed face of the base `leclap` theme the bundled
  templates are sized for; `archivo-black` only when the family's name says black, heavy, extended or wide.

## Results

| Site           | Name read  | Brand colour read → expected                                        | Fonts read (display / body / mono) → bundled                                  | Logo source                                 | Verdict | Fixes behind the row / what is off                                                  |
| -------------- | ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| leclap.dev     | LeClap     | `#7c83fd` lavender (accent `#f44336`) → lavender                    | Oswald / Oswald / — → oswald / oswald / mono                                  | apple-touch-icon (180, the clapper mark)    | good    | 7103d8fa (fonts were null)                                                          |
| stripe.com     | Stripe     | `#533afd` → blurple                                                 | sohne-var / sohne-var / SourceCodePro → bebas / rubik / mono                  | apple-touch-icon (180, the S mark)          | good    | 7103d8fa (fonts were null), e7f669bf                                                |
| linear.app     | Linear     | `#7070ff` on white → indigo on near-black                           | Tiempos Headline / Inter Variable / Berkeley Mono → bebas / rubik / mono      | apple-touch-icon (180, the mark)            | partial | b922ed1d (no CSS read), 7103d8fa; light canvas: its `#08090a` theme-color is 18.5 % |
| vercel.com     | Vercel     | `#7928ca` purple → black and white                                  | GeistSans / GeistSans / Geist Mono → bebas / rubik / mono                     | apple-touch-icon (256, the triangle)        | partial | 0aed0573, 3eca96a4, 7103d8fa; a monochrome brand still gets an accent               |
| notion.so      | Notion     | `#1313ba` deep blue → black and white                               | — / NotionInter / iA Writer Mono → bebas / rubik / mono                       | apple-touch-icon (512, the N cube)          | partial | 7103d8fa; a monochrome brand still gets an accent                                   |
| airbnb.com     | Airbnb     | `#ff385c` on white → Rausch on white                                | Airbnb Cereal VF / Airbnb Cereal VF / — → bebas / rubik / mono                | icon (240, the Bélo on Rausch)              | good    | 5be9944a (canvas was black), 3eca96a4 (76 px icon)                                  |
| spotify.com    | Spotify    | `#00ac44` (`#1ed760` darkened for 3:1 on white) → Spotify green     | SpotifyMixUITitle / SpotifyMixUI / SpotifyMixMono → bebas / rubik / mono      | icon (32 px: the page lists nothing larger) | partial | 7103d8fa (fonts were null); light canvas for a dark player, small logo              |
| figma.com      | Figma      | `#a1322e` dark red → the multicolour mark                           | — / figmaSans / figmaMono → bebas / rubik / mono                              | icon (256, the mark)                        | partial | 3eca96a4 (76 px icon), 7103d8fa; colours live in CSS-in-JS, 6 in sheets             |
| mozilla.org    | Mozilla    | `#0060df` blue, accent `#00ad13` green → black, Mozilla green, blue | Mozilla Headline / Mozilla Text / — → bebas / rubik / mono                    | icon (196, the green m)                     | good    | 3eca96a4 (180 → 196 px)                                                             |
| github.com     | GitHub     | `#0969da` on white → blue                                           | — / — / — (system stack; Mona Sans is in later sheets) → bebas / rubik / mono | icon (32 px png; an svg also listed)        | partial | 2aecfbf3 (brand was derived black), d3cdc818; fonts, logo size                      |
| netflix.com    | —          | —                                                                   | —                                                                             | —                                           | blocked | page over the 2 MB response cap (not a bot block)                                   |
| cloudflare.com | Cloudflare | `#ff4801` → Cloudflare orange                                       | FT Kunst Grotesk / FT Kunst Grotesk / Apercu Mono Pro → bebas / rubik / mono  | og:image (a banner: the page lists .ico)    | partial | 74d5bd08 (name was the title with its tagline); logo is a banner                    |
| discord.com    | Discord    | `#2b4ad1` (its theme-color `#161cbb`, adjusted) → blurple `#5865f2` | ABC Ginto Discord / gg sans / gg mono → bebas / rubik / mono                  | apple-touch-icon (an .ico, 32 px)           | partial | 7103d8fa; blurple is 0.4 % of the palette (black is 72 %), small .ico logo          |
| dropbox.com    | Dropbox    | `#0061fe` on `#f7f5f2` → Dropbox blue on cream                      | — / — / — (tokens in later sheets of 61) → bebas / rubik / mono               | og:image (the mark on blue)                 | partial | 67d8b493 (name and logo were missing), 74d5bd08; fonts                              |

Totals: 5 good, 8 partial, 1 blocked (14 sites). None refused the reader with a 403 or a challenge page.

Second run against the first: with the theme-color held to 15 % of the palette (0e04f708), Linear and GitHub
went back to a white canvas (their dark theme-colors are 18.5 % and 15 %, white is 19.9 % and 27.9 %). Discord's
theme-color is 15 % of its palette now; its brand is still that colour because blurple is under the 1 % accent
floor. Every display font maps to `bebas` (Oswald stays `oswald`).

## Fixes

| Commit   | Fix                                                                                                                                     | Site pattern it reproduces                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 5be9944a | The theme-color adds to the CSS weight of its colour and weighs a share of the palette                                                  | A white theme-color replaced white's CSS weight with 6, so the canvas went black    |
| 7103d8fa | Fonts follow `var()` chains and fallbacks, every token definition, `.font-*` classes and role-named font tokens; fallback faces dropped | `html{font-family:var(--x)}` with `--x:"Brand Sans"` (most sites)                   |
| b922ed1d | Site-wide sheets (layout, global, main…) are fetched first, colour-scheme variants last                                                 | 48 hashed sheets with the tokens in `layout.*.css`; dark/high-contrast sheets first |
| 3eca96a4 | The largest icon by `sizes` wins, and the next link is tried when one is unusable                                                       | A 57 px touch icon listed before the 256 px one                                     |
| 2abbaf9e | Comment stripping keeps quoted strings whole; negative hues wrap                                                                        | `url("/img/*.png")` hid the rest of a sheet                                         |
| 2aecfbf3 | The palette is the 16 most used colours, not the whole token list                                                                       | 555 token shades put the brand blue under the 1 % accent floor                      |
| 0aed0573 | Only whole brand words in a custom property's name weigh as brand                                                                       | `--themed-bg` badge colours weighed as brand tokens                                 |
| d3cdc818 | Emoji and symbol faces are never a brand family                                                                                         | `Apple Color Emoji` read as the only family                                         |
| ce82e588 | The theme-color weighs 15 % of the palette, so it names the scheme the page shows                                                       | Light and dark schemes in CSS, a dark theme-color, a white canvas picked            |
| 67d8b493 | `og:` tags are read from `name=` as well as `property=`                                                                                 | `<meta name="og:site_name">`, `<meta name="og:image">`                              |
| 74d5bd08 | A title's tagline after a colon is cut                                                                                                  | `<title>Brand: tagline</title>`                                                     |
| e7f669bf | Unknown display families map to the condensed `bebas`, `archivo-black` only for black/heavy/extended/wide names                         | Headlines sized for the base theme ran off the frame in `archivo-black`             |
| 0e04f708 | The theme-color's 15 % is of the 16-colour palette the theme is built from, not of the whole list                                       | On a 400-shade token list the theme-color was 60 % of the palette                   |
| 50ee7a12 | Brand words in custom property names count in any case                                                                                  | `--Brand-500`, `--PRIMARY`                                                          |
| f13e270f | A font token cut short by the var() depth limit is retried from a shallower start                                                       | A token reached first through a long chain, then directly                           |
| 5f149ef4 | An unterminated CSS string ends at its line break                                                                                       | A stray quote kept a later comment's colours                                        |

## Stills

`examples/motion-design/theme-roles.json` with `global.theme` set to each kit's `brand.theme.json`, rendered with
`leclap snapshot --per-section`.

- First run (display mapped to `archivo-black`): Stripe (blurple on white), Airbnb (Rausch on white) and Linear
  (indigo on near-black) read as the brand, but the headline's last word ran off the left edge in all three.
- After e7f669bf (display mapped to `bebas`): Stripe again, blurple on white with a light-blue surface. Every
  headline and the counter fit inside the frame; nothing is cropped.

## Still open

- Monochrome brands (Vercel, Notion) get the most saturated colour in their CSS as the accent.
- Dark sites whose CSS also ships a light scheme (Linear, GitHub) get a light canvas: their dark theme-color, at
  15 % of the palette, doesn't outweigh white.
- Pages over the 2 MB cap (Netflix) are not read, though only the `<head>` is parsed.
- Sites whose tokens or fonts live past the first 3 ranked sheets (Dropbox, GitHub's Mona Sans) or in CSS-in-JS
  (Figma) read only part of their brand.
- Logos: a 32 px favicon is used when it is all the page lists (Spotify, GitHub); `.ico`-only sites fall back to
  the og:image banner (Cloudflare).
- Names: the title is cut at `: ` when the page has no `og:site_name` or `application-name`, which would shorten a
  name like "Star Wars: Outlaws" to "Star Wars".
