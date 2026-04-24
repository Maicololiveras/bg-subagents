# Feature-request issue for Gentleman-Programming/gentle-ai

**Target repo**: https://github.com/Gentleman-Programming/gentle-ai
**Status**: draft — NOT yet submitted
**Filed by**: @maicolextic
**Purpose**: pass the issue-first gate to unblock eventual PR for adding `@maicolextic/bg-subagents-opencode` to the OpenCode adapter.

---

## Suggested title

`[FEATURE]: Add @maicolextic/bg-subagents-opencode plugin to OpenCode adapter (background sub-agent orchestration)`

---

## Body

### Summary

`bg-subagents` is an OpenCode server plugin (`@maicolextic/bg-subagents-opencode`) that
introduces a `task_bg` tool and a `PolicyResolver` so the model can delegate sub-agents
to the background without blocking the main conversation. Users can set per-agent
default modes (`background` / `foreground` / `ask`), inspect running tasks with
`/task list|show|kill|logs`, and receive completion events seamlessly in-session.

We are requesting that `@maicolextic/bg-subagents-opencode` be added to the gentle-ai
OpenCode adapter so it appears in the installer TUI alongside the existing workflow
skills.

---

### Problem (why this matters to gentle-ai users)

- **Current gap**: OpenCode users in the gentle-ai ecosystem have no native way to
  delegate sub-agents to the background (`task_bg`) without blocking the main chat.
- **Pain**: multi-delegation turns — e.g. `sdd-explore + sdd-design + sdd-spec` running
  in parallel — either all block serially (slow) or require manual juggling of separate
  sessions.
- **What bg-subagents solves**: a server-side plugin that introduces the `task_bg` tool,
  a `PolicyResolver` (per-agent BG/FG defaults), slash commands (`/task list`,
  `/task show`, `/task kill`, `/task logs`), and clean markdown cards for task status.
  Zero TUI surface pollution — the plugin hooks into `tool.execute.before` and
  `chat.params` only, fully respecting OpenCode's native UX.

---

### What we're asking

Gentleman maintainers to consider adopting `@maicolextic/bg-subagents-opencode`
(v1.0.0, ~2 weeks from filing this issue) into the gentle-ai OpenCode adapter. Based
on our research of the repo, the concrete integration is:

| File | Change |
|------|--------|
| `internal/model/` (wherever `SkillID` constants live) | Add `SkillBgSubagents SkillID = "bg-subagents"` constant |
| `internal/catalog/skills.go` | Add one `Skill{}` entry to `mvpSkills`: `{ID: model.SkillBgSubagents, Name: "bg-subagents", Category: "workflow", Priority: "p0"}` |
| `skills/bg-subagents/SKILL.md` | New file — the skill doc copied to `~/.config/opencode/skills/bg-subagents/` on install |

No new Go dependencies are introduced into gentle-ai. The OpenCode adapter already
resolves all paths via `os.UserHomeDir()` — our plugin follows the same pattern and
is portable across Linux, macOS, and Windows.

MCP wiring (merging the `bg-subagents` server entry into `opencode.json` via
`StrategyMergeIntoSettings`) can be scoped as a follow-up PR to keep the initial
review surface minimal. The skill file copy alone is sufficient for users who follow
the manual install step in SKILL.md.

We acknowledge this would be the first third-party npm-installable skill in the
catalog, and we are open to any categorization the maintainers prefer (e.g., a
`"third-party"` category or a separate priority tier).

---

### Maturity evidence (why this is ready, not wishful)

- **518 passing tests** as of 2026-04-24, including 17 logger tests and 9
  stdout-capture pollution tests that verify no raw JSON or log blobs leak to the TUI
  during normal operation.
- **Zero visual pollution**: verified via stdout-capture tests that the plugin is silent
  to the TUI under all normal operating conditions.
- **Portability hard constraint**: all paths resolved via Node's `os.homedir()` +
  `path.join()`, config embedded in `opencode.json` under a `bgSubagents` key.
  No hardcoded platform paths anywhere.
- **Strict TDD discipline**: every feature landed via RED→GREEN→REFACTOR with a
  failing test written first. No feature merged without coverage.
- **Design traceability**: full SDD (spec-driven development) artifact trail at
  `openspec/changes/opencode-plan-review-live-control/` in the bg-subagents repo.
- **Requires OpenCode v1.14.22+** (v14 hook shapes for `tool.execute.before`). This
  constraint lives in bg-subagents' own `package.json` and does not require any
  version pinning in gentle-ai itself.

---

### Timeline

| Milestone | Date |
|-----------|------|
| Feature-request issue filed (this issue) | Now |
| v1.0.0 publishes to npm with provenance | ~2 weeks from filing |
| Implementation PR submitted | After v1.0.0 is live + `status:approved` on this issue |

---

### Offer

- We are happy to adjust `skills/bg-subagents/SKILL.md` to match any conventions you
  signal (see Alignment notes below for pre-identified items we will fix before the PR).
- We will keep this issue updated with v1.0.0 progress and link the published npm
  artifact once available.
- We will draft the implementation PR in a `feat/bg-subagents-skill` branch following
  the branch naming convention in CONTRIBUTING.md.

---

### Alignment notes (from our side)

Based on examining the existing `skills/branch-pr/SKILL.md`, we identified the
following items in our skill doc that we will align before submitting the PR:

1. **Missing YAML front-matter**: our current SKILL.md starts directly with the `# bg-subagents` heading. The gentle-ai convention (observed in `skills/branch-pr/SKILL.md`) requires a YAML front-matter block with `name`, `description`, `license`, and `metadata` (`author`, `version`) fields. We will add this before filing the PR.
2. **Config path reference**: our SKILL.md references `~/.config/opencode/config.json` in the install wiring step. The correct OpenCode settings path (confirmed via `internal/agents/opencode/adapter.go`) is `~/.config/opencode/opencode.json`. We will correct this.

No other structural misalignments were found. The rest of the SKILL.md content
(sections, tables, command reference format) matches the gentle-ai convention.

If there are additional conventions we have missed, please call them out in the
review and we will address them before merge.

---

### Related upstream

For context: we also filed a separate feature-request at `anomalyco/opencode`
requesting a public TUI plugin loader. Once that lands, bg-subagents v1.1 will add
sidebar and keybind surface. However, v1.0 works fully on the existing server plugin
surface with no TUI dependency — the gentle-ai integration is unblocked on current
OpenCode stable.

---

### Willing to help

- Draft the implementation PR once approved.
- Respond to review feedback within 48 hours.
- Update examples and documentation as needed.

**Contact**: @maicolextic (GitHub) — maicoljimenez360@gmail.com
