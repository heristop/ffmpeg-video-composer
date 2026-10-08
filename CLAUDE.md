# CLAUDE.md

@AGENTS.md

[`AGENTS.md`](./AGENTS.md), imported above, is the canonical agent guide for this repo. This file only adds what is specific to Claude Code.

## Claude Code specifics

- Repo skills live in [`.agents/skills/`](./.agents/skills/), not `.claude/skills/`; load them as AGENTS.md describes.
- Local Claude Code state (`.claude/settings.local.json`, `.claude/scheduled_tasks.lock`) is gitignored; no shared `.claude/` settings are committed.
