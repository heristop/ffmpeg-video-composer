# `leclap reference` on real clips

The reference-structure analyzer, run on real footage and renders and compared with a frame sheet scrubbed
by eye (`fps=4`, timecode on each tile). A cut counts as found within one sample (0.25 s); transitions
are checked by name (cut / dissolve / dip); a cut found on a pan, a flash or a UI animation is invented.

Run: 2026-10-16, engine at `feat/reference-structure` after the fixes below (bars cropped, black runs as
one dip, slow dissolves, flashes, 0.25 s grid up to five minutes).

| Clip                                                   | Kind                                                                                                        | Shots counted                                                       | Shots found | Misses / extras                                                                                                                                                                                                                                                                                    | Verdict |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `showcase/footage-edit.mp4` (15.0 s)                   | Real footage, hard cuts, a pan, a speed ramp, a freeze                                                      | 7 (cuts 1.9, 4.6, 8.9, 11.9, 12.9, 14.1)                            | 7           | none; no cut on the pan (2–4.5 s) or the ramp                                                                                                                                                                                                                                                      | good    |
| `footage-transitions.mp4` (16.3 s, built for this run) | Real footage: 1.5 s dissolve, 1 s fade through black, fade out + 0.75 s black hold + fade in, two hard cuts | 6 (dissolve 4.25, dip 8.0, dip 12.9, cuts 14.1, 15.4)               | 6           | none; the dissolve and both dips named right (before the fixes: 2 found, dissolve and first dip missed, black hold read as a cut)                                                                                                                                                                  | good    |
| `showcase/story-reel.mp4` (11.2 s)                     | Portrait footage pillarboxed in 16:9, two 0.4 s swipes                                                      | 3 (swipes ≈ 3.7, 7.4)                                               | 3           | swipes read as cuts (no push guess exists); before the bar crop: 1 shot, both swipes missed                                                                                                                                                                                                        | good    |
| `captures/selfie-wave-source.mp4` (14.6 s)             | Handheld selfie talking head, one shot                                                                      | 1                                                                   | 1           | none; no cut invented despite constant handheld motion (motion 0.95)                                                                                                                                                                                                                               | good    |
| `videos/earth.mp4` (30.5 s)                            | Long single shot, dark ground, slow rotation                                                                | 1                                                                   | 1           | cuts right; anchor reads `top-left` (the lit city detail) where the globe sits centre-left                                                                                                                                                                                                         | good    |
| `public/v3/phone-flow.mp4` (150 s)                     | Phone screen recording                                                                                      | 14 screens (scrubbed; 0.5 s screens at 37 and 138 checked at 4 fps) | 12          | every full-screen change found (form 19.1, record 29.9, picker 34.4, record 37.1, preview 37.6, form 61.6, render 66.1, form 137.9, result 138.4, clip 140.4, bumper 146.1); the two modal sheets over the form (22, 26 s) missed; no cut on the list scroll (15 s) or during the 72 s render wait | good    |
| `showcase/interview.mp4` (15.8 s)                      | Title cards on dark, swipe, talking head, outro                                                             | 4 (title→question 2.4, swipe 5.0, outro 13.6)                       | 3           | the title→question change (faint text on near-black, diffs 0.015) missed; the swipe reads as a dissolve; the talking head has no invented cut                                                                                                                                                      | partial |
| `showcase/photo-backdrop.mp4` (13.2 s)                 | Photo, 0.6 s dissolve, footage, outro                                                                       | 3 (dissolve 3.5, outro 11.0)                                        | 4           | an extra 0.38 s first shot from the fade in from a dark (not black) frame; the 0.6 s dissolve reads as a cut; the outro's light flash no longer splits it                                                                                                                                          | partial |
| `brand-motion/out/leclap-v3.mp4` (82.5 s)              | Launch film: dark UI scenes on a 120 BPM grid, internal panel changes                                       | 13 (scene cuts ≈ 6, 17, 22, 29, 34, 42, 49, 55, 59, 63, 70, 79)     | 12          | found 8 of 12: 6, 17, 22, 29, 49, 55, 70, 79 (dip); missed 34, 42, 59, 63 (dark-UI to dark-UI, diffs 0.05–0.07 under the cut floor); extras 10.9, 63.9, 72.9 are panel changes inside a scene                                                                                                      | partial |

## Fix round 1 (2026-10-16): brightness ramps, grey fades, grain

After `fix(engine): keep brightness ramps inside a shot and read grey fades as dips` (blends that are a
gain and offset of one picture are not dissolves; a short blank dark-grey bottom of a fade is a dip).

| Clip                                                | Before                                                                         | After                                            | Verdict |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | ------- |
| the nine clips above                                | as in the table above                                                          | identical shot lists (diffed run outputs)        | same    |
| `footage-exposure.mp4` (11.5 s, built for this run) | 3 shots: the 0.5 s dark-grey hold read as its own shot between two `dissolve`s | 2 shots, one `dip` at 6.13 (grey hold 6.0–6.5 s) | good    |

`footage-exposure.mp4`: the selfie clip brightened by `eq` from 2 s to 4 s (an exposure ramp in one shot),
a 0.75 s fade to `#262626`, a 0.5 s grey hold, a 0.75 s fade in to the café footage. The exposure ramp
gives no boundary before or after the fix on this footage (the selfie's own motion already broke the
blend test); the flat-frame ramps in `structure-shots.test.ts` covered the case it used to invent.

Grain (carried item: anchor on grainy footage), `noise=alls=40:allf=t` added with mise's ffmpeg:

| Clip (noisy) | Shots (clean → noisy)                                                                          | Anchors (clean → noisy)                                           | Verdict |
| ------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| footage-edit | 7 → 7, same cuts                                                                               | 5 shots unchanged; shots 4–5 `bottom-left`/`bottom` → `spread`    | good    |
| earth        | 1 → 1                                                                                          | `top-left` → `spread`                                             | good    |
| interview    | 3 → 3: the title change at 2.5 now found (read as `dip`), the outro at 13.6 lost               | `center` kept on the talking head; title card `center` → `spread` | partial |
| story-reel   | 3 → 1: grain on the pillarbox bars stops them reading as bars, so both swipes are missed again | `spread` → `center`                                               | partial |

Heavy grain never pulled the anchor onto a spurious cell: the edge energy spreads evenly and the shot
reads `spread`, which the prompt states as "detail spread across the frame". No anchor change was made.

## Limits seen on real clips (not fixed)

- Grain over letterbox or pillarbox bars (a film-grain pass on the whole frame) keeps them from being
  cropped, so the bars dilute the frame differences again.
- A fast fade through dark grey whose bottom falls between two samples reads as a `dissolve`.

- Low-contrast scene changes on dark grounds — a title card to a title card, a dark interface to another —
  stay under the cut detector's 0.1 absolute floor. Lowering it would also cut inside the same film's UI
  animations (ratios ×10 inside scenes), so luma alone can't separate them.
- Pushes, swipes and zoom-throughs read as cuts or dissolves: there is no `push` guess.
- A fade in from a dark but detailed first frame (not black) can open with a short extra shot.
- The anchor follows edge energy: on a large subject (a globe) it picks the busiest part of it.
