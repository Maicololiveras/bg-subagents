# Issue draft — Gentleman-Programming/gentle-ai

> **Instructions for Michael**: Review this draft, then open it manually at
> https://github.com/Gentleman-Programming/gentle-ai/issues/new
> Per gentle-ai's Issue-First convention, wait for the `approved` label before opening the PR.

---

## Title

Add bg-subagents skill: background/normal subagent execution picker

---

## Body

### What is bg-subagents?

[bg-subagents](https://github.com/Maicololiveras/bg-subagents) is a small, zero-telemetry
plugin ecosystem that gives AI coding tools a user-controlled **background vs foreground
execution picker** for subagent calls.

Instead of every subagent call blocking the main conversation, the user — or a
`policy.jsonc` rule — decides per invocation:

- **Background**: the call returns `{ task_id, status: "running" }` immediately; the
  conversation continues; completion arrives asynchronously.
- **Foreground**: the call passes through unchanged, existing behavior preserved.
- **Ask**: a 2-second interactive picker appears in the terminal so the user decides
  on the spot.

The v0.1.0 adapter targets **OpenCode** (`@maicolextic/bg-subagents-opencode`).
v0.2 targets Claude Code (PreToolUse hook + marketplace); v0.3 exposes a standalone
MCP server binary.

### Why it fits gentle-ai's skill catalog

gentle-ai ships skills that help developers get more out of AI tools. bg-subagents
is exactly that kind of skill: it teaches Claude Code / OpenCode users that subagents
don't have to be synchronous — and how to configure policy to get the default that
makes sense for their workflow.

The skill doc (`SKILL.md`) is already structured for drop-in use under gentle-ai's
catalog:

- **OpenCode section** — complete, actionable, covers install + policy + `/task` commands
  + observability. Users can start using bg-subagents today.
- **Claude Code section** — stub with a clear "coming soon" note (v0.2, ETA TBD).
- **MCP section** — stub with a clear "coming soon" note (v0.3, ETA TBD).

This means the skill stays accurate as the roadmap progresses and each section
graduates from stub to complete.

### Roadmap

| Version | Adapter | Status |
|---------|---------|--------|
| v0.1.0 | OpenCode (`@maicolextic/bg-subagents-opencode`) | **Shipped** |
| v0.2.0 | Claude Code (PreToolUse hook, marketplace) | ETA TBD |
| v0.3.0 | MCP server binary (`bg-subagents-mcp`) | ETA TBD |

### Proposed PR contents

The PR would add a single file to the gentle-ai skill catalog:

```
skills/bg-subagents/SKILL.md
```

Proposed path: `skills/bg-subagents/SKILL.md` (adjust to match gentle-ai's existing catalog convention on review).

Source of truth for the file:
[`docs/skills/bg-subagents/SKILL.md`](https://github.com/Maicololiveras/bg-subagents/blob/main/docs/skills/bg-subagents/SKILL.md)
in the bg-subagents repo. The PR will copy the OpenCode section verbatim and include
the v0.2 / v0.3 stubs so the file is future-proof.

No other files would be added. No gentle-ai dependencies would be introduced.

### Demand signal

- npm: [![npm](https://img.shields.io/npm/dm/@maicolextic/bg-subagents-opencode)](https://www.npmjs.com/package/@maicolextic/bg-subagents-opencode)
- GitHub: [Maicololiveras/bg-subagents](https://github.com/Maicololiveras/bg-subagents) — see stars

### About the author

Michael Jimenez — personal project. Not affiliated with Gentleman Programming.
Opening this issue as a user and fan of the gentle-ai skill catalog.
