# Brand kits read from real sites

The record of `leclap brand <url>` run against live sites, one row per site, judged against the site itself.
Each fix ships with a small synthetic fixture reproducing the site's pattern in
`packages/ffmpeg-video-composer/tests/brand-{css,html,theme}.test.ts`; no copy of any site is stored.

- **Date:** 2026-10-16
- **Command:** `node packages/leclap-cli/dist/index.js brand <url> -o <dir>` (HTTPS, public hosts, 2 MB and 10 s
  per response, the first 3 stylesheets after ranking)
- **Verdicts:** good (name, brand colour, readable fg/bg, the site's own fonts and its mark), partial (one of these
  is off: the row says which), blocked (the site refused, or the page could not be read under the caps)

## Results

| Site           | Name read  | Brand colour read → expected                                        | Fonts read (display / body / mono) → bundled                                          | Logo source                                 | Verdict | Fixes behind the row                                                     |
| -------------- | ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| leclap.dev     | LeClap     | `#7c83fd` lavender (accent `#f44336`) → lavender                    | Oswald / Oswald / — → oswald / oswald / mono                                          | apple-touch-icon (180, the clapper mark)    | good    | 7103d8fa (fonts were null)                                               |
| stripe.com     | Stripe     | `#533afd` → blurple                                                 | sohne-var / sohne-var / SourceCodePro → archivo-black / rubik / mono                  | apple-touch-icon (180, the S mark)          | good    | 7103d8fa (fonts were null)                                               |
| linear.app     | Linear     | `#7070ff` on `#08090a` → indigo on near-black                       | Tiempos Headline / Inter Variable / Berkeley Mono → archivo-black / rubik / mono      | apple-touch-icon (180, the mark)            | good    | b922ed1d (no CSS read), ce82e588 (light canvas), 7103d8fa (fonts)        |
| vercel.com     | Vercel     | `#7928ca` purple → black and white                                  | GeistSans / GeistSans / Geist Mono → archivo-black / rubik / mono                     | apple-touch-icon (256, the triangle)        | partial | 0aed0573, 3eca96a4, 7103d8fa; a monochrome brand still gets an accent    |
| notion.so      | Notion     | `#1313ba` deep blue → black and white                               | — / NotionInter / iA Writer Mono → archivo-black / rubik / mono                       | apple-touch-icon (512, the N cube)          | partial | 7103d8fa; a monochrome brand still gets an accent                        |
| airbnb.com     | Airbnb     | `#ff385c` on white → Rausch on white                                | Airbnb Cereal VF / Airbnb Cereal VF / — → archivo-black / rubik / mono                | icon (240, the Bélo on Rausch)              | good    | 5be9944a (canvas was black), 3eca96a4 (76 px icon)                       |
| spotify.com    | Spotify    | `#00ac44` (`#1ed760` darkened for 3:1 on white) → Spotify green     | SpotifyMixUITitle / SpotifyMixUI / SpotifyMixMono → archivo-black / rubik / mono      | icon (32 px: the page lists nothing larger) | partial | 7103d8fa (fonts were null); light canvas for a dark player, small logo   |
| figma.com      | Figma      | `#a1322e` dark red → the multicolour mark                           | — / figmaSans / figmaMono → archivo-black / rubik / mono                              | icon (256, the mark)                        | partial | 3eca96a4 (76 px icon), 7103d8fa; colours live in CSS-in-JS, 6 in sheets  |
| mozilla.org    | Mozilla    | `#0060df` blue, accent `#00ad13` green → black, Mozilla green, blue | Mozilla Headline / Mozilla Text / — → archivo-black / rubik / mono                    | icon (196, the green m)                     | good    | 3eca96a4 (180 → 196 px)                                                  |
| github.com     | GitHub     | `#0969da` on `#1e2327` → blue on GitHub dark                        | — / — / — (system stack; Mona Sans is in later sheets) → archivo-black / rubik / mono | icon (32 px png; an svg also listed)        | partial | 2aecfbf3 (brand was derived black), ce82e588, d3cdc818; fonts, logo size |
| netflix.com    | —          | —                                                                   | —                                                                                     | —                                           | blocked | page over the 2 MB response cap (not a bot block)                        |
| cloudflare.com | Cloudflare | `#ff4801` → Cloudflare orange                                       | FT Kunst Grotesk / FT Kunst Grotesk / Apercu Mono Pro → archivo-black / rubik / mono  | og:image (a banner: the page lists .ico)    | partial | 74d5bd08 (name was the title with its tagline); logo is a banner         |
| discord.com    | Discord    | `#2b4ad1` (its theme-color `#161cbb`, adjusted) → blurple `#5865f2` | ABC Ginto Discord / gg sans / gg mono → archivo-black / rubik / mono                  | apple-touch-icon (an .ico, 32 px)           | partial | 7103d8fa; theme-color outweighs the blurple, small .ico logo             |
| dropbox.com    | Dropbox    | `#0061fe` on `#f7f5f2` → Dropbox blue on cream                      | — / — / — (tokens in later sheets of 61) → archivo-black / rubik / mono               | og:image (the mark on blue)                 | partial | 67d8b493 (name and logo were missing), 74d5bd08; fonts                   |

Totals: 6 good, 7 partial, 1 blocked (14 sites). None refused the reader with a 403 or a challenge page.

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

## Stills

`examples/motion-design/theme-roles.json` with `global.theme` set to each kit's `brand.theme.json`, rendered with
`leclap snapshot --per-section`: Stripe (blurple on white), Airbnb (Rausch on white) and Linear (indigo on
near-black) all read as the brand, with readable text on every section. The headline's last word runs off the
left edge in all three: the template sizes it for a narrower display face than the bundled `archivo-black` the
kits map unknown sans display faces to.

## Still open

- Monochrome brands (Vercel, Notion) get the most saturated colour in their CSS as the accent.
- Pages over the 2 MB cap (Netflix) are not read, though only the `<head>` is parsed.
- Sites whose tokens or fonts live past the first 3 ranked sheets (Dropbox, GitHub's Mona Sans) or in CSS-in-JS
  (Figma) read only part of their brand.
- Logos: a 32 px favicon is used when it is all the page lists (Spotify, GitHub); `.ico`-only sites fall back to
  the og:image banner (Cloudflare).
