# PR draft — Gentleman-Programming/gentle-ai

> **Instructions for Michael**: Use this as the PR body after the issue receives the
> `approved` label. Update `#<issue-num>` with the real issue number before submitting.

---

## PR title

`feat(skills): add bg-subagents skill — background/normal subagent execution picker`

---

## PR body

### Summary

Adds the `bg-subagents` skill doc to the catalog. The skill teaches users how to
configure per-invocation background vs foreground subagent execution in OpenCode (v0.1,
shipped) with stubs for Claude Code (v0.2) and MCP (v0.3) as those adapters land.

Closes #<issue-num>

### What is being added

One file:

```
skills/bg-subagents/SKILL.md
```

Source: [`docs/skills/bg-subagents/SKILL.md`](https://github.com/Maicololiveras/bg-subagents/blob/main/docs/skills/bg-subagents/SKILL.md)
in the upstream repo — kept as the authoritative copy; gentle-ai carries a snapshot.

### Compatibility matrix

| Section | Adapter | Package | Status |
|---------|---------|---------|--------|
| OpenCode | `tool.execute.before` hook | `@maicolextic/bg-subagents-opencode@0.1.x` | Stable |
| Claude Code | PreToolUse hook + marketplace | `@maicolextic/bg-subagents-claude-code` (upcoming) | Coming — v0.2, ETA TBD |
| MCP | Standalone server binary | `@maicolextic/bg-subagents-mcp` (upcoming) | Coming — v0.3, ETA TBD |

The OpenCode section is complete and actionable today. The v0.2 and v0.3 sections
are explicitly marked "coming soon" so they don't mislead users.

### Roadmap reminder

- **v0.1.0** (shipped): OpenCode adapter; policy JSONC; `/task` commands; history log.
- **v0.2.0** (ETA TBD): Claude Code adapter via PreToolUse hook; agent-pairing generator; marketplace listing.
- **v0.3.0** (ETA TBD): MCP server binary; `task_spawn/status/result/kill` tools; grace-period reconnect.

### Screenshots / demo

<!-- TODO: Add terminal recording or screenshot showing the picker in action -->
<!-- Suggested: `vhs` tape or `asciinema` recording of the 2-second picker -->

### Checklist

- [ ] Docs are clear and technically accurate
- [ ] All links in the skill doc are valid (schema URL, policy-schema.md, upstream repo)
- [ ] Approved issue is referenced (`Closes #<issue-num>`)
- [ ] No new dependencies introduced into gentle-ai
- [ ] v0.2 and v0.3 stubs are clearly marked "coming soon" — no misleading claims
- [ ] Skill doc is self-contained: a user can follow it without reading the upstream repo
