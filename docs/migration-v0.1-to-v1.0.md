# Migration Guide: v0.x → v1.0.0

`@maicolextic/bg-subagents-opencode` v1.0.0 is a complete rewrite of the v0.x experimental adapter. This guide covers what changed, what broke, and how to upgrade.

---

## What Changed

**v0.x was experimental.** It relied on `tool.execute.before` hooks, required a manual interactive picker on every subagent call, and had no policy configuration. It was never formally published to npm.

**v1.0.0 is production-ready.** It targets OpenCode 1.14.22+ (v14 hook shapes), uses `messages.transform` interception for the primary path, drives per-agent defaults via `PolicyResolver`, ships a full set of `/task` slash commands, and adds an optional TUI layer with sidebar + keybinds.

---

## Breaking Changes

### 1. Config file: `config.json` → `opencode.json`

v0.x documentation referenced `~/.config/opencode/config.json`. The correct path (and what OpenCode itself uses) is `~/.config/opencode/opencode.json`.

**Before (v0.x):**
```json
// ~/.config/opencode/config.json
{
  "plugins": ["@maicolextic/bg-subagents-opencode"]
}
```

**After (v1.0):**
```json
// ~/.config/opencode/opencode.json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"],
  "bgSubagents": {
    "policy": {
      "*": "background"
    }
  }
}
```

### 2. `plugins` (plural) → `plugin` (singular)

OpenCode uses `"plugin"` (singular, array) as the key. Using `"plugins"` silently does nothing.

### 3. No interactive picker

v0.x showed an interactive picker prompt on every `task` call asking `background / foreground`. This is gone in v1.0.

In v1.0, policy is resolved silently via `bgSubagents.policy` in `opencode.json`. The picker is replaced by:
- **PolicyResolver** (silent, per-agent config)
- **`/task policy bg|fg|default`** (session-scoped override)
- **TUI plan-review dialog** (optional, per-turn interactive override via `tui.json`)

### 4. Policy configuration location changed

v0.x used `~/.config/bg-subagents/policy.jsonc` as a separate file.

v1.0 uses the `bgSubagents.policy` key directly in `opencode.json`. The separate `policy.jsonc` file is no longer read.

**Before (v0.x):**
```jsonc
// ~/.config/bg-subagents/policy.jsonc
{
  "default_mode_by_agent_name": { "researcher": "background" },
  "timeout_ms": 3000
}
```

**After (v1.0):**
```json
// ~/.config/opencode/opencode.json
{
  "bgSubagents": {
    "policy": {
      "researcher": "background",
      "*":          "foreground"
    }
  }
}
```

Note: `timeout_ms` is removed from user config. Delivery ack timeout is fixed at 2000 ms internally.

### 5. Requires OpenCode 1.14.22+

v0.x used legacy hook shapes (`tool.execute.before`, `chat.params`, bus events). v1.0 uses v14 hook shapes (`experimental.chat.messages.transform`, `experimental.chat.system.transform`, `event`). OpenCode versions before 1.14.22 are not compatible with v1.0.

Run `opencode --version` to confirm. If you are on an older version, upgrade OpenCode first.

### 6. Log path changed

v0.x logged to `~/.config/bg-subagents/history.jsonl`.

v1.0 logs to `~/.opencode/logs/bg-subagents.log` (POSIX) or `%APPDATA%\opencode\logs\bg-subagents.log` (Windows). The old history file is not migrated — it can be deleted safely.

---

## Upgrade Steps

### 1. Update the package

```bash
npm install @maicolextic/bg-subagents-opencode@^1.0.0
# or
pnpm add @maicolextic/bg-subagents-opencode@^1.0.0
```

### 2. Update `opencode.json`

Replace your old plugin config:

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"],
  "bgSubagents": {
    "policy": {
      "sdd-explore":  "background",
      "sdd-apply":    "foreground",
      "*":            "background"
    }
  }
}
```

Adjust the policy keys to match your agent names. The `"*"` wildcard is the fallback for any agent not explicitly listed.

### 3. Remove the old policy file (optional)

```bash
rm ~/.config/bg-subagents/policy.jsonc
```

The old file is ignored by v1.0.

### 4. (Optional) Add TUI plugin

If you want the sidebar, keybinds, and plan-review dialog, create `~/.config/opencode/tui.json`:

```json
{
  "plugin": [
    {
      "module": "@maicolextic/bg-subagents-opencode/tui"
    }
  ]
}
```

Requires OpenCode 1.14.23+.

### 5. Verify

Start OpenCode and run:

```
/task list
```

If the command is recognized and returns output (even empty), the plugin loaded correctly.

---

## New Features in v1.0

See [packages/opencode/README.md](../packages/opencode/README.md) for the full reference. Highlights:

- **PolicyResolver** — per-agent BG/FG defaults in `opencode.json`, no picker required
- **`/task policy`** — session-scoped override (bg / fg / default)
- **`/task move-bg <id>`** — move a running foreground task to background mid-execution
- **TUI sidebar** — live task list via `tui.json` (optional)
- **`Ctrl+B` / `Ctrl+F` / `↓`** — keyboard navigation for task management
- **Plan-review dialog** — interactive per-task BG/FG override via TUI (optional)
- **Zero stdout pollution** — no raw JSON or event dumps in the TUI, ever
- **788 tests green** — full monorepo coverage across protocol + core + opencode packages

---

## Rollback

If you need to roll back to a v0.x build (not recommended — v0.x is not published to npm and was experimental):

1. Remove the `@maicolextic/bg-subagents-opencode` package.
2. Restore the old `config.json` with `"plugins"` key.
3. Restore `~/.config/bg-subagents/policy.jsonc` if you had one.

v0.x is not compatible with OpenCode 1.14.22+. If you are on a recent OpenCode, v0.x will not work correctly.

---

## Getting Help

- GitHub Issues: [github.com/Maicololiveras/bg-subagents/issues](https://github.com/Maicololiveras/bg-subagents/issues)
- Log file: `~/.opencode/logs/bg-subagents.log` — first place to check if something is wrong
- Set `BG_SUBAGENTS_DEBUG=true` for verbose output to stderr
