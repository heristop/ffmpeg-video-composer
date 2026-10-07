# Generate templates with AI

The web template builder can draft a template from a short brief, using **your own** model provider key.
Choose **Generate with AI** in the builder's title bar (or **Or describe it and generate with AI** in the
starter picker), describe the video, and pick a provider.

## How it works

1. **Prompt.** LeClap builds the prompt from the engine itself: a condensed version of the template JSON
   Schema, the motion catalog (kinetic presets, camera, graphics, transitions, easing and time-reference
   grammar, themes, delivery platforms, genre doctrine and scene blueprints) and one or two packaged
   samples that match the brief. The art direction varies the layout (edge-anchored, left-aligned,
   asymmetric and layered compositions, a centred layout on at most one beat), picks fonts from the theme
   tokens or a pairing for the genre, and adds story-spine and lazy-defaults rules. A **compose motion, don't
   pick it** block sets the motion workflow (see below). The library animation overlays are listed last,
   labelled as stock samples to use only as a last resort.
2. **Plan first.** With **Plan first** on (the default), a small planning call returns a plan: the strategy
   ("tells <audience> that <message>"), three concepts with a typicality estimate, the chosen concept, a
   beat sheet (section, role, verb, on-screen copy, why, motion intent, seconds), one or two signature moves,
   the theme, the platform and the primary and accent transitions. An invalid plan gets one repair turn; if it
   still fails, generation continues without a plan and says so. With **Review the plan** on, the run pauses
   on an editable beat table; **Write template** continues with the edited plan.
3. **Generate.** The provider streams its answer, with live progress and a cancel button.
4. **Validate and repair.** The reply is parsed and checked with the same `TemplateValidator` the renderer
   uses. When it is invalid, every finding (path, code, message, and the validator's `hint` and
   `suggestion` when known) is sent back to the model, for up to three repair rounds.
5. **Polish.** Once the template validates, the engine's advisory lint (pacing, accent overuse,
   [palette drift](./template-configuration.md#themes), and the
   [sameness lint](./template-configuration.md#compose-motion-dont-pick-stock-animations)) is sent back once as "improve if cheap". A polish reply
   that does not validate is discarded, so advisories never fail a run. The result card lists the remaining
   art-direction notes.
6. **Open.** A summary (scenes, clips to film, duration, format, effects) is shown, then the template opens
   as a new draft. Undo restores your previous draft, and saved templates are never overwritten.

Providers run on the AI SDK and are called directly from the browser:

| Provider  | Models                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| Anthropic | `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` |
| OpenAI    | Free-text model id (default `gpt-5`), JSON mode                               |

## Compose motion, don't pick it

Stock looks make every generated video look the same, so the prompt asks the model to compose motion
from the engine for each brief:

1. **Creative direction first:** who is watching, what the brand feels like, how much energy
   (`global.motion.energy`).
2. **A motion intent per section:** one line about what moves, why, and how it should feel. The plan carries it
   per beat (`motion`).
3. **Engine primitives:** kinetic typography, `animate` tracks with ease tokens or springs, the camera,
   designed transitions, `graphics` and the parametric `type: "fx"` primitives, motion roles, and beats and
   cues for timing.
4. **Tuned parameters:** for example the fx profile, width, tilt, direction, colour token, intensity, duration
   and ease, or the preset delay, stagger and accent. Never ship an effect with all-default parameters.
5. **One or two signature moves** for the whole video (the plan's `signature`). The other beats stay simpler
   so the signature moves land.

The fx primitives, their targets, parameters and ceilings are documented in
[Light and effects](./template-configuration.md#light-and-effects-graphicstype-fx); the prompt receives their
parameter names, and the motion catalog their design intent.

The library animation overlays (`/assets/animations/*.apng`, such as the shine sweep, confetti and light
leak) are samples. The prompt lists them last and labels them as a last resort. The motion catalog's
`samples` entry names the engine primitives that replace each one. The polish pass returns the
[sameness lint](./template-configuration.md#compose-motion-dont-pick-stock-animations) findings.

## Match a reference (optional)

Attach a reference image or clip under **Match a reference**. It is analysed in the browser (palette roles
with WCAG contrast, grain and pacing; see [Match a reference](./template-configuration.md#match-a-reference))
and added to both the planning and the writing prompt as binding rules: keep its palette, texture and
pacing, never copy its subjects, logos or text. Its theme takes precedence over a routed or planned theme.

## Brief routing with Jev (optional)

With a Jev (TypeSafe AI) key, LeClap first asks Jev to classify the brief: genre, platform, format,
energy, theme and the closest ready-made template, each with a confidence. Answers at 50% or more are
applied as chips you can switch off; lower ones are shown as suggestions. The chosen genre narrows the
doctrine and samples sent to the writing model, so the prompt is smaller and more relevant.

Jev picks; it doesn't write. **Start from the best match** opens the closest template with the chosen
theme, platform and format applied, for you to fill in, without any writing model. If Jev's API cannot be
reached from the browser, generation still works without it.

## Privacy

- Keys are stored only in this browser (`localStorage`, under `leclap.ai.keys.v1`; in memory when storage
  is blocked) and sent only to the provider you chose, in its authentication header.
- Keys are never sent to LeClap, never put in a URL and never logged.
- **Forget key** removes one provider's key; **Forget all keys** removes every key.
- Usage is billed to your provider account.

## Or drive the builder from your browser agent

If your browser has an AI agent with WebMCP (Chrome's origin trial or `chrome://flags/#enable-webmcp-testing`),
the builder registers its tools with it instead: the agent reads, validates and edits the open draft step by
step, each edit undoable, and opens samples, renders a preview or saves only after you allow it in the page.
It uses your browser's model, so no key is stored here. See [WebMCP](./webmcp.md).
