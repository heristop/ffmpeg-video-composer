# Storyboard and preview recipe

Start with a verified brief: audience, purpose, product facts, approved copy, local assets, output format and target duration. Inspect the actual product repository or recording before choosing a demo asset. Label synthetic fixtures as illustrations; do not invent product features.

Keep the visual intention in `meta.creativeDirection` alongside the descriptor. The reference JSON
files each include a direction suited to their composition. This optional prose is preserved when
editing; rendering still uses explicit JSON settings and effect props. For CLI and MCP entry points,
see the [creative-direction guide](../../docs/creative-direction.md).

## Plan the composition

Write one row per scene before authoring JSON:

| Scene         | Purpose               | Composition                               | Motion and timing                     | Asset                 | Review frames                   |
| ------------- | --------------------- | ----------------------------------------- | ------------------------------------- | --------------------- | ------------------------------- |
| Hook          | Establish the promise | One dominant headline with negative space | Fast lateral entrance, readable hold  | Brand copy            | Before entrance, settling, hold |
| Demonstration | Prove one feature     | Screen first, caption clear of controls   | Restrained caption entrance           | Actual screen capture | Beginning, interaction, end     |
| Invitation    | Give a next action    | Wide CTA or offer-led typography          | Stagger lines; hold the final message | Approved CTA          | Settling and final frame        |

This is an example storyboard, not a mandatory three-card layout. A tutorial may open directly on its screen recording; a reel can remain full-bleed throughout. Differentiate templates by hierarchy, anchors, type scale, motion direction and pacing. Palette changes alone are insufficient. Avoid repeating the same lower-third band on every scene.

## Select the rendering route

- Use ordinary LeClap JSON for footage, titles, captions, layers, cuts, audio and existing text entrance/exit controls. It runs through the cross-platform engine. For brief composited accents, use the shared [overlay effect recipes](../overlay-effects/README.md): Interface Focus, Product Spotlight and Celebration Burst expand into ordinary animated inputs.
- Call `get_effect_schema({ list: true })` for trusted registered Remotion effects, then request the exact ID/version contract. Use Remotion when the storyboard needs per-word choreography, a camera move, or a custom product component beyond the ordinary primitives.
- Register new operator-owned components through the existing catalog. The registered effect route currently requires opaque H.264 at 1280×720, 30 fps and 300 frames. Do not put those effects into square/portrait samples expecting automatic adaptation.
- Keep source, props and assets fixed for reproducibility. Remotion motion must depend on frame time; avoid wall-clock timers, CSS transitions and unseeded randomness. Reuse the existing Remotion worker, rather than adding a second HTML/browser renderer.

## Review before export

1. Validate the template and retain its revision. Check the longest supported form copy with the real fonts.
2. For registered effects, request selected frames with `render_preview`, including entrance, overshoot/settling, readable hold and ending. Preview a short `frameRange` around a motion beat before requesting the full clip. Ordinary JSON scenes currently need an engine render followed by frame extraction; do not assume the registered-effect preview tool supports them.
3. Inspect assets, copy, crop, contrast and text bounds. Check that typography does not obscure the product interaction. Inspect the motion range for collisions and verify the final frame remains readable.
4. Apply semantic changes through `edit_template` `effectProps` for registered effect props, with `expectedRevision`. Save the returned template and revision and inspect the changed beat again.
5. Compose approved scenes. Review joins and measure audio peaks/duration; listen to the mix where playback is available. Verify video duration separately from audio/container padding.
6. Repeat unchanged registered-effect requests to reuse the existing cache. Change only the scene that needs revision. Scene-level effect reuse is implemented; whole-project incremental FFmpeg compilation is not.

Prefer readable holds and deliberate cuts over constant motion. Use opposing entrances or small overshoots for emphasis, not for every text line. Time cuts against actual music or narration timestamps when available; BPM labels alone do not establish synchronization.

The workflow adapts storyboard-first authoring and deterministic frame sampling described in [this article](https://huggingface.co/blog/karmen-beatapi/how-to-make-videos-with-claude-opus-5-5). Its model cost and speed figures are not LeClap benchmarks.
