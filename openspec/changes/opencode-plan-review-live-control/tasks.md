# Tasks: OpenCode Plan Review + Live Control (v1.0)

Strict TDD mode is active (per `openspec/config.yaml`): for every implementation task, a RED task writing a failing test MUST precede the GREEN implementation task. Test command: `pnpm -r run test`.

Each task lists the **exact files** it touches and the **acceptance criteria** mapped to specs.

---

## Phase 1: Verification Spikes (resolve open questions from design)

Resolve the 6 design open questions before heavy refactor. Each spike is a minimal throwaway script; results are documented in `docs/opencode-1.14-verification.md`.

- [ ] 1.1 **Spike: Zod 3 schema acceptance (ZQ-1)**. Create `scripts/spike-zod-tool-register.mjs`. Builds a minimal plugin that registers a `test_tool` with a Zod 3 schema as `args`. Run in user's OpenCode 1.14.21. Document whether the LLM can call it with correct args. (Files: `scripts/spike-zod-tool-register.mjs`, `docs/opencode-1.14-verification.md`)
- [ ] 1.2 **Spike: `experimental.chat.messages.transform` (EQ-1)**. Create `scripts/spike-messages-transform.mjs`. Plugin that logs every `messages.transform` invocation to a file, attempts to add/remove/replace parts, and verifies effect on actual tool execution. (Files: `scripts/spike-messages-transform.mjs`, `docs/opencode-1.14-verification.md`)
- [ ] 1.3 **Spike: `client.session.abort` semantics (SQ-1)**. Create `scripts/spike-session-abort.mjs`. Fires a long-running tool, calls `client.session.abort`, measures whether tool fiber cancels within 3s. (Files: `scripts/spike-session-abort.mjs`, `docs/opencode-1.14-verification.md`)
- [ ] 1.4 **Spike: synthetic tool invocation via `client.session.prompt({noReply: true})` (DQ-1)**. Create `scripts/spike-noreply-prompt.mjs`. Posts a message asking the host to invoke `task_bg` with specific args WITHOUT triggering an LLM turn. (Files: `scripts/spike-noreply-prompt.mjs`, `docs/opencode-1.14-verification.md`)
- [ ] 1.5 **Spike: shared state between main and `/tui` subpath exports (TQ-1)**. Create `scripts/spike-shared-singleton.mjs`. Main module sets a global, `/tui` subpath module reads it. Verify module resolution produces one or two instances. (Files: `scripts/spike-shared-singleton.mjs`, `docs/opencode-1.14-verification.md`)
- [ ] 1.6 **Verification summary**. Consolidate spike results into `docs/opencode-1.14-verification.md` with GO/NO-GO decisions per open question. Update design ADRs in `design.md` with verified facts. If any result is NO-GO, activate the documented Plan B and amend `design.md`. (Files: `docs/opencode-1.14-verification.md`, `openspec/changes/opencode-plan-review-live-control/design.md`)

---

## Phase 2: Structural Foundation (mechanical moves, preserve legacy behavior)

- [ ] 2.1 **Create compat layer directories**. `mkdir -p packages/opencode/src/host-compat/{legacy,v14}`. (Files: new dirs only)
- [ ] 2.2 **Move `hooks/tool-register.ts` → `host-compat/legacy/tool-register.ts`**. `git mv` preserves history. Update all imports in the package to the new path. (Files: `packages/opencode/src/host-compat/legacy/tool-register.ts`, all `*.ts` files importing it)
- [ ] 2.3 **Move `hooks/tool-before.ts` → `host-compat/legacy/tool-before.ts`**. Same as 2.2. (Files: `packages/opencode/src/host-compat/legacy/tool-before.ts` + importers)
- [ ] 2.4 **Move `hooks/chat-params.ts` → `host-compat/legacy/chat-params.ts`**. Same pattern. (Files: `packages/opencode/src/host-compat/legacy/chat-params.ts` + importers)
- [ ] 2.5 **Move `hooks/event.ts` → `host-compat/legacy/event.ts`**. Same pattern. (Files: `packages/opencode/src/host-compat/legacy/event.ts` + importers)
- [ ] 2.6 **Move `hooks/chat-message-fallback.ts` → `host-compat/legacy/chat-message-fallback.ts`**. Same pattern. (Files: `packages/opencode/src/host-compat/legacy/chat-message-fallback.ts` + importers)
- [ ] 2.7 **Move `hooks/task-command.ts` → `host-compat/legacy/task-command.ts`**. Same pattern. (Files: `packages/opencode/src/host-compat/legacy/task-command.ts` + importers)
- [ ] 2.8 **Move existing `__tests__/hooks/*.test.ts` → `__tests__/host-compat/legacy/*.test.ts`**. Update test imports. (Files: all 6 test files in `packages/opencode/src/__tests__/hooks/*`)
- [ ] 2.9 **Delete empty `packages/opencode/src/hooks/` directory**. Run `rm -rf packages/opencode/src/hooks/` + `rm -rf packages/opencode/src/__tests__/hooks/`. (Files: directory removal)
- [ ] 2.10 **Verify all 432 existing tests still pass**. Run `pnpm -r run test`. Zero regressions allowed. (Files: no changes; test run only)
- [ ] 2.11 **Commit checkpoint**. `git commit -m "refactor: move hooks to host-compat/legacy/ without behavior change"`. (Files: commit)

---

## Phase 3: Host Version Detection (foundation for routing)

- [ ] 3.1 **RED: Write `detectHostVersion` unit tests**. Cover: v14 ctx, legacy ctx, unknown ctx, env override (`BG_SUBAGENTS_FORCE_COMPAT=legacy`), env override (`v14`), env override (invalid value ignored), detection <50ms. Based on spec `host-compat/spec.md` scenarios. (Files: `packages/opencode/src/__tests__/host-compat/version-detect.test.ts`)
- [ ] 3.2 **GREEN: Implement `detectHostVersion`**. Create `packages/opencode/src/host-compat/version-detect.ts`. Inspects `ctx.client` (v14), `ctx.bus` + `ctx.session` (legacy). Honors `process.env.BG_SUBAGENTS_FORCE_COMPAT`. Logs warn on invalid value. Export `HostVersion` type. (Files: `packages/opencode/src/host-compat/version-detect.ts`)
- [ ] 3.3 **REFACTOR: Extract shared ctx-field guards**. If repetition emerges, extract helpers. Keep <100 LOC total. (Files: same as 3.2 if applicable)

---

## Phase 4: Legacy Hooks Builder (wrap existing code)

- [ ] 4.1 **RED: Write `buildLegacyHooks` integration test**. Given a mock legacy ctx, assert the returned `Hooks` has: `tool: [taskBg]`, `tool.execute.before: fn`, `chat.params: fn`, `plugin:booted` log emitted. Based on `compat-legacy/spec.md`. (Files: `packages/opencode/src/__tests__/host-compat/legacy/build.test.ts`)
- [ ] 4.2 **GREEN: Create `host-compat/legacy/index.ts` with `buildLegacyHooks`**. Migrates the current `plugin.ts` `buildServer` implementation verbatim. Exports `buildLegacyHooks(ctx, overrides?): Promise<Hooks>`. (Files: `packages/opencode/src/host-compat/legacy/index.ts`)
- [ ] 4.3 **REFACTOR: Update `plugin.ts` to call `buildLegacyHooks` for legacy path**. Entry still works but delegates. (Files: `packages/opencode/src/plugin.ts`)
- [ ] 4.4 **Verify legacy regression suite stays green**. `pnpm -r run test` — 432 tests must pass. (Files: test run)

---

## Phase 5: v14 Tool Registration (Zod schemas)

- [ ] 5.1 **Add `zod-to-json-schema` runtime dep**. `cd packages/opencode && pnpm add zod-to-json-schema@3.x`. Update lockfile. (Files: `packages/opencode/package.json`, `pnpm-lock.yaml`)
- [ ] 5.2 **RED: Write unit tests for v14 `taskBgTool` definition**. Assert shape: `{description: string, args: ZodRawShape, execute: fn}`. Cover: arg parsing (valid subagent_type + prompt), rejection (missing fields), policy_override enum. Based on `host-compat/spec.md` ZQ-1 scenarios. (Files: `packages/opencode/src/__tests__/host-compat/v14/tool-register.test.ts`)
- [ ] 5.3 **GREEN: Implement `host-compat/v14/tool-register.ts`**. Uses Zod 3 raw shape (verified OK in Phase 1.1 spike or adjusted per Plan B). Returns `{description, args, execute}`. The execute function delegates to `TaskRegistry.spawn` same as legacy. (Files: `packages/opencode/src/host-compat/v14/tool-register.ts`)
- [ ] 5.4 **REFACTOR: Extract shared schema source**. `packages/opencode/src/shared/task-bg-schema.ts` with ONE Zod definition; both legacy (via `zod-to-json-schema` conversion) and v14 (direct) consume it. Eliminates duplication. (Files: `packages/opencode/src/shared/task-bg-schema.ts`, update 5.3 and `host-compat/legacy/tool-register.ts`)

---

## Phase 6: v14 Completion Delivery

- [ ] 6.1 **RED: Write unit tests for `DeliveryCoordinator`**. Mock `OpencodeClient`, assert: primary delivery fires `client.session.message.create`, on success `registry.markDelivered` called and fallback timer cancelled, on reject fallback arms, on timeout fallback uses `client.session.prompt({noReply: true})`. Based on `delivery/spec.md` scenarios. (Files: `packages/opencode/src/__tests__/host-compat/v14/delivery.test.ts`)
- [ ] 6.2 **GREEN: Implement `host-compat/v14/delivery.ts`**. Exports `createV14Delivery(opts): DeliveryCoordinator`. Coordinates primary + fallback + dedupe. (Files: `packages/opencode/src/host-compat/v14/delivery.ts`)
- [ ] 6.3 **RED: Write unit tests for `TaskRegistry.markDelivered` dedupe**. Assert adding same id twice returns false; completion delivered exactly once regardless of race. Based on `delivery/spec.md` "Single Delivery Per Task". (Files: `packages/core/src/__tests__/task-registry.test.ts` — new section)
- [ ] 6.4 **GREEN: Add `markDelivered` method to `TaskRegistry`**. Internal `Set<string>`; return `boolean` indicating first delivery. (Files: `packages/core/src/registry/task-registry.ts`)
- [ ] 6.5 **Changeset for core patch bump**. `pnpm changeset` → patch on `@maicolextic/bg-subagents-core` with message "Add markDelivered for delivery dedupe (internal)". (Files: new `.changeset/*.md`)

---

## Phase 7: v14 System + Event Hooks

- [x] 7.1 **RED: Write test for `system-transform` hook (v14 replacement for `chat.params`)**. Assert the `system: string[]` output is appended with task_bg advertisement when `isTaskBgRegistered` is true. (Files: `packages/opencode/src/__tests__/host-compat/v14/system-transform.test.ts`)
- [x] 7.2 **GREEN: Implement `host-compat/v14/system-transform.ts`**. Handler for `experimental.chat.system.transform`. Pushes SYSTEM_ADDENDUM to `output.system` array. (Files: `packages/opencode/src/host-compat/v14/system-transform.ts`)
- [x] 7.3 **RED: Write test for v14 `event` hook**. Assert it logs interesting session lifecycle events (session.idle, session.created, session.compacted, session.error) and ignores noise. Scope-amended post-spike: `tool.execute.after` is a separate Hook surface, not an Event — left to later phase if needed. (Files: `packages/opencode/src/__tests__/host-compat/v14/event-handler.test.ts`)
- [x] 7.4 **GREEN: Implement `host-compat/v14/event-handler.ts`**. Read-only consumer of `input.event: Event` union. (Files: `packages/opencode/src/host-compat/v14/event-handler.ts`)
- [x] 7.5 **Wire Phase 7 hooks into `buildV14Hooks`**. Return `event` and `experimental.chat.system.transform` alongside `tool`. Extend `build.test.ts` with integration coverage. (Files: `packages/opencode/src/host-compat/v14/index.ts`, `packages/opencode/src/__tests__/host-compat/v14/build.test.ts`)

---

## Phase 8: Plan Review Core (shared between v14 and fallback)

- [ ] 8.1 **RED: Write `batch-detector` unit tests**. Table-driven: 0/1/2/3+ task calls, mixed with non-task, re-entry `task_bg` excluded. Based on `plan-review/spec.md` "Batch Detection" scenarios. (Files: `packages/opencode/src/__tests__/plan-review/batch-detector.test.ts`)
- [ ] 8.2 **GREEN: Implement `plan-review/batch-detector.ts`**. `detectBatch(parts: Part[]): BatchEntry[]`. Returns empty if fewer than 2 task calls. (Files: `packages/opencode/src/plan-review/batch-detector.ts`, `packages/opencode/src/plan-review/types.ts`)
- [ ] 8.3 **RED: Write `rewrite-parts` unit tests**. For each decision kind: foreground unchanged, background swapped to task_bg, skip removed. Covers "Mixed BG/FG plan" and "All skipped" scenarios. (Files: `packages/opencode/src/__tests__/plan-review/rewrite-parts.test.ts`)
- [ ] 8.4 **GREEN: Implement `plan-review/rewrite-parts.ts`**. `rewriteParts(parts, decisions): Part[]`. Injects user-notice part when all skipped. (Files: `packages/opencode/src/plan-review/rewrite-parts.ts`)
- [ ] 8.5 **RED: Write `plan-picker` clack fallback unit tests**. Mock clack prompts; assert: 3-entry picker renders with shortcuts, [A] sets all BG, [Enter] confirms, [Esc] returns cancelled, timeout applies defaults. Based on `plan-review/spec.md` "Picker UI Presentation" scenarios. (Files: `packages/opencode/src/__tests__/plan-review/plan-picker-clack.test.ts`)
- [ ] 8.6 **GREEN: Implement `plan-review/plan-picker-clack.ts`**. Clack-based picker implementation for headless/non-TUI contexts. (Files: `packages/opencode/src/plan-review/plan-picker-clack.ts`)
- [ ] 8.7 **RED: Write non-TTY fallback test**. Simulate `process.stdout.isTTY === false`; assert picker returns resolver defaults without prompting. Based on `plan-review/spec.md` "Non-TTY Fallback". (Files: same test file as 8.5 — new case)
- [ ] 8.8 **GREEN: Add TTY check in `plan-picker-clack.ts`**. Early-exit path when non-TTY. (Files: `packages/opencode/src/plan-review/plan-picker-clack.ts`)

---

## Phase 9: v14 Plan Review Implementation

- [ ] 9.1 **RED: Write `messages-transform` integration test**. Mock v14 ctx with `experimental.chat.messages.transform` invocation. Feed 3 task calls. Assert picker invoked with 3 entries, output mutated per user decisions (BG→swap, FG→unchanged, Skip→removed). Based on `plan-review/spec.md` "Message Part Rewriting". (Files: `packages/opencode/src/__tests__/host-compat/v14/messages-transform.test.ts`)
- [ ] 9.2 **GREEN: Implement `host-compat/v14/messages-transform.ts`**. Handler for `experimental.chat.messages.transform`. Calls detectBatch → pickPlan → rewriteParts → mutate output. Uses module-level config for Plan Review enabled flag (per-session toggle from spec). (Files: `packages/opencode/src/host-compat/v14/messages-transform.ts`)
- [ ] 9.3 **RED: Write `batching-fallback` test**. Simulates tool.execute.before with 500ms window batching. Assert picker fires once per batch. (Files: `packages/opencode/src/__tests__/host-compat/v14/batching-fallback.test.ts`)
- [ ] 9.4 **GREEN: Implement `host-compat/v14/batching-fallback.ts`**. Enabled when `BG_SUBAGENTS_PLAN_REVIEW=batching`. Per-session buffer + debounced picker trigger. (Files: `packages/opencode/src/host-compat/v14/batching-fallback.ts`)
- [ ] 9.5 **REFACTOR: Abstract `PlanInterceptor` interface**. Both `messages-transform` and `batching-fallback` implement the same interface; swap via env flag. (Files: `packages/opencode/src/plan-review/types.ts`, update 9.2 and 9.4)

---

## Phase 10: v14 Hooks Builder (wiring everything together)

- [ ] 10.1 **RED: Write `buildV14Hooks` integration test**. Given a mock v14 `PluginInput`, assert the returned `Hooks` has: `tool: {task_bg: ToolDefinition}`, `experimental.chat.messages.transform: fn`, `experimental.chat.system.transform: fn`, `event: fn`, `plugin:booted` log emitted. (Files: `packages/opencode/src/__tests__/host-compat/v14/build.test.ts`)
- [ ] 10.2 **GREEN: Create `host-compat/v14/index.ts` with `buildV14Hooks`**. Wires: `v14/tool-register` + `v14/messages-transform` (or batching-fallback per env) + `v14/system-transform` + `v14/event-handler` + `v14/delivery`. Exports `buildV14Hooks(input, overrides?): Promise<V14Hooks>`. (Files: `packages/opencode/src/host-compat/v14/index.ts`)
- [ ] 10.3 **REFACTOR: Update `plugin.ts` to route via `detectHostVersion`**. If `"v14"` → `buildV14Hooks`. If `"legacy"` → `buildLegacyHooks`. If `"unknown"` → warn + try legacy fallback. (Files: `packages/opencode/src/plugin.ts`)
- [ ] 10.4 **Verify all tests green (both compat paths)**. `pnpm -r run test`. (Files: test run)

---

## Phase 11: TUI Plugin — Shared State

- [ ] 11.1 **RED: Write `SharedPluginState` singleton tests**. Assert: single instance across imports (main + /tui subpath resolve to same Node module cache), `registerFromServer(state)` sets the current, `current()` retrieves it. (Files: `packages/opencode/src/__tests__/tui-plugin/shared-state.test.ts`)
- [ ] 11.2 **GREEN: Implement `tui-plugin/shared-state.ts`**. Module-level variable guarded by a Symbol.for global to survive multiple module resolutions if needed. (Files: `packages/opencode/src/tui-plugin/shared-state.ts`)
- [ ] 11.3 **Integrate: call `SharedPluginState.registerFromServer` from `buildV14Hooks`**. Pass TaskRegistry + PolicyResolver references. (Files: `packages/opencode/src/host-compat/v14/index.ts`)

---

## Phase 12: TUI Plugin — Live Control + Commands

- [ ] 12.1 **RED: Write `plan-review-dialog.test.ts`**. Mock `TuiPluginApi.ui.DialogSelect`; assert dialog renders with N entries, user selection resolves decisions correctly. (Files: `packages/opencode/src/__tests__/tui-plugin/plan-review-dialog.test.ts`)
- [ ] 12.2 **GREEN: Implement `tui-plugin/plan-review-dialog.ts`**. Uses `api.ui.DialogSelect` with multi-select-like ergonomics (cycle through entries). Exports `createTuiPlanPicker(api): PlanPicker`. (Files: `packages/opencode/src/tui-plugin/plan-review-dialog.ts`)
- [ ] 12.3 **RED: Write `live-control.test.ts`**. Mock `TuiPluginApi`; assert: keybind registered at `ctrl+b`, handler shows confirm dialog when FG task present, toast when none, cancel+re-spawn flow on confirm. Based on `live-control/spec.md` scenarios. (Files: `packages/opencode/src/__tests__/tui-plugin/live-control.test.ts`)
- [ ] 12.4 **GREEN: Implement `tui-plugin/live-control.ts`**. Registers keybind. Handler queries `SharedPluginState.current().registry` for running FG tasks. (Files: `packages/opencode/src/tui-plugin/live-control.ts`)
- [ ] 12.5 **RED: Write `commands.test.ts`**. Mock API; assert 5 slash commands registered. Test each: `/task list`, `/task show`, `/task logs`, `/task kill`, `/task move-bg`. Based on `live-control/spec.md` "Slash Command Registration". (Files: `packages/opencode/src/__tests__/tui-plugin/commands.test.ts`)
- [ ] 12.6 **GREEN: Implement `tui-plugin/commands.ts`**. Registers commands via `api.command.register`. Each command shells into `registry`/`historyStore`. (Files: `packages/opencode/src/tui-plugin/commands.ts`)
- [ ] 12.7 **Optional: Implement sidebar slot (`tui-plugin/sidebar.ts`)**. `api.slots.register` with `sidebar_content`. Lists running BG tasks with elapsed time, updates every 1000ms. Toggleable via `/task sidebar on|off`. (Files: `packages/opencode/src/tui-plugin/sidebar.ts`)

---

## Phase 13: TUI Plugin — Entry Point

- [ ] 13.1 **RED: Write TUI plugin boot integration test**. Mock `TuiPluginApi`; assert `tui(api, options, meta)` registers keybind + 5 commands + (optionally) sidebar without crashing. (Files: `packages/opencode/src/__tests__/tui-plugin/index.test.ts`)
- [ ] 13.2 **GREEN: Implement `tui-plugin/index.ts`**. Entry point exports `default: {tui: TuiPlugin}`. TuiPlugin delegates to live-control + commands + sidebar modules. (Files: `packages/opencode/src/tui-plugin/index.ts`)
- [ ] 13.3 **Add subpath export in `package.json`**. `"exports": {".": ..., "./tui": {"types": "./dist/tui-plugin/index.d.ts", "import": "./dist/tui-plugin/index.js"}}`. Update build config if needed. (Files: `packages/opencode/package.json`)

---

## Phase 14: Integration & E2E Tests

- [ ] 14.1 **Integration test: v14 Plan Review E2E**. Fake `experimental.chat.messages.transform` trigger with 3 task calls → fake picker returns BG/FG/Skip → assert OpenCode receives rewritten parts. (Files: `packages/opencode/src/__tests__/integration/v14-plan-review.test.ts`)
- [ ] 14.2 **Integration test: v14 Live Control E2E**. Simulated TUI: spawn FG task → trigger Ctrl+B → confirm → assert registry shows cancelled+re-spawned. (Files: `packages/opencode/src/__tests__/integration/live-control.test.ts`)
- [ ] 14.3 **Integration test: v14 completion delivery E2E**. Spawn BG task → complete it → assert `client.session.message.create` called once, no fallback fired. Then simulate primary failure → assert fallback fires. (Files: `packages/opencode/src/__tests__/integration/v14-delivery.test.ts`)
- [ ] 14.4 **Integration test: legacy regression**. Existing `opencode-adapter.test.ts` should still pass unchanged. If updates needed, minimize changes. (Files: `packages/opencode/src/__tests__/integration/opencode-adapter.test.ts`)
- [ ] 14.5 **Integration test: version detection routing**. Given both ctx shapes, assert correct builder invoked. (Files: `packages/opencode/src/__tests__/integration/routing.test.ts`)

---

## Phase 15: Documentation

- [ ] 15.1 **Update `packages/opencode/README.md`**. Fix `plugins` → `plugin` (singular). Add install section covering both entries (`@maicolextic/bg-subagents-opencode` and `/tui`). Document Plan Review UX + keyboard shortcuts. Document Live Control Ctrl+B + `/task move-bg`. Add migration note pointing to `docs/migration-v0.1-to-v1.0.md`. (Files: `packages/opencode/README.md`)
- [ ] 15.2 **Update `docs/skills/bg-subagents/SKILL.md`**. Same `plugins` → `plugin` fix. Update UX sections with Plan Review + Live Control. (Files: `docs/skills/bg-subagents/SKILL.md`)
- [ ] 15.3 **Update `docs/architecture.md`**. New component diagram showing host-compat layer + TUI plugin module. Update hook wiring table. (Files: `docs/architecture.md`)
- [ ] 15.4 **Create `docs/migration-v0.1-to-v1.0.md`**. User-facing migration: breaking changes, new features, upgrade instructions, troubleshooting. (Files: `docs/migration-v0.1-to-v1.0.md`)
- [ ] 15.5 **Update `docs/upstream/gentle-ai-pr.md`**. Reference v1.0 feature list. Include placeholder for demo capture link. Clear install instructions for Gentleman. (Files: `docs/upstream/gentle-ai-pr.md`)
- [ ] 15.6 **Update root `README.md` if referenced version numbers**. Ensure badge/links point to v1.0+. (Files: `README.md`)
- [ ] 15.7 **Update `CHANGELOG.md` via changeset**. Create a major bump changeset for `bg-subagents-opencode` explaining the breaking changes + new features. (Files: new `.changeset/*.md`)

---

## Phase 16: Manual E2E Validation (required before publish)

- [ ] 16.1 **Build local**. `pnpm -r run build`. Verify dist output has both `dist/index.js` AND `dist/tui-plugin/index.js`. (Files: build check)
- [ ] 16.2 **Link package to user's `~/.opencode`**. Use `pnpm link --global` or copy `dist/` + `package.json` into `~/.opencode/node_modules/@maicolextic/bg-subagents-opencode/`. Ensure both plugins in `opencode.json`: `"plugin": ["@maicolextic/bg-subagents-opencode", "@maicolextic/bg-subagents-opencode/tui"]`. (Files: local link; user's `~/.opencode/opencode.json`)
- [ ] 16.3 **E2E scenario 1: Plan Review with 3 subagents**. Open OpenCode with sdd-orchestrator active. Prompt that forces 3-subagent delegation. Assert picker appears, BG/FG/Skip selection works, resulting execution matches selection. (Files: manual verification; capture screenshots into `docs/demo/`)
- [ ] 16.4 **E2E scenario 2: Live Control Ctrl+B**. Delegate to a foreground agent with a long prompt (~30s runtime). Press Ctrl+B mid-execution. Verify dialog appears, confirm cancel+re-spawn, new BG task_id reported, main chat unblocks. (Files: manual verification + screenshots)
- [ ] 16.5 **E2E scenario 3: `/task list`, `/task show`, `/task kill`**. Spawn 2 BG tasks. Run `/task list` — assert both visible. `/task show <id>` — assert details. `/task kill <id>` — assert cancel. (Files: manual verification)
- [ ] 16.6 **E2E scenario 4: Completion delivery**. Wait for BG tasks to complete. Assert completion message appears in main chat once (not duplicated). (Files: manual verification)
- [ ] 16.7 **E2E scenario 5: Legacy graceful degradation**. If a legacy OpenCode binary is accessible, repeat install and verify per-call picker still works. If not accessible, add unit-test-level regression evidence only. (Files: manual verification OR documented "not tested due to no legacy binary")
- [ ] 16.8 **Capture demo**. Record asciinema or LICEcap GIFs of scenarios 1 and 2. Save to `docs/demo/plan-review.cast` and `docs/demo/live-control.gif`. Reference in `docs/upstream/gentle-ai-pr.md`. (Files: `docs/demo/plan-review.cast`, `docs/demo/live-control.gif`, updated `docs/upstream/gentle-ai-pr.md`)

---

## Phase 17: Release (v1.0.0)

- [ ] 17.1 **Create major changeset for v1.0.0**. File at `.changeset/bg-subagents-opencode-v1.md`: `"@maicolextic/bg-subagents-opencode": major` with summary pointing to migration guide. (Files: `.changeset/bg-subagents-opencode-v1.md`)
- [ ] 17.2 **Open PR from `feat/opencode-plan-review-live-control` to `main`**. Include change folder link, E2E screenshots/GIFs, migration guide. (Files: GitHub PR)
- [ ] 17.3 **Review + merge PR**. User reviews; resolve any feedback. (Files: PR merge)
- [ ] 17.4 **Verify Version PR auto-created by changesets/action**. Merge the Version PR (bumps `-opencode` to 1.0.0). (Files: GitHub PR merge)
- [ ] 17.5 **Verify release.yml publishes v1.0.0 to npm with provenance**. Watch run, check `npm view @maicolextic/bg-subagents-opencode version` returns `1.0.0`. Verify provenance signature via `npm view ... dist.signatures`. (Files: npm release)
- [ ] 17.6 **Deprecate v0.1.x**. Run `npm deprecate "@maicolextic/bg-subagents-opencode@<1.0.0" "Incompatible with OpenCode 1.14+. Upgrade to v1.0.0."`. (Files: npm deprecate action)
- [ ] 17.7 **Smoke test v1.0.0 install from npm**. In a fresh dir, `npm install @maicolextic/bg-subagents-opencode@1.0.0`. Verify no `EUNSUPPORTEDPROTOCOL`, dependencies resolved. (Files: manual verification)

---

## Phase 18: Upstream PR to Gentle-AI

- [ ] 18.1 **Fork `Gentleman-Programming/gentle-ai`** if not already forked. (Files: GitHub fork)
- [ ] 18.2 **Identify the right integration point** in gentle-ai repo (probably a config file, AGENTS.md, or equivalent). Read the repo structure to confirm. (Files: research; document in `docs/upstream/gentle-ai-pr.md`)
- [ ] 18.3 **Create PR branch in fork**. `feat/bg-subagents-plugin`. (Files: fork branch)
- [ ] 18.4 **Apply minimal integration**: add `@maicolextic/bg-subagents-opencode` + `/tui` to the recommended plugin list in gentle-ai's config example. Reference the demo and migration guide in the README. (Files: in gentle-ai repo — specifics TBD based on 18.2)
- [ ] 18.5 **Open PR on upstream**. Title: `feat: add @maicolextic/bg-subagents-opencode plugin for background subagent orchestration`. Body uses the polished `docs/upstream/gentle-ai-pr.md`. Link to v1.0.0 npm page + demo GIFs + migration guide. (Files: upstream PR)
- [ ] 18.6 **Monitor PR feedback** and iterate. (Files: as needed)

---

## Phase 19: Archive & Wrap

- [ ] 19.1 **Run `sdd-verify`** via orchestrator. Confirm all spec scenarios covered by tests. Produce verify report. (Files: `openspec/changes/opencode-plan-review-live-control/verify-report.md` + engram)
- [ ] 19.2 **Run `sdd-archive`**. Move change folder to `openspec/changes/archive/2026-MM-DD-opencode-plan-review-live-control/`. Merge delta specs into `openspec/specs/` main specs. (Files: archive move + main specs update)
- [ ] 19.3 **Save release retrospective to engram**. Topic `retro/v1.0-plan-review-live-control` — what went well, what hurt, gotchas for v1.1. (Files: engram only)

---

## Summary

| Phase | Tasks | Focus |
|---|---|---|
| 1 | 6 | Verification spikes (resolve 6 open questions) |
| 2 | 11 | Structural foundation (mechanical moves, preserve legacy) |
| 3 | 3 | Host version detection |
| 4 | 4 | Legacy hooks builder (wrap existing) |
| 5 | 4 | v14 Tool registration (Zod) |
| 6 | 5 | v14 Completion delivery |
| 7 | 4 | v14 System + Event hooks |
| 8 | 8 | Plan Review core (batch detector + picker + rewrite) |
| 9 | 5 | v14 Plan Review implementation (messages.transform + batching fallback) |
| 10 | 4 | v14 Hooks builder (wiring) |
| 11 | 3 | TUI Plugin shared state |
| 12 | 7 | TUI Plugin live control + commands |
| 13 | 3 | TUI Plugin entry point |
| 14 | 5 | Integration & E2E tests |
| 15 | 7 | Documentation |
| 16 | 8 | Manual E2E validation |
| 17 | 7 | Release v1.0.0 |
| 18 | 6 | Upstream PR to Gentle-AI |
| 19 | 3 | Archive & wrap |
| **TOTAL** | **103** | |

## Implementation Order Rationale

- **Phase 1 FIRST** — open questions resolved before committing to heavy refactor. If any NO-GO, pivot per Plan B and adjust design.
- **Phase 2 early and mechanical** — moves don't change behavior, keep 432 tests green. Gives us a clean base to build v14 on.
- **Phases 3–4 bridge legacy and routing** — enables gradual migration.
- **Phases 5–10 build v14 features** — bottom-up: primitives → core → builder.
- **Phases 11–13 TUI plugin** — depends on v14 builder wiring Phase 10 first.
- **Phases 14–15 integration + docs** — depend on completion of features.
- **Phase 16 manual E2E** — gate before publish.
- **Phase 17 release** — auto via CI.
- **Phase 18 upstream PR** — depends on 17 being live.
- **Phase 19 archive** — closes the change.

---

## Next

Ready for `sdd-apply`. In automatic mode, orchestrator proceeds to apply Phase 1 (verification spikes) first, then iterates through phases in order.
