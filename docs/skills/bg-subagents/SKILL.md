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

# bg-subagents

Background vs foreground subagent execution — PolicyResolver drives the default per agent from `policy.jsonc`, with optional TUI visibility.

## OpenCode

Full usage guide for `@maicolextic/bg-subagents-opencode` v1.0.

### Install

**Step 1 — install the package:**

```bash
npm install @maicolextic/bg-subagents-opencode
# or
pnpm add @maicolextic/bg-subagents-opencode
```

**Step 2 — wire the server plugin into `~/.config/opencode/opencode.json`:**

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"]
}
```

**Step 3 — configure routing in `~/.config/bg-subagents/policy.jsonc`:**

```jsonc
{
  "default_mode_by_agent_name": {
    "sdd-explore": "background",
    "sdd-apply": "foreground",
    "sdd-verify": "foreground"
  }
}
```

**Step 4 (optional) — wire the TUI plugin into `~/.config/opencode/tui.json`** (requires OpenCode 1.14.23+):

```json
{
  "plugin": [
    {
      "module": "@maicolextic/bg-subagents-opencode/tui"
    }
  ]
}
```

The TUI plugin adds the task sidebar and Ctrl+B/Ctrl+F/↓ keybinds. Routing is already handled server-side; do not assume a runtime picker/dialog unless that path is separately verified.

### How it works

When OpenCode runs a multi-agent turn (one or more `task` calls), the `experimental.chat.messages.transform` hook intercepts the message batch before it is sent to the LLM:

1. **PolicyResolver** maps each agent name to a mode (`background` / `foreground`) using `~/.config/bg-subagents/policy.jsonc` and `default_mode_by_agent_name`.
2. **Foreground** agents: call passes through unchanged — blocks the main conversation until complete.
3. **Background** agents: call is rewritten to `task_bg`, which returns `{ task_id, status: "running" }` immediately — the main conversation continues unblocked.
4. `/task policy bg|fg|default` is intercepted by `chat.message`, updates the session `TaskPolicyStore`, and affects later `messages.transform` routing.
5. Completion is delivered via `client.session.message.create` (primary path), with a 2000 ms ack-timeout fallback.

### Configuration reference

Routing config lives in `~/.config/bg-subagents/policy.jsonc`.

```jsonc
{
  "default_mode_by_agent_name": {
    "<agent_name>": "background" | "foreground"
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `default_mode_by_agent_name` | `Record<string, "background" \| "foreground">` | policy default | Per-agent default mode. Agent name is matched exactly. Legacy `bg`/`fg` values are accepted and normalized. |

`bgSubagents.policy` is historical/compatibility wording, not the verified happy-path config source.

### `/task` command reference

All commands are intercepted server-side — no TUI plugin required.

#### `/task policy <mode>`

Override the PolicyResolver for the current session.

| Mode | Effect |
|------|--------|
| `bg` | Force all agents to background for this session |
| `fg` | Force all agents to foreground for this session |
| `default` | Clear the session override; per-agent config resumes |

#### Read commands

| Command | Description |
|---------|-------------|
| `/task list` | List all tasks (running + historical). |
| `/task show <id>` | Full detail for a single task. |
| `/task logs <id>` | JSONL log lines for a task. |
| `/task kill <id>` | Abort a running task immediately. |
| `/task move-bg <id>` | Move a running foreground task to the background. |

### TUI keybinds

Available when the TUI plugin is loaded via `tui.json`.

| Keybind | Action |
|---------|--------|
| `Ctrl+B` | Focus the most recent background task |
| `Ctrl+F` | Focus the most recent foreground task |
| `↓` (down arrow) | Open the task management panel |

The sidebar slot shows a live list of background tasks (status, agent name, elapsed time) with a 1000 ms polling interval.

### Observability

| Resource | Path |
|----------|------|
| Log file (POSIX) | `~/.opencode/logs/bg-subagents.log` |
| Log file (Windows) | `%APPDATA%\opencode\logs\bg-subagents.log` |
| Override log path | `BG_SUBAGENTS_LOG_FILE` env var |

**Zero stdout guarantee**: the plugin is completely silent to the TUI during normal operation. All diagnostic output routes to the log file. Set `BG_SUBAGENTS_DEBUG=true` to additionally mirror logs to stderr (useful for troubleshooting).

In-session commands surface the live registry — no external log viewer needed for basic task inspection.

---

## Claude Code (v0.2 — coming soon)

> **Status**: planned. Track progress at [github.com/Maicololiveras/bg-subagents](https://github.com/Maicololiveras/bg-subagents).

---

## MCP (v0.3 — coming soon)

> **Status**: planned. Track progress at [github.com/Maicololiveras/bg-subagents](https://github.com/Maicololiveras/bg-subagents).
