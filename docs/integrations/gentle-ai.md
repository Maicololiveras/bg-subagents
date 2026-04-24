# Gentle-AI integration

`bg-subagents` is designed to be distributed as part of the [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) installer toolkit — a Go TUI binary that configures AI coding agents on the user's machine.

---

## Current status (2026-04-24)

- Issue [#373](https://github.com/Gentleman-Programming/gentle-ai/issues/373) filed — awaiting `status:approved` from the maintainer.
- PR not yet submitted — gentle-ai enforces issue-first: the PR is blocked until the issue receives `status:approved`.
- v1.0.0 publication to npm is the prerequisite for submitting the PR. ETA: ~2 weeks from issue filing.

---

## Integration mechanism

gentle-ai is a compiled Go binary (not a config file repo). Adding a new skill requires three source changes:

| File | Change |
|------|--------|
| `internal/model/` (wherever `SkillID` constants live) | Add `SkillBgSubagents SkillID = "bg-subagents"` constant |
| `internal/catalog/skills.go` | Add one `Skill{}` entry to `mvpSkills`: `{ID: model.SkillBgSubagents, Name: "bg-subagents", Category: "workflow", Priority: "p0"}` |
| `skills/bg-subagents/SKILL.md` | New file — snapshot of `docs/skills/bg-subagents/SKILL.md` in this repo |

No new Go dependencies are introduced into gentle-ai. The OpenCode adapter already resolves all paths via `os.UserHomeDir()` — bg-subagents follows the same pattern and is portable across Linux, macOS, and Windows.

For the full technical analysis of the gentle-ai repo structure (catalog mechanism, pipeline, open questions), see [docs/upstream/gentle-ai-pr-v2.md](../upstream/gentle-ai-pr-v2.md).

### SKILL.md format

The skill doc submitted to gentle-ai must include YAML front-matter (required by the gentle-ai convention):

```yaml
---
name: bg-subagents-opencode
description: >
  Background vs foreground sub-agent execution for OpenCode.
  Trigger: When delegating sub-agents and you need non-blocking
  task execution with TUI integration.
license: MIT
metadata:
  author: maicolextic
  version: "1.0"
---
```

The current skill doc at [docs/skills/bg-subagents/SKILL.md](../skills/bg-subagents/SKILL.md) already includes this front-matter and is ready to submit.

### MCP auto-wiring (Phase 2 / follow-up PR)

The initial PR scopes to skill file copy only (safe, minimal review surface). Full auto-wiring — merging the `bg-subagents` server entry into `~/.config/opencode/opencode.json` via `model.StrategyMergeIntoSettings` — is planned as a follow-up PR once the skill file precedent is established.

---

## What users get (once approved and merged)

1. User runs `gentle-ai` TUI and selects OpenCode + bg-subagents.
2. gentle-ai copies `skills/bg-subagents/SKILL.md` to `~/.config/opencode/skills/bg-subagents/SKILL.md`.
3. User follows the SKILL.md install steps (npm install + `opencode.json` wiring).
4. bg-subagents is active — all `task` calls route BG/FG per the configured policy.

---

## Related upstream work

| Doc | What it covers |
|-----|---------------|
| [docs/upstream/gentle-ai-pr.md](../upstream/gentle-ai-pr.md) | PR body draft — ready to paste when issue is approved |
| [docs/upstream/gentle-ai-pr-v2.md](../upstream/gentle-ai-pr-v2.md) | Detailed analysis of gentle-ai repo structure, exact files to modify, open questions |
| [docs/upstream/gentle-ai-feature-request-issue.md](../upstream/gentle-ai-feature-request-issue.md) | The issue body filed as #373 |
| [docs/upstream/opencode-docs-pr.md](../upstream/opencode-docs-pr.md) | Separate OpenCode docs PR (tui.json documentation, independent of gentle-ai) |
| [docs/upstream/opencode-docs-pr-draft.mdx](../upstream/opencode-docs-pr-draft.mdx) | Ready-to-paste MDX content for the OpenCode docs PR |

---

## Author / contact

[@Maicololiveras](https://github.com/Maicololiveras) — maicoljimenez360@gmail.com

Maintain contact with the gentle-ai maintainer via issue #373 comments. Respond to feedback within 48 hours per the CONTRIBUTING.md expectation.
