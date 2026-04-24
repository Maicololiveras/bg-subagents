# OpenCode Upstream Contribution Plan

**Date**: 2026-04-24
**Research session**: Retry of token-limited run. All 4 questions answered definitively.
**Status**: Complete — all engram topics saved, plan finalized.

---

## 1. Executive Summary

Research confirms that the TUI plugin loading mechanism for external plugins is **fully implemented** in OpenCode as of commit "tui plugins (#19347)" on 2026-03-27 (present in release 1.14.22+). The mechanism uses a separate `tui.json` config file with a `plugin` array — analogous to `opencode.json`'s `plugin` array for server plugins. Our Phase 11 spike failed because we configured the TUI plugin in `opencode.json` (the server plugin config file) instead of `tui.json`. The error `"must default export an object with server()"` is correct behavior — the server loader rejects TUI-shaped exports on purpose.

The loader gap described in `opencode-tui-loader-issue.md` is **not a loader bug**. The diagnosis was based on an incorrect assumption: that `opencode.json` is the only config entry point. The proposed fix (Option 1: shape-based routing in opencode.json, Option 2: `tui.plugins` nested key) is unnecessary because Option 2 already exists as a separate file. The issue draft should NOT be filed as-is.

The real upstream gap is documentation: the public plugin docs (`packages/web/src/content/docs/plugins.mdx`) do not mention `tui.json`, how it is loaded, or how to configure TUI plugins from external packages. This is a tractable contribution: a docs PR covering TUI plugin quickstart is ~50 lines of markdown and positions us well with maintainers.

---

## 2. Repo Architecture Findings (Q1)

**Repository**: `https://github.com/anomalyco/opencode` (org: anomalyco, formerly sst)
**Stars**: 148,859 | **Forks**: 17,064 | **License**: MIT
**Primary language**: TypeScript (100%)
**Default branch**: `dev` (not `main` — this matters for PRs and raw file URLs)

### Top-level structure

```
packages/           # Turborepo monorepo
  opencode/         # Core CLI and TUI — primary package
  plugin/           # @opencode-ai/plugin SDK (exported to npm)
  sdk/              # @opencode-ai/sdk
  ui/               # Shared UI components
  web/              # Documentation site (Astro/MDX)
  shared/           # Shared utilities
  desktop/          # Electron desktop app
  enterprise/       # Enterprise features
  app/              # (other)
.github/            # CI workflows
script/             # Repo-level scripts
specs/              # (top-level specs dir referenced in some packages)
bun.lock            # Bun lockfile
turbo.json          # Turborepo config
tsconfig.json       # Root TS config
sst.config.ts       # SST infra config
```

### Test infrastructure

- **Runner**: Bun (`bun test`)
- **Timeout**: 30 seconds per test
- **CI mode**: JUnit XML output to `.artifacts/unit/junit.xml`
- **Commands**: `bun test --timeout 30000` (local), `bun test:ci` (CI)
- **Test location**: `packages/opencode/test/` — extensive TUI plugin tests exist at `test/cli/tui/`
- **No Vitest**, **no Jest**, **no separate test framework** — pure Bun test

### Plugin system architecture (key insight)

Two separate config files, two separate loaders:

| Config file | Plugin array | Loader kind | Target |
|-------------|-------------|-------------|--------|
| `opencode.json` | `plugin: [...]` | `"server"` | `packages/opencode/src/plugin/index.ts` |
| `tui.json` | `plugin: [...]` | `"tui"` | `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts` |

The shared loader infrastructure (`PluginLoader.loadExternal` in `packages/opencode/src/plugin/loader.ts`) handles both — the `kind` parameter is what controls server vs TUI entrypoint resolution.

---

## 3. Loader Insertion Point (Q2)

### The error we saw — and why it was correct

File: `packages/opencode/src/plugin/shared.ts`
Function: `readV1Plugin(mod, spec, kind, mode)`

```typescript
// packages/opencode/src/plugin/shared.ts — readV1Plugin()
export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,           // "server" | "tui"
  mode: PluginMode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)  // ← generic
  }

  const server = "server" in value ? value.server : undefined
  const tui    = "tui"    in value ? value.tui    : undefined

  // ... validation omitted for brevity

  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)   // ← THE error we saw
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}
```

When we called `PluginLoader.loadExternal({ kind: "server" })` (via `opencode.json`), the server loader received our `{ tui: fn }` module, called `readV1Plugin(mod, spec, "server")`, and threw because `server === undefined`. This is correct behavior — `opencode.json` is for server plugins only.

### The TUI loader path (already works)

File: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
Function: `resolveExternalPlugins()`

```typescript
// packages/opencode/src/cli/cmd/tui/plugin/runtime.ts
async function resolveExternalPlugins(list: ConfigPlugin.Origin[], wait: () => Promise<void>) {
  return PluginLoader.loadExternal({
    items: list,
    kind: "tui",           // ← passes "tui" to the shared loader
    wait: async () => { ... },
    finish: async (loaded, origin, retry) => {
      // calls readV1Plugin(loaded.mod, loaded.spec, "tui")
      // accepts { tui: fn } shape — no error
      ...
    },
    missing: async (loaded, origin, retry) => { ... },
    report: { ... },
  })
}
```

File: `packages/opencode/src/cli/cmd/tui/config/tui.ts`
Loads `tui.json` from (in order): global config dir → OPENCODE_TUI_CONFIG env var → project root files → `.opencode` dirs

### Working configuration example (from the repo itself)

File: `.opencode/tui.json` (in the opencode repo)

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "./plugins/tui-smoke.tsx",
      {
        "enabled": false,
        "label": "workspace",
        "keybinds": {
          "modal": "ctrl+alt+m",
          "screen": "ctrl+alt+o"
        }
      }
    ]
  ]
}
```

### What our spike should have used

```jsonc
// scripts/spike-tq1-tui/tui.json  ← NEW FILE (not opencode.json!)
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./spike-tui.ts"]
}
```

### Entrypoint resolution for npm packages

For npm packages, the loader reads `package.json` exports and looks for a `./tui` subpath:

```typescript
// packages/opencode/src/plugin/shared.ts — resolvePackageEntrypoint()
function resolvePackageEntrypoint(spec: string, kind: PluginKind, pkg: PluginPackage) {
  const exports = pkg.json.exports
  if (isRecord(exports)) {
    const raw = extractExportValue(exports[`./${kind}`])  // exports["./tui"]
    if (raw) return resolvePackagePath(spec, raw, kind, pkg)
  }
  // Falls back to `main` only for kind === "server"
  if (kind !== "server") return
  ...
}
```

This means our `@maicolextic/bg-subagents-opencode` package needs:

```jsonc
// packages/opencode/package.json (bg-subagents plugin package)
{
  "exports": {
    ".": "./dist/index.js",
    "./tui": "./dist/tui.js"     // ← required for npm TUI plugin loading
  }
}
```

### Option 1 and Option 2 status (from original issue draft)

| Option | Status | Notes |
|--------|--------|-------|
| Option 1: shape-based routing in opencode.json | Not implemented, not needed | Would create ambiguity since server+TUI are intentionally separate |
| Option 2: separate `tui.plugins` key in opencode.json | Effectively implemented as a separate `tui.json` file | Functionally equivalent, cleaner separation |

---

## 4. Porting Path (Q3)

### Language match

Both OpenCode and bg-subagents are TypeScript/Bun. **Port is clean — no language mismatch, zero porting complexity.**

### bg-subagents files by destination

#### Server-side (already working, no changes needed for TUI)

| bg-subagents file | Role | OpenCode target |
|-------------------|------|-----------------|
| `host-compat/v14/messages-transform.ts` | Message transforms | `packages/opencode/test/fixture/` (already test fixture) |
| `host-compat/v14/event-handler.ts` | Event handling | Server plugin hooks |
| `host-compat/v14/slash-commands.ts` | Slash command registration | Server plugin hooks |
| `host-compat/v14/delivery.ts` | Delivery logic | Internal server use |
| `host-compat/v14/tool-register.ts` | Tool registration | Server plugin hooks |
| `plan-review/rewrite-parts.ts` | Plan transforms | Server plugin hooks |
| `strategies/OpenCodeTaskSwapStrategy.ts` | Task swap logic | Server plugin hooks |

#### TUI-side (new, needed for v1.1)

These files do not exist yet and need to be created in bg-subagents, not ported TO OpenCode:

| New file to create | Location | Purpose |
|--------------------|----------|---------|
| `tui/index.ts` | `packages/opencode/src/` (bg-subagents plugin) | TUI plugin entry, exports `{ tui: BgSubagentsTuiPlugin }` |
| `tui/bg-panel.tsx` | same | SolidJS component, registers via `api.slots.register` for `sidebar_content` slot |
| `tui/commands.ts` | same | Registers `Ctrl+B` keybind and palette commands via `api.command.register` |
| `tui/task-dialog.tsx` | same | Modal for task log inspection via `api.ui.DialogSelect` |
| `tui/state.ts` | same | Reads bg task state, subscribes to `api.event` for live updates |

#### Configuration (needed in workspace)

```jsonc
// .opencode/tui.json (or project tui.json)
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@maicolextic/bg-subagents-opencode"]
}
```

#### Package manifest update

```jsonc
// packages/opencode/package.json (bg-subagents plugin)
{
  "exports": {
    ".":     { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./tui": { "import": "./dist/tui/index.js", "types": "./dist/tui/index.d.ts" }
  }
}
```

### Reference implementation examples in OpenCode

- `.opencode/plugins/tui-smoke.tsx` — comprehensive working TUI plugin (9 commands, slots, dialogs, routes, keybinds)
- `packages/opencode/test/fixture/tui-plugin.ts` — minimal test fixture
- `packages/opencode/test/cli/tui/plugin-loader.test.ts` — loader behavior tests
- `packages/opencode/specs/tui-plugins.md` — internal spec (author package shape, manifest fields, API surface)

---

## 5. Timeline (Weeks Estimate)

### Phase A — Verification spike re-run (BEFORE everything else)

**Duration**: 1 day
**Goal**: Confirm that `tui.json` with our existing `spike-tui.ts` works

Actions:
1. Add `scripts/spike-tq1-tui/tui.json` pointing to `spike-tui.ts`
2. Run `opencode debug config --print-logs --log-level=DEBUG` from spike dir
3. Expected: toast appears, no error → confirms the mechanism
4. If it fails: document the specific new error for a targeted bug report

### Phase B — Docs contribution (Week 1-2)

**Duration**: 2-3 days
**Goal**: File issue + draft docs PR

Actions:
1. File issue: "TUI plugin configuration is undocumented — tui.json not mentioned in plugin docs"
2. Draft PR: add TUI plugin section to `packages/web/src/content/docs/plugins.mdx`
   - What tui.json is, where it lives, schema reference
   - Minimal working example (single-file TUI plugin)
   - Package manifest requirements (`./tui` exports)
   - Link to `.opencode/plugins/tui-smoke.tsx` as reference

### Phase C — bg-subagents v1.1 TUI implementation (Week 2-4)

**Duration**: 2-3 weeks
**Goal**: Ship TUI layer for bg-subagents-opencode

Milestones:
- Week 2: `tui/bg-panel.tsx` — sidebar task list (read-only, live updates)
- Week 3: `tui/commands.ts` + keybind, `tui/task-dialog.tsx` — interactive features
- Week 4: Integration testing, package `./tui` export, publish to npm

### Phase D — Post-release (Week 5+)

**Duration**: Ongoing
**Goal**: Any remaining loader gaps → targeted PRs based on actual usage

---

## 6. Top 3 Risks + Mitigations

### Risk 1 — `tui.json` mechanism works in code but not in packaged release

**Probability**: Medium (commit is 4 weeks old, likely in 1.14.22+ but not verified)
**Impact**: High — if tui.json doesn't work in 1.14.22, v1.1 is still blocked
**Mitigation**: Phase A spike re-run is mandatory before any other work. If the mechanism fails in the installed version, file a specific regression report (not the original loader issue).

### Risk 2 — SolidJS rendering context is unavailable to external TUI plugins

**Probability**: Low-Medium (the smoke test works but uses special internal access)
**Impact**: High — sidebar panel requires SolidJS reactive rendering
**Evidence of risk**: `tui-smoke.tsx` uses SolidJS JSX; external plugins need the same runtime context. The `api.slots.register` API accepts a `SolidPlugin` object — if the SolidJS runtime isn't shared correctly with external bundles, components won't render.
**Mitigation**: Test `api.slots.register` with a trivial component first before building the full panel. If it fails, check `@opentui/solid` bundling and whether the package needs to be listed as a peer dependency.

### Risk 3 — Our original issue draft gets filed before verification

**Probability**: Low (this plan prevents it) but worth calling out
**Impact**: Medium — filing incorrect diagnosis harms our credibility with maintainers
**Mitigation**: The `opencode-tui-loader-issue.md` draft MUST NOT be submitted as-is. It contains correct evidence (the error is real) but the root cause and proposed fixes are wrong. The new contribution is a docs PR, not a loader PR.

---

## 7. Recommendation (Q4)

**Choice: (b) MODIFIED — File issue + draft docs PR; do NOT file the original loader PR**

### Justification

The original issue draft (`opencode-tui-loader-issue.md`) was based on an incorrect diagnosis. The TUI plugin loader is fully implemented and works via `tui.json`. Filing the original issue would be factually wrong and waste maintainer time.

The correct upstream contribution is:
1. A **documentation issue** reporting that `tui.json` and the TUI plugin system are not documented in the public plugin docs
2. A **docs PR** adding a TUI plugin section to `plugins.mdx`

This is strictly better than the alternatives:

- **(a) Only file issue, wait passively**: Leaves us in limbo on v1.1, and the original issue was wrong anyway. Rejected.
- **(b original) File loader PR**: The loader is already correct. A PR to "fix" it would be rejected. Rejected.
- **(b modified — this recommendation)**: Docs issue + docs PR. Low effort (no code changes), fast review cycle, builds goodwill. The PR demonstrates that we have a real consumer ready to use the API. **Accepted.**
- **(c) Fork and maintain separately**: Unnecessary — the API exists, works, and is maintained. Last resort only if major breaking changes happen. Rejected.

### Why a docs PR is the right move

1. The OpenCode team is active (releases every day in April 2026)
2. The TUI plugin spec exists at `packages/opencode/specs/tui-plugins.md` — they have the source material
3. Our `tui-smoke.tsx` observation shows they use it internally; external devs just can't discover it
4. A docs PR has a low bar to merge: no runtime risk, no compatibility concerns
5. Once merged, it establishes our name in the contributor list, making future PRs easier to land

---

## 8. Next Steps (Concrete Actions)

### Immediate (today)

1. **Re-run the spike with `tui.json`**
   - Create `scripts/spike-tq1-tui/tui.json` with `{ "plugin": ["./spike-tui.ts"] }`
   - Run `opencode` from that directory and observe if the toast appears
   - Record the exact behavior: success, different error, or crash

2. **Archive the original loader issue draft**
   - Move `docs/upstream/opencode-tui-loader-issue.md` → `docs/upstream/opencode-tui-loader-issue.ARCHIVED.md`
   - Add a note at the top explaining it was based on wrong config (opencode.json vs tui.json)

### Week 1

3. **File the correct issue**
   - Title: `[DOCS]: TUI plugin configuration is not documented — tui.json and ./tui entrypoint not mentioned in plugin docs`
   - Body: Evidence from our spike, reference to `.opencode/tui.json` in the repo, link to the undocumented spec at `packages/opencode/specs/tui-plugins.md`
   - Tag: `documentation`, `plugins`

4. **Draft the docs PR**
   - Fork anomalyco/opencode (base: `dev` branch)
   - Add TUI plugin section to `packages/web/src/content/docs/plugins.mdx`
   - Sections: what is tui.json, config schema, package manifest `./tui` export, quickstart example
   - Reference `.opencode/plugins/tui-smoke.tsx` as a full example

### Week 2-4

5. **Implement bg-subagents v1.1 TUI layer**
   - Add `packages/opencode/src/tui/` directory to bg-subagents plugin package
   - Implement `bg-panel.tsx`, `commands.ts`, `task-dialog.tsx`
   - Add `./tui` to package.json exports
   - Add `tui.json` to workspace `.opencode/`
   - Write integration tests following `test/cli/tui/plugin-loader.test.ts` pattern

6. **Verify against OpenCode latest**
   - Target: OpenCode 1.14.24+ (current latest as of 2026-04-24)
   - Test: `bun test` in `packages/opencode/` to confirm test infra works
   - Confirm: `api.slots.register`, `api.command.register`, `api.ui.toast` all functional from external package

---

## Appendix: Key File Paths

### OpenCode repo (anomalyco/opencode, branch: dev)

| Path | Purpose |
|------|---------|
| `packages/opencode/src/plugin/loader.ts` | Shared plugin loader — `resolve()`, `load()`, `loadExternal()` |
| `packages/opencode/src/plugin/shared.ts` | `readV1Plugin()` — validates export shape by kind |
| `packages/opencode/src/plugin/index.ts` | Server plugin orchestration — calls `loadExternal({ kind: "server" })` |
| `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts` | TUI plugin orchestration — calls `loadExternal({ kind: "tui" })` |
| `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts` | `tui.json` schema — `plugin: Spec[].optional()` |
| `packages/opencode/src/cli/cmd/tui/config/tui.ts` | `tui.json` loading — reads global + project configs |
| `packages/opencode/specs/tui-plugins.md` | Internal TUI plugin spec — API surface, config format |
| `.opencode/tui.json` | Working example of TUI plugin config in the repo |
| `.opencode/plugins/tui-smoke.tsx` | Reference TUI plugin implementation (comprehensive) |
| `packages/opencode/test/fixture/tui-plugin.ts` | Minimal test fixture TUI plugin |
| `packages/opencode/test/cli/tui/plugin-loader.test.ts` | TUI plugin loader tests |
| `packages/web/src/content/docs/plugins.mdx` | Public docs — MISSING tui.json section |

### bg-subagents workspace

| Path | Purpose |
|------|---------|
| `C:/SDK/bg-subagents/docs/upstream/opencode-tui-loader-issue.md` | Original (now incorrect) issue draft — archive it |
| `C:/SDK/bg-subagents/docs/upstream/opencode-contribution-plan.md` | This file |
| `C:/SDK/bg-subagents/packages/opencode/src/` | Plugin source — server side complete |
| `C:/SDK/bg-subagents/packages/opencode/src/__tests__/` | Tests |
| `C:/SDK/bg-subagents/scripts/spike-tq1-tui/spike-tui.ts` | Original spike — valid, needs tui.json alongside it |
| `C:/Users/maicolj/.opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts` | TUI plugin SDK types |
