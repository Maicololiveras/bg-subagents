# @maicolextic/bg-subagents-opencode

OpenCode plugin for background sub-agent orchestration — non-blocking `task_bg` execution with per-agent policy, slash commands, and optional TUI integration.

[![npm](https://img.shields.io/npm/v/@maicolextic/bg-subagents-opencode)](https://www.npmjs.com/package/@maicolextic/bg-subagents-opencode)
[![license](https://img.shields.io/npm/l/@maicolextic/bg-subagents-opencode)](./LICENSE)

---

## Features

**Server layer (OpenCode 1.14.22+)**

- `task_bg` tool registered via Zod 4 schema — LLM-callable, returns `{ task_id, status: "running" }` immediately
- `PolicyResolver` — per-agent default mode (`background` / `foreground`) configured in `opencode.json`, with `*` wildcard fallback
- `messages.transform` interceptor — rewrites multi-agent batches before they reach the LLM, no picker UI required
- `/task policy` — session-scoped override (force all bg / fg / clear)
- `/task list`, `/task show`, `/task logs`, `/task kill`, `/task move-bg` — full task lifecycle from chat
- Completion delivery via `client.session.message.create` with 2000 ms ack-timeout fallback
- Zero stdout pollution — all diagnostics route to a log file; TUI receives only clean markdown cards

**TUI layer (OpenCode 1.14.23+ — optional)**

- Sidebar slot: live background task list (status, agent name, elapsed time)
- `Ctrl+B` / `Ctrl+F` / `↓` keybinds for task focus and panel navigation
- Plan-review dialog (`api.ui.DialogSelect`) for interactive per-task BG/FG override on multi-delegation turns
- Loaded via `tui.json` — independent of the server plugin; server plugin works without it

---

## Requirements

| Requirement | Version |
|-------------|---------|
| OpenCode | 1.14.22+ (server plugin) / 1.14.23+ (TUI plugin) |
| Node.js | 18+ |
| npm / pnpm | any recent version |

---

## Installation

**Step 1 — install the package:**

```bash
npm install @maicolextic/bg-subagents-opencode
# or
pnpm add @maicolextic/bg-subagents-opencode
```

**Step 2 — wire the server plugin** in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"],
  "bgSubagents": {
    "policy": {
      "sdd-explore":  "background",
      "sdd-apply":    "foreground",
      "sdd-verify":   "foreground",
      "*":            "background"
    }
  }
}
```

**Step 3 (optional) — wire the TUI plugin** in `~/.config/opencode/tui.json`:

```json
{
  "plugin": [
    {
      "module": "@maicolextic/bg-subagents-opencode/tui"
    }
  ]
}
```

The TUI plugin requires the `id` field in its default export (handled internally). No extra config needed beyond the `tui.json` entry.

---

## Quick Start

Minimal `opencode.json` to get started with everything running in the background by default:

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"],
  "bgSubagents": {
    "policy": {
      "*": "background"
    }
  }
}
```

Run a multi-agent prompt — all `task` calls are transparently rewritten to `task_bg`. Use `/task list` to see running tasks.

---

## Configuration Reference

All config lives under the `bgSubagents` key in `opencode.json`.

```json
{
  "bgSubagents": {
    "policy": {
      "<agent_name>": "background" | "foreground",
      "*":            "background" | "foreground"
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `bgSubagents.policy` | `Record<string, "background" \| "foreground">` | `{ "*": "background" }` | Per-agent default mode. Exact name match; `"*"` is the wildcard fallback applied when no specific key matches. |

---

## Commands Reference

### `/task policy <mode>`

Override PolicyResolver for the current session.

| Mode | Effect |
|------|--------|
| `bg` | Force all agents to background for this session |
| `fg` | Force all agents to foreground for this session |
| `default` | Clear override; per-agent config from `opencode.json` resumes |

Example:

```
/task policy bg
```

### `/task list`

List all tasks (running + completed). Output: markdown table with task ID, agent name, status, start time.

### `/task show <id>`

Full detail for a single task: agent name, mode, status, start/end time, partial result if available.

### `/task logs <id>`

Stream JSONL log lines for a task. Useful for diagnosing stalled or failed background tasks.

### `/task kill <id>`

Abort a running task immediately. The task is cancelled and removed from the active registry.

### `/task move-bg <id>`

Move a currently foreground task to the background mid-execution. Cancels the foreground run and respawns as `task_bg`.

---

## Keybinds (TUI plugin)

Available when the `./tui` subpath is loaded via `tui.json`.

| Keybind | Action |
|---------|--------|
| `Ctrl+B` | Focus the most recent background task |
| `Ctrl+F` | Focus the most recent foreground task |
| `↓` (down arrow) | Open the task management panel |

> Note: the exact keybind string for the down arrow (`"down"` vs `"arrow-down"`) should be verified against your OpenCode version in Phase 16 manual E2E.

---

## Observability

| Resource | Path |
|----------|------|
| Log file (POSIX) | `~/.opencode/logs/bg-subagents.log` |
| Log file (Windows) | `%APPDATA%\opencode\logs\bg-subagents.log` |
| Override log path | Set `BG_SUBAGENTS_LOG_FILE` env var |
| Enable debug logs | Set `BG_SUBAGENTS_DEBUG=true` (mirrors to stderr in addition to file) |

Zero stdout guarantee: no raw JSON, no event dumps, no ANSI from bg-subagents appear in the TUI under normal operation. All diagnostic output is routed to the log file.

---

## Architecture Overview

```
opencode.json  ──── plugin loader ───► server plugin (packages/opencode/src)
                                         │
                    ┌────────────────────┤
                    │                    │
              host-compat/v14/     plan-review/
              ├── tool-register    ├── rewrite-parts
              ├── messages-transform  └── types
              ├── slash-commands   packages/core/src
              ├── delivery         ├── policy/resolve-batch
              ├── system-transform └── registry/task-registry
              └── index (buildV14Hooks)
                    │
                    │  SharedPluginState (Symbol.for globalThis)
                    │
tui.json  ────── TUI plugin loader ──► tui-plugin/
                                         ├── shared-state
                                         ├── sidebar
                                         ├── plan-review-dialog
                                         ├── keybinds
                                         └── index (id: "bg-subagents-tui")
```

**Key patterns:**

- **SharedPluginState**: server plugin writes `TaskRegistry` + `TaskPolicyStore` to `globalThis[Symbol.for("@maicolextic/bg-subagents/shared")]` at boot. TUI plugin reads the same reference — zero IPC, zero latency, because both plugins run in the same OpenCode process.
- **messages.transform interceptor**: fires before every LLM message batch. PolicyResolver runs synchronously over all `task` call parts; rewrite happens inline. Idempotent — a `PlanReviewMarker` part prevents double-rewriting.
- **Delivery**: primary path is `client.session.message.create`. If not acked within 2000 ms, fallback fires via `client.session.prompt({ noReply: true })`. Deduplicated via `TaskRegistry.markDelivered`.

---

## Troubleshooting

**Plugin not loading at all**

- Confirm `plugin` (singular, array) is used in `opencode.json`, not `plugins`.
- Confirm the package is installed: `node_modules/@maicolextic/bg-subagents-opencode/` must exist relative to your OpenCode install or globally.

**TUI sidebar not showing / keybinds not working**

- Confirm `tui.json` is in `~/.config/opencode/tui.json`, not `opencode.json`.
- Confirm OpenCode version is 1.14.23+ (`opencode --version`).
- The TUI entry exports `{ id: "bg-subagents-tui", tui: TuiPlugin }` — if the log shows `"Path plugin ... must export id"`, the package is an older build. Reinstall the latest version.

**Raw JSON appearing in the TUI (log pollution)**

- This indicates an older version (< v1.0.0) or a development build with `BG_SUBAGENTS_DEBUG=true` set.
- Unset `BG_SUBAGENTS_DEBUG` and restart OpenCode.
- Check `~/.opencode/logs/bg-subagents.log` for what the plugin is doing.

**`/task` commands not recognized**

- Commands require the server plugin to be loaded via `opencode.json` (not only `tui.json`).
- Verify `plugin: ["@maicolextic/bg-subagents-opencode"]` is in `opencode.json`.

**Missing `id` field error from TUI loader**

- OpenCode 1.14.23+ runtime requires `id: string` in TUI plugin exports. This is handled internally by the `./tui` subpath — ensure you are on v1.0.0+.

---

## Contributing

Contributions follow the [SDD (Spec-Driven Development)](../../openspec/) workflow:

1. Open a discussion or issue describing the change.
2. Write or update specs in `openspec/changes/<change-name>/`.
3. Follow RED → GREEN → REFACTOR (strict TDD; `pnpm -r run test` must stay green).
4. Submit a PR referencing the openspec change.

See `openspec/changes/opencode-plan-review-live-control/` for an example of the full artifact trail.

---

## Migration from v0.x

See [docs/migration-v0.1-to-v1.0.md](../../docs/migration-v0.1-to-v1.0.md) for the full upgrade guide.

---

## License

MIT — see [LICENSE](../../LICENSE).
