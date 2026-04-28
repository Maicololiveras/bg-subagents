# PR draft — Gentleman-Programming/gentle-ai

> **Instructions for Michael**: Use this as the PR body after issue #373 receives the
> `approved` label. Update `#373` with the real issue number before submitting if it differs.
> Handle: @Maicololiveras

---

## PR title

`feat(skills): add bg-subagents skill — background/foreground subagent execution for OpenCode`

---

## PR body

### Summary

Adds the `bg-subagents` skill doc to the catalog. The skill teaches users how to
configure per-invocation background vs foreground subagent execution in OpenCode (v1.0,
shipped) with stubs for Claude Code (v0.2) and MCP (v0.3) as those adapters land.

Closes #373

### What is being added

One file:

```
skills/bg-subagents/SKILL.md
```

Source: [`docs/skills/bg-subagents/SKILL.md`](https://github.com/Maicololiveras/bg-subagents/blob/main/docs/skills/bg-subagents/SKILL.md)
in the upstream repo — kept as the authoritative copy; gentle-ai carries a snapshot.

### What v1.0 ships (server + TUI)

The OpenCode adapter v1.0 is a complete two-layer plugin:

**Server layer** (`opencode.json` → `@maicolextic/bg-subagents-opencode`):
- `PolicyResolver` — per-agent-name and per-agent-type background/foreground/ask routing; no picker required
- `messages.transform` hook — batch-resolves policy; rewrites `task` → `task_bg` in LLM message parts
- `/task list`, `/task show`, `/task kill`, `/task logs`, `/task move-bg`, `/task policy` slash commands
- Zero-stdout guarantee — all diagnostics route to `~/.opencode/logs/bg-subagents.log`
- 788 tests green (50 protocol + 291 core + 447 opencode)

**TUI layer** (`tui.json` → `@maicolextic/bg-subagents-opencode/tui`):
- Sidebar slot (`sidebar_content`) showing live task list sorted by recency
- Keybinds: `Ctrl+B` (focus BG tasks), `Ctrl+F` (focus FG tasks), `↓` (open all-tasks panel)
- `api.ui.DialogSelect` modals for interactive task selection
- Shared state bridge via `Symbol.for` globalThis singleton (no HTTP round-trips)

Install is two config file entries:

```json
// opencode.json
{ "plugins": ["@maicolextic/bg-subagents-opencode"] }

// tui.json
{ "plugins": ["@maicolextic/bg-subagents-opencode/tui"] }
```

See the [migration guide](https://github.com/Maicololiveras/bg-subagents/blob/main/docs/migration-v0.1-to-v1.0.md) for upgrade steps from v0.1.

### Compatibility matrix

| Section | Adapter | Package | Status |
|---------|---------|---------|--------|
| OpenCode (server) | `experimental.chat.messages.transform` + slash commands | `@maicolextic/bg-subagents-opencode@1.0.x` | Stable |
| OpenCode (TUI) | `api.slots`, `api.command` (tui.json, OC 1.14.23+) | `@maicolextic/bg-subagents-opencode/tui` | Stable |
| Claude Code | PreToolUse hook + marketplace | `@maicolextic/bg-subagents-claude-code` (upcoming) | Coming — v0.2, ETA TBD |
| MCP | Standalone server binary | `@maicolextic/bg-subagents-mcp` (upcoming) | Coming — v0.3, ETA TBD |

The OpenCode section is complete and actionable today. v0.2 and v0.3 sections
are explicitly marked "coming soon" so they don't mislead users.

### Roadmap reminder

- **v1.0.0** (shipped): OpenCode server adapter + TUI plugin; PolicyResolver; `/task` commands + TUI keybinds + sidebar; history log. Migration guide at `docs/migration-v0.1-to-v1.0.md`.
- **v0.2.0** (ETA TBD): Claude Code adapter via PreToolUse hook; agent-pairing generator; marketplace listing.
- **v0.3.0** (ETA TBD): MCP server binary; `task_spawn/status/result/kill` tools; grace-period reconnect.

### Demo

> Terminal recording / GIF to be attached when the PR is opened.
> Placeholder capture targets:
> - `docs/demo/plan-review.cast` — PolicyResolver batch routing scenario
> - `docs/demo/live-control.gif` — `/task move-bg` + Ctrl+B TUI dialog
>
> (Captured in Phase 16 manual E2E — see upstream repo Phase 16 tasks.)

### Issue gate

This PR should only be opened after issue #373 (`approved` label) is confirmed.
The issue-first policy is respected — no PR without approval.

### Checklist

- [ ] Docs are clear and technically accurate
- [ ] All links in the skill doc are valid (schema URL, policy-schema.md, upstream repo)
- [ ] Approved issue is referenced (`Closes #373`)
- [ ] No new dependencies introduced into gentle-ai
- [ ] v0.2 and v0.3 stubs are clearly marked "coming soon" — no misleading claims
- [ ] Skill doc is self-contained: a user can follow it without reading the upstream repo
- [ ] Migration guide link (`docs/migration-v0.1-to-v1.0.md`) is valid
- [ ] Demo GIF/cast is attached (captured Phase 16)
- [ ] TUI install section reviewed (two config files: opencode.json + tui.json)
