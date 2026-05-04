# Phase 11 Spike TQ-1 — TUI plugin runtime verification

Resolves the runtime half of open question TQ-1 (type-level GO already in
`docs/opencode-1.14-verification.md`).

## Hypothesis under test

1. **Declaring** a TUI plugin in `opencode.json`'s `plugin` array loads it
   correctly (unlike dropping it into `~/.config/opencode/plugins/`, which
   crashed with `TypeError: undefined is not an object (evaluating 'f.auth')`
   in the previous attempt).
2. The TUI plugin shares the Node/Bun process with the server plugin (same
   PID) — enabling module-level singleton sharing between `server` and
   `tui` exports of the same package.

## How to run

```bash
cd C:/SDK/bg-subagents/scripts/spike-tq1-tui
opencode debug config --print-logs --log-level=DEBUG
```

Then, in a second terminal (or after reading the debug output), run the
real TUI:

```bash
cd C:/SDK/bg-subagents/scripts/spike-tq1-tui
opencode
```

Expected visual signal on success: a toast `"bg-subagents TUI spike
Loaded. pid=... token=..."` appears at boot.

Copy the full stdout back here.

## Expected outcomes

### ✅ GO — spike loads cleanly

```
[SPIKE-TQ1-TUI] MODULE-LOAD pid=XXXX token=YYYY-ZZZZ
[SPIKE-TQ1-TUI] shared-state pre-boot: none
[SPIKE-TQ1-TUI] BOOT pid=XXXX token=YYYY-ZZZZ meta.id=... meta.state=first meta.source=... meta.spec=...
[SPIKE-TQ1-TUI] shared-state on-boot: {"source":"tui","pid":XXXX,"token":"YYYY-ZZZZ",...}
```

**Follow-up** (step 2 of TQ-1): also enable the existing server dev shim
(`~/.config/opencode/plugins/bg-subagents.ts`) and add a matching
`Symbol.for` write from the server side. Re-run. If both entries log the
**same PID**, server↔tui shared-state via module-level `globalThis` is
viable — pick Plan B #1/#2 from `verification.md`.

### ❌ Crash `TypeError: undefined is not an object (evaluating 'f.auth')`

Hypothesis #1 failed — the loader does not differentiate TUI vs server by
shape when declared in `opencode.json` either. Next step: probe
`TuiPluginApi.plugins.add(spec)` runtime API from within a server-side
plugin boot path.

### ❌ `Plugin export is not a function`

The loader rejected the object-shaped default export. Means TUI plugins
need a different declaration mechanism (likely the SDK's
`TuiConfigView.plugin` / `plugin_enabled` fields — requires further
investigation of the SDK config schema).

### ❌ Silent no-op (no MODULE-LOAD line)

The plugin path was not resolved. Try absolute `file:///` URL instead
of relative `./spike-tui.ts` in `opencode.json`.

## Cleanup

```bash
rm -rf C:/SDK/bg-subagents/scripts/spike-tq1-tui
```

(Or keep it and commit if the outcome is GO — it becomes part of the
verification history.)
