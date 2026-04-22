# bg-subagents

Background vs foreground subagent execution — user picks per invocation, policy drives the default.

## OpenCode

Full usage guide for the shipped v0.1 adapter (`@maicolextic/bg-subagents-opencode`).

### Install

```bash
pnpm add @maicolextic/bg-subagents-opencode
# or
npm install @maicolextic/bg-subagents-opencode
```

Wire the plugin into `~/.config/opencode/config.json`:

```json
{
  "plugins": [
    "@maicolextic/bg-subagents-opencode"
  ]
}
```

The plugin auto-registers on session start. No further setup is required.

### How it works

When OpenCode is about to call `task` for a subagent, the `tool.execute.before` hook fires:

1. Policy is resolved for the agent name/type combination.
2. If the resolved mode is `foreground` → call passes through unchanged.
3. If the resolved mode is `background` or `ask` → the interactive picker appears:

```
Run "subagent:researcher" in:
> background
  foreground
[2s timeout → foreground]
```

4. **Background** selection rewrites the call to `task_bg`, which returns `{ task_id, status: "running" }` immediately — your conversation continues unblocked.
5. **Foreground** selection passes the call through unchanged.
6. **Esc / cancel** → task is rejected; no fiber is spawned.

Completion is delivered via the `bg-subagents/task-complete` bus event, or — after a 250 ms ack-timeout — via a synthetic assistant message prefixed with `[tsk_<id> ✓]`.

### Policy configuration

Create `~/.config/bg-subagents/policy.jsonc` to set per-agent defaults so the picker pre-selects the right mode or skips it entirely:

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",

  // Always background the "researcher" agent without asking
  "default_mode_by_agent_name": {
    "researcher": "background",
    "code-reviewer": "ask"
  },

  // Default for any agent of type "subagent"
  "default_mode_by_agent_type": {
    "subagent": "ask"
  },

  // Global fallback when no name/type rule matches
  "global_default_mode": "ask",

  // Picker timeout in ms (default: 2000)
  "timeout_ms": 3000
}
```

If `policy.jsonc` is absent, the global default is `ask` — the picker always appears.

### `/task` command reference

#### Subcommands

| Command | Description |
|---------|-------------|
| `/task list` | List all tasks (running + historical). |
| `/task show <id>` | Full detail for a single task. |
| `/task kill <id>` | Abort a running task immediately. |
| `/task logs <id>` | Stream JSONL log lines for a task. |

#### Flags

| Flag | Applies to | Description |
|------|------------|-------------|
| `--status=<value>` | `list` | Filter by status: `running`, `completed`, `error`, `killed`, `cancelled`. |
| `--agent=<name>` | `list` | Substring match on the spawning-agent name. |
| `--since=<value>` | `list` | Tasks started after an ISO-8601 date or duration (`1h`, `30m`, `7d`). |
| `--tail=<N>` | `logs` | Show last N lines only. |
| `--no-color` | all | Suppress ANSI color output. |

### System-prompt steering

The plugin also injects an appendix into the chat system prompt to guide the model toward using `task_bg` when appropriate. No manual configuration is needed — it is wired automatically by the `chat.params` hook.

If you want to tune the steering copy, override the `system_prompt_appendix` field in `policy.jsonc`:

```jsonc
{
  "system_prompt_appendix": "When spawning long-running research tasks, prefer task_bg over task."
}
```

### Observability

- **History log**: `~/.config/bg-subagents/history.jsonl` — one JSON line per task event (queued, running, completed, error, killed).
- **Rotation**: rotated at 10 MB → gzipped as `history.jsonl.<timestamp>.gz`; files older than 30 days are swept automatically.
- **Commands**: `/task list|show|kill|logs` surface the live registry and history in-session.

---

## Claude Code (v0.2 — coming soon)

> **Status**: planned. ETA TBD. Track progress at [github.com/Maicololiveras/bg-subagents](https://github.com/Maicololiveras/bg-subagents).

The v0.2 adapter will ship as a Claude Code marketplace plugin distributed under the `@maicolextic/bg-subagents-claude-code` package.

Key differences from the OpenCode adapter:

- Uses the Claude Code **PreToolUse** hook (`plugin/hooks/hooks.json`) rather than OpenCode's `tool.execute.before`.
- Ships a **pure ESM `.mjs` bundle** — no unbundled imports, compatible with Claude Code's plugin loader.
- Includes an **agent-pairing generator**: `/bg-subagents pair <dir>` reads a source agent markdown file and emits `<name>-bg.md` + `<name>-fg.md` into `agents/_generated/`, enabling the `-bg` / `-fg` naming convention.
- Feature-detects the Claude Code runtime version to pick the best background invocation strategy (native field → subagent-type swap → prompt injection).

Install and wiring instructions will be published here when v0.2 ships.

---

## MCP (v0.3 — coming soon)

> **Status**: planned. ETA TBD. Track progress at [github.com/Maicololiveras/bg-subagents](https://github.com/Maicololiveras/bg-subagents).

The v0.3 adapter exposes a standalone **MCP server binary** (`bg-subagents-mcp`) that any MCP-compatible host can connect to.

Exposed MCP tools:

| Tool | Description |
|------|-------------|
| `task_spawn` | Spawn a background task; returns `{ task_id }` immediately. |
| `task_status` | Poll status, partial result, and progress for a task. |
| `task_result` | Block until the task reaches a terminal state and return the full result. |
| `task_kill` | Abort a running task and return `{ cancelled: true }`. |

Grace-period reconnect: if the MCP client disconnects, the server waits 60 seconds (configurable via `policy.jsonc` under `mcp.grace_period_ms`) before killing running tasks. Reconnecting within the window resumes the session without data loss.

Install and wiring instructions will be published here when v0.3 ships.

---

## Policy schema

Full schema reference: [https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json](https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json)

Human-readable documentation: [docs/policy-schema.md](../../docs/policy-schema.md)

Minimal working example:

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",
  "global_default_mode": "ask",
  "timeout_ms": 2000
}
```

All fields are optional. Omitting the file entirely uses the built-in defaults (`global_default_mode: "ask"`, `timeout_ms: 2000`).

---

## Observability

| Resource | Path |
|----------|------|
| History log | `~/.config/bg-subagents/history.jsonl` |
| Rotated archives | `~/.config/bg-subagents/history.jsonl.<timestamp>.gz` |
| Per-task logs | `~/.config/bg-subagents/logs/<task_id>.jsonl` |

In-session commands:

```
/task list              # all tasks, all statuses
/task list --status=running
/task show tsk_abc12345
/task kill tsk_abc12345
/task logs tsk_abc12345 --tail=50
```

Log level is controlled by the `BG_SUBAGENTS_LOG` environment variable (`error`, `warn`, `info`, `debug`). Default: `warn`.
