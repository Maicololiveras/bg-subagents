# Proposal: OpenCode Plan Review + Live Control (v1.0 refactor)

## Intent

The `@maicolextic/bg-subagents-opencode@0.1.x` plugin was built against OpenCode's legacy plugin API (~1.10) and is **non-functional on OpenCode 1.14.20+** — hooks don't fire because signatures changed. Users who install `v0.1.4` on modern OpenCode get silent failure: `plugin:booted` appears in logs, `task_bg` registers with a mangled name (`functions.0`), but `tool.execute.before` is never invoked and the picker never shows.

Additionally, **the per-call picker UX is suboptimal**: asking the user to decide foreground vs background on every single `task` delegation interrupts flow. A smarter model reviews the **whole plan** up front when multiple subagents will run in one turn, lets the user choose modes in a single confirm, and adds **live control** during execution (move a foreground task to background on the fly).

This change:
1. **Restores functionality** on OpenCode 1.14+ while preserving the legacy codepath.
2. **Redesigns the UX** from per-call interception to **Plan Review** (batch picker) + **Live Control** (in-execution move-to-bg).
3. Ships as `v1.0.0` of `@maicolextic/bg-subagents-opencode` (major bump — breaking API realignment) with `v0.1.x` deprecated on npm.

## Scope

### In Scope

- **Dual-mode host compatibility**: runtime detection of OpenCode plugin API shape (`ctx.bus` + `ctx.session` = legacy; `ctx.client: OpencodeClient` = 1.14+), branching to version-specific hook implementations.
- **Plan Review implementation** (OpenCode 1.14+): intercept via `experimental.chat.messages.transform`, detect batch of `task` tool calls in one LLM turn, present multi-choice UI (per-agent BG/FG/Skip) with keyboard shortcuts `[A]ll BG`, `[N]ormal`, `[Enter]`. Apply user's decisions by rewriting message parts (swap `task` → `task_bg` for BG entries).
- **Plan Review fallback** (legacy): keep current per-call picker as-is for legacy API users.
- **TUI plugin module** (OpenCode 1.14+): `{tui: TuiPlugin}` export alongside `{server: Plugin}`. Registers:
  - Keybind `Ctrl+B` → "move current foreground task to background" (cancels + re-spawns via `task_bg`, with clear user confirmation about lost progress).
  - Slash commands: `/task list`, `/task show <id>`, `/task logs <id> [--tail=N]`, `/task kill <id>`, `/task move-bg <id>`.
  - Sidebar slot (optional) showing active BG tasks.
- **Completion delivery via `client.session.message`** (OpenCode 1.14+): replace `ctx.bus.emit` with `OpencodeClient` session writes for task-complete events.
- **Docs update**: `packages/opencode/README.md` fix (`plugins` → `plugin`, new install/config instructions), `docs/architecture.md` updated component diagram, `docs/upstream/gentle-ai-pr.md` refined with demo references.
- **Tests**: unit + integration coverage for both compat paths. Mock OpenCode 1.14+ ctx shape in vitest. Keep existing 432 tests green.
- **Migration guide** (`docs/migration-v0.1-to-v1.0.md`): for existing users on v0.1.x, what changes, how to upgrade.
- **npm deprecation** of `v0.1.0–v0.1.4` with message pointing to `v1.0.0`.
- **PR upstream** to `Gentleman-Programming/gentle-ai` with demo capture once functional end-to-end.

### Out of Scope

- **Claude Code adapter** (v0.2 roadmap — was Batch 13-17 in the old plan, deferred).
- **MCP adapter** (v0.3 roadmap).
- **Policy file JSONC hot-reload** — defer to v1.1; current behavior (load on session start) is fine.
- **Task persistence across OpenCode restarts** — tasks die with the session. History via `HistoryStore` is unchanged.
- **Multi-user / remote tasks** — single-user local only.
- **Task scheduling** (cron-like) — out of scope.
- **Resurrecting a foreground task's partial progress when moving to BG** — not technically feasible, cancel+restart is the only path.

## Approach

**Approach 1 from exploration: Dual-mode plugin via runtime version detection.**

### Package topology (unchanged)

Three packages (`protocol`, `core`, `opencode`) remain as today. Core domain (`TaskRegistry`, `PolicyResolver`, `Picker`, `StrategyChain`) is shared across both compat paths. Only `packages/opencode/` gets the compat layer.

### Code organization

```
packages/opencode/src/
├── plugin.ts                   # entry — exports {default: {server, tui}}
├── host-compat/
│   ├── version-detect.ts       # inspects ctx shape, returns "legacy" | "v14"
│   ├── legacy/                 # current code (moved, minor refactor)
│   │   ├── index.ts            # builds legacy Hooks
│   │   ├── tool-register.ts
│   │   ├── tool-before.ts
│   │   ├── chat-params.ts
│   │   ├── event.ts
│   │   └── chat-message-fallback.ts
│   └── v14/                    # new OpenCode 1.14+ code
│       ├── index.ts            # builds v14 Hooks
│       ├── tool-register.ts    # Zod schemas, {[key]: ToolDefinition}
│       ├── messages-transform.ts  # Plan Review interception
│       ├── system-transform.ts    # replaces chat-params for system injection
│       ├── event.ts               # typed Event union handler
│       └── delivery.ts            # client.session.message writes
├── plan-review/
│   ├── batch-detector.ts       # identifies task-call batches in a message
│   ├── plan-decision.ts        # state machine for user's per-agent choices
│   └── picker-ui.ts            # clack fallback for headless contexts
├── tui-plugin/                 # OpenCode 1.14+ TUI plugin
│   ├── index.ts                # TuiPlugin entry
│   ├── live-control.ts         # Ctrl+B handler + confirmation dialog
│   ├── plan-review-dialog.ts   # ui.DialogSelect implementation
│   └── commands.ts             # /task slash commands
├── runtime.ts                  # runOpenCodeSubagent (shared)
├── strategies/
│   └── OpenCodeTaskSwapStrategy.ts  # shared
└── types.ts                    # shared types
```

### Runtime flow (OpenCode 1.14+)

```
1. plugin.server(input: PluginInput) called
   └─ version-detect → "v14"
   └─ build v14 Hooks:
      ├─ tool: { task_bg: ToolDefinition (Zod) }
      ├─ experimental.chat.messages.transform: Plan Review interceptor
      ├─ experimental.chat.system.transform: inject task_bg advertisement
      ├─ tool.execute.after: delivery hook for completion events
      └─ event: read-only Event union handler

2. User sends prompt → LLM responds with N tool calls including M task() calls
3. experimental.chat.messages.transform fires:
   ├─ batch-detector scans parts → finds M task calls
   ├─ If M >= 1: show Plan Review picker (via TUI DialogSelect OR clack fallback)
   ├─ User chooses mode per task (BG/FG/Skip) with keyboard shortcuts
   └─ Rewrite message parts: BG entries swap tool_name: task → task_bg
4. OpenCode executes the rewritten tool calls
5. task_bg runs its subagents via runOpenCodeSubagent → TaskRegistry → HistoryStore
6. Completion: client.session.message.create injects assistant message OR TaskRegistry emits to subscribed consumers

During execution (Live Control, TUI plugin only):
7. User presses Ctrl+B → dialog: "move running task <id> to background? (loses progress)"
8. On confirm: client.tool.cancel(callID) + client.session.message.send with task_bg invocation
9. TaskRegistry transitions task state: running(fg) → cancelled → re-spawn(bg)
```

### Runtime flow (legacy)

Unchanged from v0.1.4 — per-call picker via `tool.execute.before` with `{continue, replacement}` swap. Keeps existing v0.1.x users functional.

### Decision table (resolved from exploration)

| Decision | Choice | Rationale |
|---|---|---|
| Approach (compat model) | **Dual-mode (Approach 1)** | User explicitly required multi-version support |
| Plan Review hook | **`experimental.chat.messages.transform` (primary) + `tool.execute.before` batching fallback** | Cleaner UX; batching fallback gives resilience if experimental hook unstable |
| TUI plugin scope | **Include in v1.0** | User wants Live Control "para poder seguir trabajando normal" |
| Version bump | **v1.0.0 (major)** | Breaking: new API shape, new UX, deprecates legacy installs. Honest versioning. |
| v0.1.x deprecation | **Yes, after v1.0 ships** | `npm deprecate '@maicolextic/bg-subagents-opencode@0.1' "use >=1.0"` |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/opencode/src/plugin.ts` | Modified | Entry point routes to compat layer, exports both `server` and `tui` |
| `packages/opencode/src/types.ts` | Modified | Add v14 API mirror types alongside legacy |
| `packages/opencode/src/host-compat/` | New | Version detection + per-version hook builders |
| `packages/opencode/src/host-compat/legacy/` | Moved | Current `hooks/*.ts` moves here, minor refactor |
| `packages/opencode/src/host-compat/v14/` | New | OpenCode 1.14+ implementations |
| `packages/opencode/src/plan-review/` | New | Batch detection + picker UI |
| `packages/opencode/src/tui-plugin/` | New | TUI plugin module (1.14+ only) |
| `packages/opencode/src/hooks/` | Removed | Content moved to `host-compat/legacy/` |
| `packages/opencode/package.json` | Modified | Version bump to 1.0.0, new `exports` for `./tui` subpath, peer deps |
| `packages/opencode/README.md` | Modified | Fix `plugins` → `plugin`, new install/config, UX docs |
| `packages/opencode/src/__tests__/` | New tests | Coverage for host-compat (both paths), plan-review, tui-plugin |
| `docs/architecture.md` | Modified | Updated component diagram with version branch |
| `docs/upstream/gentle-ai-pr.md` | Modified | Refined with demo references, v1.0 features |
| `docs/migration-v0.1-to-v1.0.md` | New | User-facing migration guide |
| `packages/core/` | Potentially modified | May need new interfaces for plan-review state; minimize changes |
| `packages/protocol/` | No change expected | Protocol stable at v1.0.0 |
| `.changeset/` | New changeset | Major bump on opencode, patch on core if needed |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `experimental.chat.messages.transform` has unknown semantics or is removed | Medium | Ship with `tool.execute.before` batching fallback. Feature-flag the primary path. Monitor OpenCode releases. |
| Zod 3 (ours) vs Zod 4-beta (OpenCode) conflict at tool-register | Medium | Inspect `@opencode-ai/plugin` peer-dep range. If strict, publish dual-zod adapter or use compat shim. |
| `client.tool.cancel(callID)` may not exist in OpenCode 1.14 API | Medium | Verify against `OpencodeClient` type. If missing, use `client.session.abort()` or TUI-level interrupt. |
| Moving FG → BG loses progress, confusing users | High (UX) | Clear confirmation dialog + docs. Refuse move-bg on tools marked non-idempotent (future enhancement). |
| Breaking changes confuse existing v0.1.x users | High | `npm deprecate` with clear message. Migration guide. README front-matter banner. |
| TUI plugin bundle size (heavy `@opentui/*` deps) | Low | Split to `@maicolextic/bg-subagents-opencode/tui` entrypoint; lazy-loaded. |
| Test coverage for OpenCode 1.14 is hard (TUI binary) | High | Extensive ctx mocking in vitest. Manual E2E before release. Consider minimal integration test harness using `opencode run` headless mode. |
| Version detection heuristic misfires on future OpenCode API | Low | Double-check with `client.app.version()` if available. Add feature flag `BG_SUBAGENTS_FORCE_COMPAT=legacy\|v14`. |
| PR upstream to Gentleman rejected or requires changes | Low (friendly) | Keep PR scope minimal: just reference v1.0 in his repo's docs/agents list. Don't require upstream changes in his code. |

## Rollback Plan

**If v1.0.0 ships and breaks for users:**

1. **Immediate mitigation**: `npm deprecate '@maicolextic/bg-subagents-opencode@1.0.0' "see issue #<n>"`. Users can pin to `v0.1.4` (still on npm, not deleted).
2. **Revert**: git revert the major refactor PR(s), cherry-pick any non-compat-related fixes back, ship `v1.0.1` as the old behavior if urgent.
3. **Forward fix preference**: normally we'd forward-fix rather than revert, given the whole plugin was broken on 1.14+ before this change.

**If a specific compat path breaks:**

- Legacy path regression → `npm deprecate '1.x' "regressed for legacy, use v0.1.4"` + patch release.
- v14 path regression → same pattern.

**State preservation during rollback:**

- `openspec/changes/opencode-plan-review-live-control/` stays in the repo as audit trail.
- Engram observations preserved (never delete).
- User's local `~/.config/bg-subagents/policy.jsonc` is unchanged (we don't write it).
- User's `~/.local/share/bg-subagents/history/` is unchanged (JSONL history preserved).

## Dependencies

- **OpenCode plugin API** — `@opencode-ai/plugin@1.14.20` for types. Pin exactly or use `>=1.14 <2` peer range.
- **Zod** — keep `zod@3.25.76` for protocol; may need `zod@4-beta` compat layer for v14 ToolDefinition (TBD in design).
- **Vitest** — already present for testing; new integration tests may need `@opencode-ai/sdk` mocks.
- **Changesets** — already set up; major bump changeset file.
- **CI/OIDC Trusted Publishing** — validated today; v1.0 release uses the same flow.
- **@opentui/core** + **@opentui/solid** — peer deps of `@opencode-ai/plugin` for TUI module. Verify these are resolved via OpenCode itself at runtime, not bundled in our package.

## Success Criteria

- [ ] `@maicolextic/bg-subagents-opencode@1.0.0` published to npm with provenance (OIDC Trusted Publishing validated)
- [ ] Plugin loads cleanly in OpenCode 1.14.21 (verified via log: no `bus-events:no-bus` warning, hook signatures match)
- [ ] In a fresh OpenCode session, delegating to 2+ subagents via `sdd-orchestrator` triggers the **Plan Review picker** with per-agent BG/FG choice
- [ ] User selects BG for an agent → that agent spawns via `task_bg`, main conversation doesn't block
- [ ] User selects FG for an agent → that agent runs traditionally (no disruption)
- [ ] `/task list` (slash command) shows all running BG tasks
- [ ] Pressing `Ctrl+B` during a FG task → dialog "move to background? (loses progress)" → confirm → task cancels + re-spawns in BG
- [ ] Legacy OpenCode (< 1.14) users on v1.0.0 still get the per-call picker (graceful backward compat)
- [ ] Existing 432 vitest tests stay green; new tests added for host-compat + plan-review with ≥80% coverage
- [ ] `v0.1.x` deprecated on npm with clear migration message
- [ ] PR to `Gentleman-Programming/gentle-ai` submitted with demo and functional validation
- [ ] README + SKILL.md + architecture docs updated; zero mentions of the old `"plugins"` field (now `"plugin"`)

## Next Step

Ready for `sdd-spec` (write delta specs per package) or direct to `sdd-design` (technical design with sequence diagrams). In automatic mode, orchestrator proceeds to `sdd-spec` next.
