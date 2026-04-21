# Policy Schema Reference

The bg-subagents policy file lives at `~/.config/bg-subagents/policy.jsonc` (JSONC = JSON with comments).

The canonical JSON Schema is published at:
```
https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json
```

Add `"$schema"` to your file for editor autocompletion.

---

## Minimal policy

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",
  "default_mode_by_agent_type": {
    "subagent": "background"
  }
}
```

All other fields use built-in defaults (shown below).

---

## Full policy with every field

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",

  "default_mode_by_agent_name": {
    "researcher": "background",
    "reviewer":   "ask",
    "deployer":   "foreground"
  },

  "default_mode_by_agent_type": {
    "subagent": "ask",
    "tool":     "foreground"
  },

  "timeout_ms": 3000,

  "security": {
    "max_concurrent_bg_tasks": 4,
    "timeout_per_task_ms": 300000,
    "blocked_tools_in_bg": ["bash", "write_file"]
  },

  "history": {
    "rotation_size_mb": 20,
    "retention_days": 14
  },

  "telemetry": {
    "enabled": false
  }
}
```

---

## Field reference

### `default_mode_by_agent_name`

**Type:** `Record<string, "background" | "foreground" | "ask">`
**Default:** `{}` (no per-name overrides)
**Precedence:** highest — wins over type and global defaults.

Maps a specific agent name (the `subagent_type` value the model passes to the `task` tool) to a fixed mode. The picker still fires for `"ask"` entries; `"background"` and `"foreground"` bypass the picker entirely.

### `default_mode_by_agent_type`

**Type:** `Record<string, "background" | "foreground" | "ask">`
**Default:** `{}`
**Precedence:** middle — overrides global default, loses to per-name.

Maps a broad agent type identifier to a mode. Use this when you have several agents of the same category (e.g. all `"subagent"` type) that share a common routing preference.

### `timeout_ms`

**Type:** `integer >= 0`
**Default:** `2000`

Milliseconds the picker waits for user input before applying the `defaultMode` and continuing. Set to `0` to disable the timeout (picker waits indefinitely). This is a per-session global — not configurable per agent.

---

## `security` block (RESERVED in v0.1 — activates in v0.2/v0.3)

The fields are parsed and validated in v0.1 but have no runtime effect. They will be enforced starting in v0.2 (Claude Code adapter).

### `security.max_concurrent_bg_tasks`

**Type:** `integer > 0`
**Default:** unlimited (no field present)

Maximum number of tasks that can be in `running` status simultaneously. Calls beyond the limit receive status `rejected_limit` immediately without spawning.

### `security.timeout_per_task_ms`

**Type:** `integer > 0`
**Default:** unlimited

Maximum wall-clock time a background task may run before receiving an abort signal. Complements per-task promise timeouts.

### `security.blocked_tools_in_bg`

**Type:** `string[]`
**Default:** `[]`

List of tool names that background tasks are not allowed to call. Requests to these tools return a `BgLimitError`. Useful for restricting destructive operations in unattended background runs.

---

## `history` block

### `history.rotation_size_mb`

**Type:** `number > 0`
**Default:** `10`

The JSONL history file is gzip-rotated when it reaches this size in megabytes. Rotated files follow the naming convention `history.<timestamp>.jsonl.gz`.

### `history.retention_days`

**Type:** `integer > 0`
**Default:** `30`

Rotated history files older than this many days are deleted on the next rotation event.

---

## `telemetry` block

### `telemetry.enabled`

**Type:** `boolean`
**Default:** `false`

Reserved for future structured telemetry. Has no effect in v0.1.

---

## Precedence summary

```
default_mode_by_agent_name   (highest)
  └─ default_mode_by_agent_type
       └─ global default: "ask"  (lowest)
```

When no policy file exists or the file is unreadable, all three levels fall through to the hardcoded default: `"ask"` with a 2000 ms picker timeout.
