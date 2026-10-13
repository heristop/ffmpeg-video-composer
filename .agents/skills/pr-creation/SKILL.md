---
name: pr-creation
description: Use when committing, opening, updating or merging a pull request in this repo. Covers commit messages, the PR title (it becomes the squash commit), the description shape, evidence, CI and the squash merge with no commit body.
---

# Pull requests in this repo

## The rule

A PR merges as **one squash commit whose message is the PR title alone**. Everything else (the description, the evidence, the review) lives on GitHub, never in `git log`.

## 1. Commits on the branch

- **Format:** Conventional Commits, lowercase, subject only, no body: `feat(engine): add the burst fx primitive`. Scopes in use: `engine`, `core`, `web`, `expo`, `cli`, `mcp`, `examples`, `skills`, `samples`, `pr-media`, `changelog`, `release`.
- **Attribution:** none, in commits or in PR bodies. No `Co-Authored-By`, no "Generated with" line.
- **Consent:** commit, push, open or edit a PR only once the user has asked for it or approved it. Approval for one PR doesn't carry over to the next.
- **Small changes:** a changelog-only or docs-only catch-up may go straight to `main` instead of a PR. Ask which.

## 2. The PR title

- It becomes the squash commit's subject, so write it as one: conventional, lowercase, under ~72 characters, the user-visible outcome (`feat(engine): keyframe tracks on image, animation and html layers`).
- One concern per PR. If the title needs "and" twice, split the PR.

## 3. The description

Readers are reviewers on GitHub, not `git log`. Keep it scannable:

1. **The reason first**, in plain words: the defect, or what users couldn't do. Never lead with the change list, stars or download counts.
2. **The evidence** right after, when the diff touches `apps/leclap-web` or `apps/leclap-expo`: before/after snapshots and a LeClap-made video, playing inline. Follow the **pr-evidence** skill (`attach-video.js` through the user's browser). With no visible change, say so in one line: `No visible change: <why>`.
3. **The change**: API, how it lowers, on-device status, one short section each.
4. **Tests**, with what was measured, not just "tests pass".
5. **Limits and follow-ups.**

Pin raw media URLs to the full commit SHA. Name videos `<project>-<ticket>-evidence.mp4`.

## 4. CI

- Watch it until it finishes: `gh pr checks <n>`, then read the failing log with `gh run view <run-id> --log-failed`.
- Fix the cause, not the guard. A size budget, golden or lint rule that trips on every PR is a design signal: fix the structure, and raise a budget only with a comment saying what grew and why.
- A test that only fails locally on a loaded host (timeouts) isn't a CI failure; say so and move on.

## 5. Merging

- **Squash, title only:**

  ```bash
  gh pr merge <n> --squash --subject "$(gh pr view <n> --json title -q .title) (#<n>)" --body ""
  ```

  An empty `--body` keeps the long description out of the commit. The repository should also be set to squash with the PR title and a blank message, so merging from the web UI does the same:

  ```bash
  gh api -X PATCH repos/heristop/leclap -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK
  ```

- **Large branches** that must keep their history are the exception: ask before using a merge commit.
- **Stacked or sibling PRs** touching the same files (registries, budgets, changelogs): merge in the agreed order, then rebase each remaining branch on the new `main`, regenerate generated files (schema JSON, samples, docs tables), re-measure budgets, push, and wait for CI again.

## Checklist

- [ ] Commits: conventional, lowercase, subject only, no attribution.
- [ ] Title: reads as the squash commit subject.
- [ ] Description: reason first, evidence (or "No visible change"), change, tests, limits.
- [ ] CI green, checked with `gh pr checks`.
- [ ] Merged by squash with the title only, no body.
