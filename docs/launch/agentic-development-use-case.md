# Agentic development use case — launch pack

## Message hierarchy

**Primary message:** Don't describe the change. Show it.

LeClap gives a development agent a deterministic way to turn implementation evidence into a short video artifact for a pull or merge request.

**Supporting points:**

- The source is real implementation evidence, not generated footage.
- A reusable JSON template keeps the structure consistent.
- Validation happens before rendering.
- The reviewer receives behavior, context, and a precise review focus beside the diff.
- LeClap renders the artifact; the surrounding workflow uploads it.

**Proof point:** The repository ships a runnable, schema-validated example that turns a walkthrough and explicit review focus into a short review artifact. Do not add confidential identifiers, private details, or performance claims.

## LinkedIn

Code review is still mostly asked to prove visual behavior with prose.

An agent finishes a feature, writes a clean summary, lists the tests, and opens a pull request. The diff may be correct. The description may be precise. But if the change affects an interface, the reviewer still has to reconstruct the behavior locally before they can see what changed.

That gap is a useful LeClap use case.

The workflow is simple:

1. The development agent implements the change.
2. It collects a short, real screen recording and states the exact review focus.
3. It fills a reusable LeClap template with the project, change, and review context.
4. It validates the descriptor and renders a deterministic MP4.
5. The surrounding workflow attaches that artifact to the pull or merge request.

The video is not generated from a vague prompt. LeClap composes explicit footage, text, timing, and transitions through a validated JSON template. The same inputs reproduce the same authored sequence on a given platform.

For the reviewer, that means the PR contains three complementary layers: the claim in the description, the implementation in the diff, and the visible behavior in the video. The clip is deliberately short. It names the change, shows the walkthrough, calls out what to inspect, then hands the reviewer back to the code.

An Evidence skill can structure the proof collected while an agent works. LeClap can turn the selected, publishable part of that evidence into a consistent review artifact. The important boundary is that evidence is curated: no confidential identifier or private implementation detail is required.

LeClap itself does not publish to GitHub or GitLab. It renders the artifact and returns its path. Uploading remains an explicit action in the agentic workflow, where permissions and review policy already live.

The broader idea is that agentic development should not stop at producing code. It should also produce reviewable evidence. If an agent can ship the change, it can ship the proof with it.

Runnable example: https://github.com/heristop/leclap/tree/main/examples/agentic-pr-video

## X thread

**1/5** Agentic development should ship more than code. For UI changes, the PR should include the visible behavior too. LeClap turns real implementation evidence into a short, deterministic review video.

**2/5** The loop: implement → collect a walkthrough + review focus → author a JSON template → validate → render → attach the MP4 to the PR/MR.

**3/5** This is composition, not generated video. The footage, text, timing, and transitions are explicit inputs. A reviewer sees the behavior before reconstructing it locally.

**4/5** An Evidence skill can structure proof collection during implementation. LeClap can package the selected, publishable evidence without exposing confidential identifiers or private details.

**5/5** LeClap renders the artifact; it does not upload it. The surrounding workflow keeps control of GitHub/GitLab permissions and publication. Example: https://github.com/heristop/leclap/tree/main/examples/agentic-pr-video

## GitHub / GitLab announcement

### Agentic PR evidence with LeClap

The repository now includes a runnable use case for agentic development: an agent can turn a real implementation walkthrough and explicit review focus into a short, deterministic MP4 for a pull or merge request.

The example covers the complete artifact flow:

`implement → collect evidence → author template → validate → render → attach`

Start with [`examples/agentic-pr-video`](../../examples/agentic-pr-video). The template opens with project and change context, shows the recorded implementation with a review-focus lower third, and closes by handing the reviewer back to the code.

LeClap renders the local artifact. It does not upload to GitHub or GitLab; keep that explicit step in the surrounding workflow.

## Publication checklist

- Verify every product claim against the current repository and docs.
- Use only deliberately selected, publishable evidence.
- Do not disclose confidential identifiers.
- Mention the Evidence skill only as structured proof collection.
- Do not invent metrics, outcomes, quotes, or adoption claims.
- Link the canonical landing page and runnable example.
- Confirm the example still validates before publication.
- Review the final copy manually; never auto-publish.

## Campaign angle — the feature ships its own proof

Status: review draft. The supporting feature and its PR media are now on `main`; publication still requires human approval.

Verified proof on `feat/motion-effects`:

- a browser agent operates the real LeClap builder through its browser tools;
- the interaction is captured as real screen recordings;
- a LeClap JSON template composes those recordings into a PR reel;
- the branch keeps the rendered MP4, selected stills, template, and regeneration scripts together;
- validation, render QC, and review snapshots happen before the artifact is attached by the surrounding workflow.

### LinkedIn

Most feature PRs explain what changed. This one shows what happened.

While building browser-agent controls for LeClap, the workflow recorded the agent operating the real builder: editing a template, undoing a change, requesting confirmation, rendering a preview, and turning agent access off.

LeClap then composed those recordings into the review reel for the same change.

The branch carries the template, the finished video, selected stills, and the scripts that regenerate them. A reviewer can watch the behavior first, then inspect the implementation with the right context.

That is the agentic-development use case in practice: implementation evidence becomes a structured, reproducible review artifact. LeClap renders it locally; the surrounding workflow keeps publication explicit.

Don't just describe the change. Show it.

### X thread

**1/5** A coding agent should not hand a reviewer only a diff and a summary. When the change is visual, it should ship the visible proof too.

**2/5** For a LeClap feature branch, a browser agent was recorded operating the real builder: editing, undoing, requesting confirmation, rendering a preview, and switching agent access off.

**3/5** Those real captures became the inputs to a LeClap JSON template. LeClap composed them into the PR reel; it did not invent the footage.

**4/5** The branch keeps the template, rendered MP4, selected stills, and regeneration scripts together. The review artifact is part of the change, not an unrelated demo assembled later.

**5/5** LeClap renders locally and leaves attachment or publication to the surrounding workflow. The result: show the behavior, then review the code.

### GitHub / GitLab announcement

#### Reproducible video evidence for an agent-driven UI change

This feature branch includes its own review media. A browser agent operates the real LeClap builder while the workflow records the interaction. A LeClap JSON template then turns those recordings into a structured PR reel.

The branch keeps the review inputs and outputs together:

- real interaction captures;
- the LeClap reel template;
- the rendered MP4 and selected stills;
- scripts to regenerate the media;
- validation, render QC, and review-snapshot steps.

This makes the video evidence inspectable and repeatable alongside the implementation. LeClap creates the local artifact; uploading or attaching it remains an explicit action in the GitHub or GitLab workflow.

## Campaign angle — make visible proof part of done

Status: review draft. Verified against `main` at the 3.1.0 release; do not publish automatically.

Verified proof:

- app pull requests are expected to include matched before/after snapshots and a before/after video rendered with LeClap, unless the change has no visible effect;
- the captures come from the merge base and the branch under review, using the same screen, state, data, and viewport;
- the current workflow can align both runs side by side, freeze the comparison point, and highlight the changed areas;
- the resolved template is validated and the render includes a manifest and output quality checks;
- the repository includes a runnable example, a rendered MP4, a poster, stills, and the files needed to reproduce the artifact;
- attaching or publishing the artifact remains an explicit action in the user's code-host workflow.

### LinkedIn

What if visible proof were part of the definition of done for an agent-written change?

That is now the rule for LeClap's own app pull requests.

When a change affects the interface, the agent captures the same state on the merge base and on the branch. LeClap turns those recordings into a short side-by-side review video, with an optional freeze and highlights on the exact moment that changed.

The artifact is not a generated approximation. It is composed from the implementation evidence itself, using a validated template and the repository's own video engine.

The PR keeps the video, selected snapshots, and the files needed to reproduce them beside the code. The reviewer can see the behavior first, then inspect the diff with the right context.

Structured proof collection makes the evidence consistent. LeClap makes it reviewable. Publication remains explicit and under the user's control.

Agentic development should not stop at “the tests pass.” It should show what changed.

### X thread

**1/5** What if visible proof were part of “done” for an agent-written UI change? In LeClap's own app PRs, it now is.

**2/5** The agent captures the same screen, state, data, and viewport on the merge base and on the branch. No comparing the fix against memory.

**3/5** LeClap composes both real recordings side by side. The workflow can freeze the key moment and highlight exactly where the behavior changed.

**4/5** The video is validated and quality-checked, then kept with selected snapshots and its reproducible inputs beside the code.

**5/5** LeClap creates the review artifact. Attaching or publishing it stays explicit in the user's GitHub or GitLab workflow. Ship the change; show the proof.

### GitHub / GitLab announcement

#### Visible app changes now carry reproducible LeClap evidence

The repository's app-PR workflow now treats visual evidence as part of completion. A pull or merge request that changes the web or mobile interface should include matched before/after snapshots and a before/after video rendered with LeClap, unless the change has no visible effect.

The comparison is grounded in the code under review:

- BEFORE comes from the branch's merge base;
- AFTER comes from the branch;
- both captures use the same screen, state, data, and viewport;
- LeClap aligns the runs side by side and can freeze and highlight the comparison point;
- the resolved template is validated, and the render produces a manifest plus output quality checks.

The repository includes the runnable workflow, a rendered sample, its poster and stills, and the files needed to reproduce the artifact. Structured proof collection keeps the input consistent; LeClap turns it into a review-ready video.

The render remains local. Uploading or attaching the result is a separate, explicit action in the GitHub or GitLab workflow.
