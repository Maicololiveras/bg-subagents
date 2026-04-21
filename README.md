# bg-subagents

[![CI](https://github.com/Maicololiveras/bg-subagents/actions/workflows/ci.yml/badge.svg)](https://github.com/Maicololiveras/bg-subagents/actions/workflows/ci.yml)
[![Compat](https://github.com/Maicololiveras/bg-subagents/actions/workflows/compat.yml/badge.svg)](https://github.com/Maicololiveras/bg-subagents/actions/workflows/compat.yml)
[![npm](https://img.shields.io/npm/v/@maicolextic/bg-subagents-opencode)](https://www.npmjs.com/package/@maicolextic/bg-subagents-opencode)

Per-invocation background subagent execution for AI coding hosts.

Normal OpenCode subagents block the main conversation until they finish. `bg-subagents` intercepts every `task` call, prompts you to choose between running it in the foreground (default) or background, and — if you choose background — forks the subagent via the new `task_bg` tool. The main conversation continues immediately; completion is delivered back as a bus event (or a synthetic assistant message if the bus is unavailable).

## Status

**OpenCode adapter v0.1.0 — LIVE on npm.**

```
@maicolextic/bg-subagents-protocol  1.0.0
@maicolextic/bg-subagents-core      0.1.0
@maicolextic/bg-subagents-opencode  0.1.0
```

Claude Code adapter (v0.2) and MCP adapter (v0.3) are on the roadmap — not shipped yet.

## Install

```bash
# pnpm
pnpm add @maicolextic/bg-subagents-opencode

# npm
npm install @maicolextic/bg-subagents-opencode

# yarn
yarn add @maicolextic/bg-subagents-opencode
```

### Wire into OpenCode config

In your `~/.config/opencode/config.json` (or project-local `.opencode/config.json`):

```json
{
  "plugins": [
    "@maicolextic/bg-subagents-opencode"
  ]
}
```

OpenCode will call `(await import("@maicolextic/bg-subagents-opencode")).default.server(ctx)` at session start and register the returned hooks automatically.

## Quickstart

Once the plugin is registered, no additional code is needed. Every `task` call goes through the picker:

```
You: research the public API of stripe/stripe-node and summarize rate-limit strategies

OpenCode (before spawning the subagent):
  Run "subagent:researcher" in:
  > background  ← forks immediately, you keep chatting
    foreground  ← blocks until done (default OpenCode behavior)
  [2s timeout → foreground]
```

If you press Enter or select **background**, the subagent is spawned as a `task_bg` call and returns a `task_id` immediately. You'll receive a notification when it finishes.

You can also call `task_bg` directly in your prompts:

```
You: task_bg subagent_type=researcher prompt="audit src/ for N+1 queries"
→ { "task_id": "tsk_a1b2c3d4", "status": "running" }
```

## `/task` command reference

Use `/task` slash-commands to inspect and manage background tasks:

### Subcommands

| Command | Description |
|---------|-------------|
| `/task list` | List all tasks (running + history). |
| `/task show <id>` | Show full detail for a specific task. |
| `/task kill <id>` | Send an abort signal to a running task. |
| `/task logs <id>` | Stream the JSONL log lines for a task. |

### Flags

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--status=<value>` | `list` | Filter by status. Values: `running`, `completed`, `killed`, `killed_on_disconnect`, `error`, `cancelled`, `passthrough`, `rejected_limit`. |
| `--agent=<name>` | `list` | Filter by spawning-agent name (case-insensitive substring match). |
| `--since=<value>` | `list` | Filter to tasks started on or after a timestamp. Accepts ISO-8601 (`2025-04-01T00:00:00Z`) or duration shorthands (`1h`, `30m`, `7d`, `60s`). |
| `--tail=<N>` | `logs` | Show only the last N log lines. |
| `--no-color` | all | Suppress ANSI color codes (useful for piping). |

### Examples

```
/task list --status=running
/task list --agent=researcher --since=1h
/task logs tsk_a1b2c3d4 --tail=50
/task kill tsk_a1b2c3d4
```

## Policy JSONC sample

Create `~/.config/bg-subagents/policy.jsonc` to customize behavior:

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",

  // Per-name override — highest precedence
  "default_mode_by_agent_name": {
    "researcher": "background",
    "reviewer":   "ask"
  },

  // Per-type default — middle precedence
  "default_mode_by_agent_type": {
    "subagent": "ask",
    "tool":     "foreground"
  },

  // Picker timeout in ms (default: 2000). 0 = no timeout.
  "timeout_ms": 3000,

  // RESERVED in v0.1 — activated in v0.2/v0.3
  "security": {
    "max_concurrent_bg_tasks": 4,
    "timeout_per_task_ms": 300000,
    "blocked_tools_in_bg": ["bash", "write_file"]
  },

  // History rotation
  "history": {
    "rotation_size_mb": 20,
    "retention_days": 14
  },

  // Telemetry (off by default)
  "telemetry": {
    "enabled": false
  }
}
```

See [docs/policy-schema.md](docs/policy-schema.md) for the full field reference.

## Troubleshooting

**No picker appears when a `task` is invoked.**
The picker requires a TTY. In headless environments (CI, piped shells) the picker auto-skips and uses the policy default. Check `default_mode_by_agent_type` in your policy file to control the fallback.

**Protocol version mismatch warning on startup.**
Your installed `@maicolextic/bg-subagents-protocol` and the OpenCode adapter use different MAJOR versions. A MAJOR mismatch is a hard error; a MINOR mismatch is a warning. Run `pnpm update @maicolextic/bg-subagents-opencode` to align.

**`task_bg` tool does not appear in the model's context.**
The `chat.params` hook only injects the tool description if the plugin booted successfully for the current session. Check the OpenCode plugin log for `plugin:booted` or look for boot errors. Ensure the plugin is listed in `config.json` `plugins` array.

**Picker shows but selection times out and falls back to foreground.**
The default picker timeout is 2000 ms. Increase `timeout_ms` in `policy.jsonc`, or set it to `0` to disable the timeout entirely.

**Where are the task logs stored?**
JSONL logs live at `~/.local/share/bg-subagents/history/` (Linux/Mac) or `%APPDATA%\bg-subagents\history\` (Windows). Files rotate at 10 MB by default and are retained for 30 days.

## Roadmap

**v0.2 — Claude Code adapter.** Hooks into the Claude Code plugin surface; same picker + invoker stack, same `/task` commands. Protocol stays 1.x; `security.limits` enforcement activates.

**v0.3 — MCP adapter.** Exposes `task_bg` as a native MCP tool, enabling background subagents from any MCP-compatible host. `mcp.grace_period_ms` activates.

## Contributing

Contributions are welcome on the `main` branch. Run `pnpm test` and `pnpm -r typecheck` before submitting a PR. See [docs/architecture.md](docs/architecture.md) for the design overview and [docs/release-process.md](docs/release-process.md) for how changesets and publish work.

## License

MIT. See [LICENSE](LICENSE).
