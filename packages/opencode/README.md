# @maicolextic/bg-subagents-opencode

OpenCode plugin adapter for bg-subagents. Intercepts every `task` call, prompts a picker (background vs foreground), and forks background tasks via the new `task_bg` tool — without blocking your main conversation.

**Audience:** OpenCode end-users who want background subagent execution.

## Install

```bash
pnpm add @maicolextic/bg-subagents-opencode
```

Wire into `~/.config/opencode/config.json`:

```json
{
  "plugins": [
    "@maicolextic/bg-subagents-opencode"
  ]
}
```

That's it. The plugin auto-registers on session start.

## How it works

When OpenCode is about to call `task` for a subagent:

1. The `tool.execute.before` hook fires.
2. Policy is resolved for that agent name/type.
3. If mode is `foreground` → pass through unchanged.
4. If mode is `background` or `ask` → the picker appears:
   ```
   Run "subagent:researcher" in:
   > background
     foreground
   [2s timeout → foreground]
   ```
5. Background selection swaps the call to `task_bg`, which returns `{ task_id, status: "running" }` immediately.
6. Completion is delivered via a bus event (`bg-subagents/task-complete`) or, after a 2000 ms ack-timeout, via a synthetic assistant message.

## `/task` command reference

### Subcommands

| Command | Description |
|---------|-------------|
| `/task list` | List all tasks (active + history). |
| `/task show <id>` | Full detail for a task. |
| `/task kill <id>` | Abort a running task. |
| `/task logs <id>` | Stream JSONL log lines. |

### Flags

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--status=<value>` | `list` | Filter by status (`running`, `completed`, `killed`, `error`, …). |
| `--agent=<name>` | `list` | Substring match on spawning-agent name. |
| `--since=<value>` | `list` | Tasks started after an ISO-8601 date or duration (`1h`, `30m`, `7d`). |
| `--tail=<N>` | `logs` | Last N lines only. |
| `--no-color` | all | Suppress ANSI colors. |

## Policy

Create `~/.config/bg-subagents/policy.jsonc` to customize the picker default:

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",
  "default_mode_by_agent_name": { "researcher": "background" },
  "default_mode_by_agent_type": { "subagent": "ask" },
  "timeout_ms": 3000
}
```

See [docs/policy-schema.md](../../docs/policy-schema.md) for every field.

## Full documentation

The [root README](../../README.md) covers installation, quickstart, the full `/task` reference, policy sample, troubleshooting, and roadmap.

## License

MIT.
