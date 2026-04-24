# Upstream issue: public TUI plugin loader for OpenCode

**Target repo**: https://github.com/anomalyco/opencode
**Filed by**: bg-subagents maintainer (@maicolextic)
**Status**: draft — NOT yet submitted

**Related open issues** (reference, do not duplicate):
- #20504 — [FEATURE]: Additional TUI Slots for Plugins (slots surface, not loader)
- #17492 — [FEATURE]: Plugin API for TUI customization (customization request, not loader)

Neither of those addresses the loader gap — they assume TUI plugins can already be declared
externally, which they cannot as of 1.14.22.

---

## Title (suggested)

`[FEATURE]: Allow external TUI plugins to be declared in opencode.json (plugin loader rejects TuiPluginModule shape)`

---

## Body

### Summary

The `@opencode-ai/plugin` SDK (v1.14.20+) exports a `./tui` subpath with complete types
for `TuiPlugin`, `TuiPluginApi`, `TuiPluginMeta`, `TuiPluginModule`, and `TuiCommand`. The
types are well-designed and cover the use cases third-party plugin authors need (slots,
keybinds, dialogs, toasts, sidebar panels).

However, the plugin loader in OpenCode 1.14.22 **rejects any module whose default export
matches `TuiPluginModule` shape** with an explicit error:

```
Plugin <path> must default export an object with server() failed to load plugin
```

There is no external configuration mechanism — in `opencode.json` or otherwise — that routes
a `{ tui: fn }` default export to the TUI runtime instead of the server runtime. The `./tui`
subpath exists at the type level, but has no runtime loading path for third-party code.

We hit this while building `@maicolextic/bg-subagents-opencode` and spent a Phase 11 spike
confirming it is a hard blocker, not a configuration mistake. We are requesting a minimal
loader extension that makes `TuiPluginModule` externally loadable.

---

### Current state (evidence)

**SDK types confirm the intended shape exists:**

- `@opencode-ai/plugin@1.14.20` ships `package.json` exports with a `./tui` subpath pointing
  to `dist/tui.js` / `dist/tui.d.ts`.
- `TuiPluginModule` is typed as `{ tui: TuiPlugin; server?: never }` — explicitly mutually
  exclusive with `PluginModule` (`{ server: Plugin; tui?: never }`).
- `TuiPlugin` is typed as `(api: TuiPluginApi, options: unknown, meta: TuiPluginMeta) => Promise<void>`.

**Runtime spike (OpenCode 1.14.22, 2026-04-24):**

Spike script: `scripts/spike-tq1-tui/spike-tui.ts` in the bg-subagents workspace.
Config used: `opencode.json` with `{ "plugin": ["./spike-tui.ts"] }` in the spike directory.
Run command: `opencode debug config --print-logs --log-level=DEBUG`

The spike exports exactly what the SDK type requires:

```typescript
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";

const Tui = async (api: TuiPluginApi, _options: unknown, meta: TuiPluginMeta) => {
  api.ui.toast({ variant: "info", title: "bg-subagents TUI spike", message: "Loaded." });
};

export default { tui: Tui };
```

**Observed log output:**

```
[SPIKE-TQ1-TUI] MODULE-LOAD pid=5732 token=1777033046126-depw49sq
[SPIKE-TQ1-TUI] shared-state pre-boot: none
ERROR service=plugin path=file:///.../spike-tui.ts error=Plugin file:///.../spike-tui.ts must default export an object with server() failed to load plugin
```

The module **was** resolved and transpiled by Bun (the MODULE-LOAD console.log fired at the
top of the file). The loader then inspected the default export, found `{ tui: fn }` instead of
`{ server: fn }` or a bare function, and rejected it with the `"must default export an object with server()"` error.

**Auto-discovery dir also fails:**

Dropping a `{ tui: fn }` file into `~/.config/opencode/plugins/` crashes at boot with:

```
TypeError: undefined is not an object (evaluating 'f.auth')
```

The crash happens because the auto-discovery loader invokes every found module with the server
plugin signature and attempts to access `.auth` on the return value. A TUI plugin function
returns `void`, so `f.auth` is `undefined`.

**Conclusion:** Both the `opencode.json plugin` array and the `~/.config/opencode/plugins/`
auto-discovery dir share the same loader, and that loader enforces server-plugin shape only.
There is no public path to register an external TUI plugin in 1.14.22.

---

### Use case

**v1.0 (ships today — server-side only):**
`@maicolextic/bg-subagents-opencode` delivers background sub-agent orchestration
(delegation, task tracking, completion policy) entirely from the server plugin surface. This
works fine in 1.14.22 via `server()`, `session.chat.params`, `tool.execute.before`, and
message transforms. No TUI required.

**v1.1 (blocked on this issue):**

We want to add a UI layer that makes background task management visible inside the TUI:

| Feature | API used | Status |
|---------|----------|--------|
| Live sidebar: background task list | `TuiPluginApi.slots.register` | Blocked |
| Keybind `Ctrl+B` to focus BG task panel | `TuiCommand.keybind` | Blocked |
| Modal dialog: task logs, actions | `api.ui.DialogSelect` | Blocked |
| Slash commands registered via TUI surface | `api.command.register` | Blocked |

All four are directly available in the SDK types today — they are just unreachable because
there is no way to load the plugin that would call them.

---

### Proposal (minimal API — two options)

#### Option 1 (preferred): shape-based routing in the existing loader

Extend the existing `plugin` array loader in `opencode.json` to inspect the default export
shape and route accordingly:

- `typeof default === "function"` → server plugin (existing behavior, unchanged)
- `typeof default.server === "function"` → server plugin (existing behavior, unchanged)
- `typeof default.tui === "function" && default.server == null` → TUI plugin (new routing)

No new config key. No breaking change. Existing plugins are entirely unaffected. The loader
already has the shape detection logic to emit the `"must default export an object with server()"` error — it knows the shapes are different. This option just adds the TUI branch instead of hard-failing.

#### Option 2: separate `tui.plugins` key in `opencode.json`

Add a `tui.plugins` array (analogous to the top-level `plugin` array) that is processed
exclusively by the TUI runtime:

```jsonc
// opencode.json
{
  "plugin": ["./my-server-plugin.ts"],
  "tui": {
    "plugins": ["./my-tui-plugin.ts"]
  }
}
```

This is simpler to implement in isolation (no shape detection needed). The `tui` key already
exists in the SDK `Config` schema for TUI-specific settings (`scroll_speed`,
`scroll_acceleration`, `diff_style` — see `@opencode-ai/sdk/dist/gen/types.gen.d.ts` lines
1033–1051). A `tui.plugins` array under the same key is a natural extension that does NOT
conflict with any existing SDK field. Slightly more config surface than Option 1, but
unambiguous about intent.

**Either option unblocks the ecosystem.** Option 1 is preferred because it requires no new
config schema and keeps the developer experience of declaring all plugins in one array.

---

### Ecosystem impact

- **One concrete consumer ready to use this:** `@maicolextic/bg-subagents-opencode` v1.1 —
  fully designed, TUI plugin code drafted against the existing types, waiting only on a
  loadable surface to ship.
- **Likely other consumers:** any plugin that wants to add UI to OpenCode — status panels,
  live visualizers, session pickers, custom modals. The existing issues #20504 and #17492
  show there is organic demand for this. Both were filed by users who assumed TUI plugins
  were externally loadable; they are requesting _more_ slots, not the loader itself.

---

### Backward compatibility

Both options are **purely additive**:

- The existing server plugin loader behavior is unchanged.
- The auto-discovery dir behavior is unchanged.
- Existing `opencode.json` configs with no `tui` key or no TUI-shaped entries are unaffected.
- Existing server plugins with `{ server: fn }` exports continue to load exactly as before.

No deprecation, no migration, no flag day.

---

### Willing to help

Happy to:
- Test a PR implementing either option against our spike scenario
  (`scripts/spike-tq1-tui/spike-tui.ts` + `scripts/spike-tq1-tui/opencode.json`).
- Provide a minimal reproduction repo if that is more convenient than the workspace reference.
- Draft a PR for Option 1 or Option 2 if the maintainers indicate which direction they prefer.

Contact: @maicolextic
