# Installation

Three installation paths depending on your environment.

---

## 1. Direct via npm (recommended for developers)

**Step 1 — install the package:**

```bash
# npm
npm install @maicolextic/bg-subagents-opencode

# pnpm
pnpm add @maicolextic/bg-subagents-opencode
```

**Step 2 — wire the server plugin** into `~/.config/opencode/opencode.json` (or a project-local `opencode.json`):

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

> Important: use `"plugin"` (singular, array) — not `"plugins"`. OpenCode silently ignores the plural key.

**Step 3 (optional) — wire the TUI plugin** into `~/.config/opencode/tui.json` (requires OpenCode 1.14.23+):

```json
{
  "plugin": [
    {
      "module": "@maicolextic/bg-subagents-opencode/tui"
    }
  ]
}
```

The TUI plugin adds the task sidebar, `Ctrl+B` / `Ctrl+F` / `↓` keybinds, and the interactive plan-review dialog. The server plugin works independently without it.

**Step 4 — verify:**

Start OpenCode and run:

```
/task list
```

If the command is recognized and returns output (even empty), the plugin loaded correctly.

---

## 2. Via gentle-ai (recommended for Gentleman-Programming stack users)

> **Status (2026-04-24)**: issue #373 filed at [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai/issues/373), awaiting `status:approved` from the maintainer. The automated install path is not yet available.

Once approved and the PR is merged, installation will be:

```bash
gentle-ai install
# → select OpenCode → select bg-subagents
# → gentle-ai copies the skill doc and wires the plugin automatically
```

Until then, use the direct npm path (option 1 above).

For full details on the gentle-ai integration — what changes in their repo, the MCP auto-wiring plan, and the current PR status — see [docs/integrations/gentle-ai.md](integrations/gentle-ai.md).

---

## 3. Local development (for contributors)

**Step 1 — clone the repo:**

```bash
git clone https://github.com/Maicololiveras/bg-subagents.git
cd bg-subagents
```

**Step 2 — install dependencies:**

```bash
pnpm install
```

**Step 3 — build the packages:**

```bash
pnpm -r run build
```

**Step 4 — link locally** so OpenCode can pick up the package:

```bash
cd packages/opencode
npm link
# in your OpenCode project:
npm link @maicolextic/bg-subagents-opencode
```

**Step 5 — run tests** before making changes:

```bash
pnpm -r run test
pnpm -r run typecheck
```

See [packages/opencode/README.md](../packages/opencode/README.md) for the full architecture overview. See [Contributing](../packages/opencode/README.md#contributing) for the SDD workflow used in this repo.

---

## Verification

After any install path, confirm the plugin loaded:

1. Start OpenCode.
2. Run `/task list` in the chat — if the command is recognized (any output, including empty), the server plugin is loaded.
3. Check the log file for a `plugin:booted` entry:
   - POSIX: `~/.opencode/logs/bg-subagents.log`
   - Windows: `%APPDATA%\opencode\logs\bg-subagents.log`
4. To enable verbose output for troubleshooting: set `BG_SUBAGENTS_DEBUG=true` before starting OpenCode.

---

## Troubleshooting

**`/task` commands not recognized**
- Confirm `"plugin"` (singular) is in `opencode.json`, not `"plugins"` (plural).
- Confirm the package is installed: `node_modules/@maicolextic/bg-subagents-opencode/` must exist.

**TUI sidebar not showing / keybinds not working**
- Confirm `tui.json` is at `~/.config/opencode/tui.json`, not merged into `opencode.json`.
- Confirm OpenCode version is 1.14.23+ (`opencode --version`).

**Raw JSON appearing in the TUI**
- Unset `BG_SUBAGENTS_DEBUG` and restart OpenCode.
- Confirm you are on v1.0.0+ (`npm list @maicolextic/bg-subagents-opencode`).

**Protocol version mismatch warning**
- Run `npm install @maicolextic/bg-subagents-opencode@^1.0.0` to align all packages.

---

## Upgrading from v0.1

See [docs/migration-v0.1-to-v1.0.md](migration-v0.1-to-v1.0.md) for the complete upgrade guide, including the config key rename (`plugins` → `plugin`), policy file location change, and new TUI setup.
