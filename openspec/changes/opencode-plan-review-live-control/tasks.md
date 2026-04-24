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
- [x] 1.5 **Spike: shared state between main and `/tui` subpath exports (TQ-1 — RESOLVED NO-GO)**. Runtime spike (2026-04-24) confirmed OpenCode 1.14.22 rejects `{tui: fn}` exports in the `plugin` array. TUI plugin not loadable. ADR-3 superseded by ADR-8 (Plan D). TUI deferred to v1.1. (Files: `scripts/spike-tq1-tui/spike-tui.ts`, engram #1235)
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

## Phase 7.5: Centralized Logger + Stdout Sweep (zero-pollution constraint)

> **Hard constraint added 2026-04-24** — user reported raw JSON blobs (`{"ts":...,"level":"info","msg":"v14-event",...}`) polluting the OpenCode TUI. All diagnostic output MUST route to `~/.opencode/logs/bg-subagents.log` (or `%APPDATA%\opencode\logs\bg-subagents.log` on Windows). Stdout is reserved exclusively for user-visible markdown cards via `client.session.prompt`. See design.md "Non-Functional Requirements → Zero visual pollution (hard constraint)".

- [x] 7.5.1 **RED: Write `logger.ts` unit tests**. Assert:
  - `createLogger(namespace).debug(msg)` is a strict no-op (zero calls to `process.stdout.write`, zero file writes) when `BG_SUBAGENTS_DEBUG` is unset.
  - `createLogger(namespace).error(msg)` writes a JSON-line to the configured log file path; nothing reaches stdout.
  - `createLogger(namespace).info(msg)` routes to file; nothing reaches stdout.
  - When `BG_SUBAGENTS_DEBUG=true`, debug/info/warn/error write to stderr (NOT stdout) in addition to the file.
  - `BG_SUBAGENTS_LOG_FILE` env var overrides the default path.
  - Log file parent directory is created if missing (no crash on first write).
  - (Files: `packages/core/src/__tests__/logger.test.ts`)

- [x] 7.5.2 **GREEN: Implement `packages/core/src/logger.ts`**. Exports `createLogger(namespace: string): Logger`. Interface: `{ debug, info, warn, error }` — each method signature `(msg: string, meta?: Record<string, unknown>): void`. Log line format: `{"ts":"<ISO>","level":"<level>","ns":"<namespace>","msg":"<msg>",...meta}` — one JSON line per call, appended to the log file. Path resolution order: `BG_SUBAGENTS_LOG_FILE` env var → `~/.opencode/logs/bg-subagents.log` (Unix/macOS) or `%APPDATA%\opencode\logs\bg-subagents.log` (Windows, detected via `process.platform`). File opened in append mode on first write; parent dir created via `fs.mkdirSync({ recursive: true })` if missing. On file-open failure, falls back to stderr-only with a single one-time warning. `debug()` is compiled away (early return) when `BG_SUBAGENTS_DEBUG` is not `"true"`. (Files: `packages/core/src/logger.ts`)

- [x] 7.5.3 **Integration: Export logger from core package index**. Re-export `createLogger` and `Logger` type from `packages/core/src/index.ts`. Add `Logger` to the core package's public TypeScript types. (Files: `packages/core/src/index.ts`, `packages/core/src/types.ts` if types are centralized there)

- [x] 7.5.4 **Changeset for core patch bump (logger)**. `pnpm changeset` → patch on `@maicolextic/bg-subagents-core` with message "Add centralized logger with file routing and zero-stdout guarantee". (Files: new `.changeset/*.md`)

- [x] 7.5.5 **Sweep: `packages/opencode/src/host-compat/v14/event-handler.ts`**. Replace every `console.log`, `console.error`, and `process.stdout.write` call with `logger.debug(...)` using a `createLogger("v14:event-handler")` instance. Add a unit test asserting that simulating a `session.idle` event through the handler produces ZERO bytes on stdout (capture via `process.stdout.write` spy). (Files: `packages/opencode/src/host-compat/v14/event-handler.ts`, `packages/opencode/src/__tests__/host-compat/v14/event-handler.test.ts` — extend existing test file)

- [x] 7.5.6 **Sweep: `packages/opencode/src/host-compat/v14/index.ts`**. Replace the `plugin:booted` log (and any other console output) with `logger.info("plugin:booted", { version, mode })` via a `createLogger("v14:boot")` instance. Add a unit test asserting that `buildV14Hooks` invocation produces ZERO stdout bytes. (Files: `packages/opencode/src/host-compat/v14/index.ts`, extend `packages/opencode/src/__tests__/host-compat/v14/build.test.ts`)

- [x] 7.5.7 **Sweep: `packages/opencode/src/host-compat/v14/delivery.ts`**. Replace `delivery:primary-*` logs and any other console output with `logger.debug(...)` via a `createLogger("v14:delivery")` instance. Add assertions to the existing delivery unit test (Phase 6.1) that no stdout bytes are emitted during a full primary+fallback delivery cycle. (Files: `packages/opencode/src/host-compat/v14/delivery.ts`, extend `packages/opencode/src/__tests__/host-compat/v14/delivery.test.ts`)

- [x] 7.5.8 **Sweep: `packages/opencode/src/host-compat/legacy/` (all files)**. Audit all files in the legacy codepath (`tool-register.ts`, `tool-before.ts`, `chat-params.ts`, `event.ts`, `chat-message-fallback.ts`, `task-command.ts`, `index.ts`) for any `console.log`/`console.error`/`process.stdout.write`. Replace with `createLogger("legacy:<filename>")` calls. Add a single catch-all stdout-capture test in `packages/opencode/src/__tests__/host-compat/legacy/no-stdout.test.ts` that exercises `buildLegacyHooks` through a simulated lifecycle and asserts zero stdout bytes. (Files: all `packages/opencode/src/host-compat/legacy/*.ts`, new `packages/opencode/src/__tests__/host-compat/legacy/no-stdout.test.ts`)

- [x] 7.5.9 **Verify: full test suite green after sweep**. `pnpm -r run test`. Zero regressions. Confirm stdout-capture tests all pass with `BG_SUBAGENTS_DEBUG` unset. (Files: test run)

---

## Phase 8: Plan Review Core (shared between v14 and fallback)

> **OQ-1 resolved (2026-04-24)**: Candidate 7 (PolicyResolver defaults + slash override) is the v1.0 primary. No interactive picker in v1.0. Tasks 8.1/8.2 (batch-detector with threshold), 8.5/8.6 (plan-picker-clack), and 8.7/8.8 (non-TTY fallback) are dropped. New tasks 8.5–8.8 cover PolicyResolver batch mode and `/task policy` slash command. Tasks 8.3/8.4 (rewrite-parts) are kept but scope updated: input is `PolicyDecision[]` from PolicyResolver, not picker output.

- [ ] ~~8.1 **RED: Write `batch-detector` unit tests**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0). The new flow iterates ALL `task` parts with no minimum threshold; a standalone BatchDetector module is not needed — iteration happens inline in `messages-transform.ts`.
- [ ] ~~8.2 **GREEN: Implement `plan-review/batch-detector.ts`**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0). Batch detection logic folds directly into `MessagesTransformInterceptor`.
- [ ] 8.3 **RED: Write `rewrite-parts` unit tests**. For each decision kind: foreground unchanged, background swapped to task_bg. Updated test cases: input is `PolicyDecision[]` from PolicyResolver (not picker output). "All skipped" scenario removed — no skip decision in v1.0 (deferred with Candidate 6 to v1.1). Covers: single FG, single BG, mixed FG+BG, all BG, empty list. Based on `plan-review/spec.md` "Message Part Rewriting". (Files: `packages/opencode/src/__tests__/plan-review/rewrite-parts.test.ts`)
- [ ] 8.4 **GREEN: Implement `plan-review/rewrite-parts.ts`**. `rewriteParts(parts, decisions: PolicyDecision[]): Part[]`. Takes `PolicyDecision[]` from PolicyResolver. No skip path in v1.0. Updates `packages/opencode/src/plan-review/types.ts`: `PlanDecision` renamed to `PolicyDecision`; `PlanPicker` interface removed; `InterceptorContext.picker` removed. (Files: `packages/opencode/src/plan-review/rewrite-parts.ts`, `packages/opencode/src/plan-review/types.ts`)
- [ ] ~~8.5 **RED: Write `plan-picker` clack fallback unit tests**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0).
- [ ] ~~8.6 **GREEN: Implement `plan-review/plan-picker-clack.ts`**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0).
- [ ] ~~8.7 **RED: Write non-TTY fallback test**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0). PolicyResolver is always non-interactive; no TTY check needed.
- [ ] ~~8.8 **GREEN: Add TTY check in `plan-picker-clack.ts`**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0).
- [ ] 8.5 **RED: PolicyResolver batch decision test**. Given a list of `task` call entries and a policy config (per-agent + wildcard default), assert `PolicyResolver.resolveBatch(entries)` returns correct `PolicyDecision[]` — correct `"background" | "foreground"` per entry. Also: session override `"bg"` wins over per-agent config; override `"default"` reverts to per-agent config; unknown agent falls back to wildcard `"*"`. (Files: `packages/core/src/__tests__/policy/policy-resolver.test.ts` — new section)
- [ ] 8.6 **GREEN: PolicyResolver batch decision impl**. Extend `packages/core/src/policy/` with `resolveBatch(entries: BatchEntry[], sessionOverride?: "bg" | "fg" | "default"): PolicyDecision[]`. Confirm whether existing per-agent `resolve(agentName)` is sufficient or a batch method is needed. If the existing per-agent method already works, expose a thin `resolveBatch` wrapper that maps over entries. (Files: `packages/core/src/policy/policy-resolver.ts` — extend or confirm no change needed)
- [ ] 8.7 **RED: Slash command `/task policy` test**. Test that a `chat.message` hook intercepting `/task policy bg` (a) sets a session-scoped override keyed by `sessionID`, (b) the PolicyResolver honors that override on the NEXT `messages.transform` invocation for the same session, and (c) `/task policy default` clears the override and PolicyResolver reverts to per-agent config defaults. (Files: `packages/opencode/src/__tests__/host-compat/v14/slash-commands.test.ts` — new cases in the test file from Phase 12)
- [ ] 8.8 **GREEN: Slash command `/task policy` impl**. Implement `/task policy <bg|fg|default>` in the server-side message interceptor (`host-compat/v14/slash-commands.ts`, established in Phase 12). Store override in a `Map<sessionID, PolicyOverride>` in-memory. PolicyResolver reads this map before per-agent config lookup. Coordinate injection mechanism with Phase 12 Live Control slash commands so both share the same interceptor entry point. (Files: `packages/opencode/src/host-compat/v14/slash-commands.ts`, `packages/core/src/policy/policy-resolver.ts` if override state lives there)

---

## Phase 9: v14 Plan Review Implementation

> **OQ-1 resolved (2026-04-24)**: Tasks 9.1/9.2 scope updated — no picker invocation, flow is PolicyResolver lookup + rewrite. Tasks 9.3/9.4 (batching-fallback as a v14 Plan Review path) dropped — the per-call `tool.execute.before` path is LEGACY (pre-1.14) only, handled in Phase 4 territory, not here. Task 9.5 (REFACTOR) kept but scope trimmed: `batching-fallback` no longer implements `PlanInterceptor` in v14; interface is used by `messages-transform` only.

- [ ] 9.1 **RED: Write `messages-transform` integration test**. Mock v14 ctx with `experimental.chat.messages.transform` invocation. Feed 3 task calls. Assert PolicyResolver called per entry, output mutated per policy decisions (BG→swap to task_bg, FG→unchanged). No picker invocation asserted. Also: assert idempotency — second invocation with `PlanReviewMarker` present short-circuits without re-rewriting. Based on `plan-review/spec.md` "Message Part Rewriting". (Files: `packages/opencode/src/__tests__/host-compat/v14/messages-transform.test.ts`)
- [ ] 9.2 **GREEN: Implement `host-compat/v14/messages-transform.ts`**. Handler for `experimental.chat.messages.transform`. Flow: iterate ALL task parts → `PolicyResolver.resolveBatch(entries, sessionOverride?)` → `rewriteParts(decisions)` → inject `PlanReviewMarker` part → mutate output. Detect `PlanReviewMarker` on entry and short-circuit (idempotency, per ADR-2 post-spike amendment). No `pickPlan` call. Uses module-level config for Plan Review enabled flag. (Files: `packages/opencode/src/host-compat/v14/messages-transform.ts`)
- [ ] ~~9.3 **RED: Write `batching-fallback` test**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0). The per-call `tool.execute.before` path is LEGACY (pre-1.14) only and lives in Phase 4 territory — it does NOT need a picker trigger since PolicyResolver decisions are applied silently.
- [ ] ~~9.4 **GREEN: Implement `host-compat/v14/batching-fallback.ts`**~~. — Dropped per OQ-1 resolution (Candidate 7, no interactive picker in v1.0). The env flag `BG_SUBAGENTS_PLAN_REVIEW=batching` is repurposed: if set, v14 still uses `messages.transform` but skips `PlanReviewMarker` injection (full rewrite every invocation — useful for debugging). No separate batching module needed.
- [ ] 9.5 **REFACTOR: Trim `PlanInterceptor` interface**. `messages-transform` still implements `PlanInterceptor`; `batching-fallback` no longer does (dropped). Remove `picker` from `InterceptorContext`. Confirm `types.ts` is consistent with Phase 8.4 changes (`PolicyDecision` replaces `PlanDecision`; `PlanPicker` removed). (Files: `packages/opencode/src/plan-review/types.ts`, update 9.2)

---

## Phase 10: v14 Hooks Builder (wiring everything together)

- [ ] 10.1 **RED: Write `buildV14Hooks` integration test**. Given a mock v14 `PluginInput`, assert the returned `Hooks` has: `tool: {task_bg: ToolDefinition}`, `experimental.chat.messages.transform: fn`, `experimental.chat.system.transform: fn`, `event: fn`, `plugin:booted` log emitted. (Files: `packages/opencode/src/__tests__/host-compat/v14/build.test.ts`)
- [ ] 10.2 **GREEN: Create `host-compat/v14/index.ts` with `buildV14Hooks`**. Wires: `v14/tool-register` + `v14/messages-transform` (or batching-fallback per env) + `v14/system-transform` + `v14/event-handler` + `v14/delivery`. Exports `buildV14Hooks(input, overrides?): Promise<V14Hooks>`. (Files: `packages/opencode/src/host-compat/v14/index.ts`)
- [ ] 10.3 **REFACTOR: Update `plugin.ts` to route via `detectHostVersion`**. If `"v14"` → `buildV14Hooks`. If `"legacy"` → `buildLegacyHooks`. If `"unknown"` → warn + try legacy fallback. (Files: `packages/opencode/src/plugin.ts`)
- [ ] 10.4 **Verify all tests green (both compat paths)**. `pnpm -r run test`. (Files: test run)

---

## Phase 11: TUI Plugin — Shared State — DROPPED

> ~~All tasks in this phase dropped per ADR-8 (Plan D pivot — v1.0 is server-side only, no TUI plugin).~~

- ~~[ ] 11.1 **RED: Write `SharedPluginState` singleton tests**.~~ ~~Dropped per ADR-8 — no TUI plugin in v1.0.~~
- ~~[ ] 11.2 **GREEN: Implement `tui-plugin/shared-state.ts`**.~~ ~~Dropped per ADR-8 — no TUI plugin in v1.0.~~
- ~~[ ] 11.3 **Integrate: call `SharedPluginState.registerFromServer` from `buildV14Hooks`**.~~ ~~Dropped per ADR-8 — no TUI plugin in v1.0.~~

---

## Phase 12: Live Control + Commands (server-side, post-ADR-8 pivot)

- ~~[ ] 12.1 **RED: Write `plan-review-dialog.test.ts`**~~ ~~Dropped per ADR-8 — TUI DialogSelect not available in v1.0.~~
- ~~[ ] 12.2 **GREEN: Implement `tui-plugin/plan-review-dialog.ts`**~~ ~~Dropped per ADR-8 — TUI DialogSelect not available in v1.0.~~
- [ ] 12.3 **RED: Write `slash-commands.test.ts`**. Mock server-side message hook; assert `/task move-bg <id>` pattern detected, correct task resolved from registry, cancel+re-spawn flow triggered. Based on `live-control/spec.md` scenarios. (Files: `packages/opencode/src/__tests__/host-compat/v14/slash-commands.test.ts`)
- [ ] 12.4 **GREEN: Implement `host-compat/v14/slash-commands.ts`**. Server-side interceptor for `/task move-bg <id>` via `chat.message` hook (or equivalent server-side message handler — mechanism confirmed in Phase 8 OQ-1 resolution). Queries `TaskRegistry` directly; no shared-state singleton needed. (Files: `packages/opencode/src/host-compat/v14/slash-commands.ts`)
- [ ] 12.5 **RED: Write remaining slash command tests**. Cover `/task list`, `/task show`, `/task logs`, `/task kill`. Same interceptor module as 12.3/12.4. Assert each pattern dispatches correct registry call and returns formatted text response. (Files: `packages/opencode/src/__tests__/host-compat/v14/slash-commands.test.ts` — additional cases)
- [ ] 12.6 **GREEN: Extend `slash-commands.ts` with list/show/logs/kill handlers**. All 5 slash commands share the same server-side message interception mechanism established in 12.3/12.4. (Files: `packages/opencode/src/host-compat/v14/slash-commands.ts`)
- ~~[ ] 12.7 **Optional: Implement sidebar slot**~~ ~~Dropped per ADR-8 — no `api.slots.register` in v1.0 (TUI plugin dropped).~~

---

## Phase 13: TUI Plugin — Entry Point — DROPPED

> ~~All tasks in this phase dropped per ADR-8 (Plan D pivot — v1.0 is server-side only, no TUI plugin).~~

- ~~[ ] 13.1 **RED: Write TUI plugin boot integration test**.~~ ~~Dropped per ADR-8 — no TUI plugin in v1.0.~~
- ~~[ ] 13.2 **GREEN: Implement `tui-plugin/index.ts`**.~~ ~~Dropped per ADR-8 — no TUI plugin in v1.0.~~
- ~~[ ] 13.3 **Add subpath export in `package.json`**.~~ ~~Dropped per ADR-8 — `./tui` subpath removed from exports. No build config changes for TUI dist.~~

---

## Phase 14: Integration & E2E Tests

- [ ] 14.1 **Integration test: v14 Plan Review E2E**. Fake `experimental.chat.messages.transform` trigger with 3 task calls (different agent names) → PolicyResolver assigns BG/FG per agent_name using configured policy → assert OpenCode receives rewritten parts (BG entries swapped to task_bg, FG entries unchanged). No picker invocation. Also: assert `/task policy bg` override forces all 3 to BG regardless of per-agent config. (Files: `packages/opencode/src/__tests__/integration/v14-plan-review.test.ts`)
- [ ] 14.2 **Integration test: v14 Live Control E2E**. Simulate server-side message interception: inject `/task move-bg <id>` as user message → assert server plugin detects pattern → assert registry shows cancelled+re-spawned task. (Files: `packages/opencode/src/__tests__/integration/live-control.test.ts`)
- [ ] 14.3 **Integration test: v14 completion delivery E2E**. Spawn BG task → complete it → assert `client.session.message.create` called once, no fallback fired. Then simulate primary failure → assert fallback fires. (Files: `packages/opencode/src/__tests__/integration/v14-delivery.test.ts`)
- [ ] 14.4 **Integration test: legacy regression**. Existing `opencode-adapter.test.ts` should still pass unchanged. If updates needed, minimize changes. (Files: `packages/opencode/src/__tests__/integration/opencode-adapter.test.ts`)
- [ ] 14.5 **Integration test: version detection routing**. Given both ctx shapes, assert correct builder invoked. (Files: `packages/opencode/src/__tests__/integration/routing.test.ts`)

---

## Phase 15: Documentation

- [ ] 15.1 **Update `packages/opencode/README.md`**. Fix `plugins` → `plugin` (singular). Single plugin entry only — remove any `/tui` subpath install instructions (no TUI plugin in v1.0, ADR-8). Document Plan Review UX. Document Live Control as slash commands (`/task move-bg <id>`, `/task list`, `/task show`, `/task logs`, `/task kill`). Add migration note pointing to `docs/migration-v0.1-to-v1.0.md`. (Files: `packages/opencode/README.md`)
- [ ] 15.2 **Update `docs/skills/bg-subagents/SKILL.md`**. Same `plugins` → `plugin` fix. Remove TUI plugin install step. Update UX sections with Plan Review + slash command Live Control. (Files: `docs/skills/bg-subagents/SKILL.md`)
- [ ] 15.3 **Update `docs/architecture.md`**. New component diagram showing host-compat layer (server-side only — no TUI plugin module in v1.0). Update hook wiring table. (Files: `docs/architecture.md`)
- [ ] 15.4 **Create `docs/migration-v0.1-to-v1.0.md`**. User-facing migration: breaking changes, new features, upgrade instructions, troubleshooting. Note: no `/tui` subpath in v1.0 — single plugin entry only. Document slash commands as the Live Control surface. (Files: `docs/migration-v0.1-to-v1.0.md`)
- [ ] 15.5 **Update `docs/upstream/gentle-ai-pr.md`**. Reference v1.0 feature list. Include placeholder for demo capture link. Clear install instructions for Gentleman. (Files: `docs/upstream/gentle-ai-pr.md`)
- [ ] 15.6 **Update root `README.md` if referenced version numbers**. Ensure badge/links point to v1.0+. (Files: `README.md`)
- [ ] 15.7 **Update `CHANGELOG.md` via changeset**. Create a major bump changeset for `bg-subagents-opencode` explaining the breaking changes + new features. (Files: new `.changeset/*.md`)

---

## Phase 16: Manual E2E Validation (required before publish)

- [ ] 16.1 **Build local**. `pnpm -r run build`. Verify dist output has `dist/index.js` (single main export — no `dist/tui-plugin/` expected, ADR-8). (Files: build check)
- [ ] 16.2 **Link package to user's `~/.opencode`**. Use `pnpm link --global` or copy `dist/` + `package.json` into `~/.opencode/node_modules/@maicolextic/bg-subagents-opencode/`. Single entry in `opencode.json`: `"plugin": ["@maicolextic/bg-subagents-opencode"]`. No `/tui` entry needed. (Files: local link; user's `~/.opencode/opencode.json`)
- [ ] 16.3 **E2E scenario 1: Plan Review with 3 subagents (PolicyResolver)**. Open OpenCode with sdd-orchestrator active. Configure policy: `sdd-explore=background, sdd-apply=foreground, *=background`. Prompt that forces 3-subagent delegation (sdd-explore + sdd-apply + sdd-verify). Assert each task lands in the configured mode (no picker appears). Sub-scenario: run `/task policy bg` BEFORE the prompt, then assert all 3 go BG regardless of per-agent config. Sub-scenario: run `/task policy default` to clear override, assert per-agent config resumes. (Files: manual verification; capture screenshots into `docs/demo/`)
- [ ] 16.4 **E2E scenario 2: Live Control via slash command**. Delegate to a foreground agent with a long prompt (~30s runtime). Type `/task move-bg <id>` in the chat mid-execution. Verify server plugin intercepts the command, cancel+re-spawn completes, new BG task_id reported in the chat reply, main session unblocks. (Files: manual verification + screenshots)
- [ ] 16.5 **E2E scenario 3: `/task list`, `/task show`, `/task kill`**. Spawn 2 BG tasks. Run `/task list` — assert both visible in chat reply. `/task show <id>` — assert details. `/task kill <id>` — assert cancel. Mechanism: server-side slash command interception (not TUI api.command). (Files: manual verification)
- [ ] 16.6 **E2E scenario 4: Completion delivery**. Wait for BG tasks to complete. Assert completion message appears in main chat once (not duplicated). (Files: manual verification)
- [ ] 16.7 **E2E scenario 5: Legacy graceful degradation**. If a legacy OpenCode binary is accessible, repeat install and verify per-call picker still works. If not accessible, add unit-test-level regression evidence only. (Files: manual verification OR documented "not tested due to no legacy binary")
- [ ] 16.8 **Capture demo**. Record asciinema or LICEcap GIFs of scenarios 1 and 2. Save to `docs/demo/plan-review.cast` and `docs/demo/live-control.gif`. Reference in `docs/upstream/gentle-ai-pr.md`. (Files: `docs/demo/plan-review.cast`, `docs/demo/live-control.gif`, updated `docs/upstream/gentle-ai-pr.md`)

- [ ] 16.9 **Zero-pollution smoke test (hard constraint gate)**. Install bg-subagents in a clean OpenCode environment (fresh `opencode.json` — no prior plugin state). Send 3 basic prompts that trigger task delegation (one requiring sdd-explore, one requiring sdd-apply, one requiring a generic BG task). With `BG_SUBAGENTS_DEBUG` **UNSET** (confirm via `echo $BG_SUBAGENTS_DEBUG` returns empty), capture the full TUI output for all 3 prompt cycles (screenshot or asciinema). Assert ALL of the following are true — if ANY assertion fails, block the release and fix before continuing:
  - No raw JSON objects visible anywhere in the chat pane (no `{`, `"ts":`, `"level":`, `"msg":` patterns in visible output).
  - No `ts`/`level`/`msg`/`event_type` field names appear anywhere in TUI output.
  - No raw event dump text (e.g. no `v14-event`, `plugin:booted`, `delivery:primary-*`, `session.idle` appearing as chat text).
  - No ANSI escape sequences from bg-subagents appearing outside of standard OpenCode chrome.
  - ONLY clean markdown task cards (format per Plan D v1.0 visual strategy) and native OpenCode chat bubbles visible.
  - Log file at `~/.opencode/logs/bg-subagents.log` (or platform equivalent) was created and contains the diagnostic output that would otherwise have appeared on stdout.
  (Files: manual verification + screenshot saved to `docs/demo/zero-pollution-smoke.png`)

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
- [ ] 18.4 **Apply minimal integration**: add `@maicolextic/bg-subagents-opencode` (single entry — no `/tui` subpath in v1.0) to the recommended plugin list in gentle-ai's config example. Reference the demo and migration guide in the README. (Files: in gentle-ai repo — specifics TBD based on 18.2)
- [ ] 18.5 **Open PR on upstream**. Title: `feat: add @maicolextic/bg-subagents-opencode plugin for background subagent orchestration`. Body uses the polished `docs/upstream/gentle-ai-pr.md`. Link to v1.0.0 npm page + demo GIFs + migration guide. (Files: upstream PR)
- [ ] 18.6 **Monitor PR feedback** and iterate. (Files: as needed)

---

## Phase 19: Archive & Wrap

- [ ] 19.1 **Run `sdd-verify`** via orchestrator. Confirm all spec scenarios covered by tests. Produce verify report. (Files: `openspec/changes/opencode-plan-review-live-control/verify-report.md` + engram)
- [ ] 19.2 **Run `sdd-archive`**. Move change folder to `openspec/changes/archive/2026-MM-DD-opencode-plan-review-live-control/`. Merge delta specs into `openspec/specs/` main specs. (Files: archive move + main specs update)
- [ ] 19.3 **Save release retrospective to engram**. Topic `retro/v1.0-plan-review-live-control` — what went well, what hurt, gotchas for v1.1. (Files: engram only)

---

## Summary

> **Plan D pivot (ADR-8, 2026-04-24)**: Phases 11 and 13 dropped entirely. Phase 12 converted from TUI plugin commands to server-side slash command interception (12.1, 12.2, 12.7 dropped; 12.3-12.6 rewritten as server-side). Dropped: 3 (Phase 11) + 3 (Phase 13) + 3 (Phase 12.1/12.2/12.7) = 9 tasks total. Task count: 103 → 94 active.
>
> **OQ-1 resolution (Candidate 7, 2026-04-24)**: Phase 8 restructured — 8.1/8.2/8.5/8.6/8.7/8.8 (batch-detector + picker + clack + non-TTY) all dropped; 8.3/8.4 (rewrite-parts) scope-updated; new 8.5/8.6 (PolicyResolver batch) + 8.7/8.8 (/task policy slash command) added. Net Phase 8: 8 active → 6 active (4 dropped as strikethrough, 4 replaced by new tasks = same 8 slots, but 4 are ~~struck~~). Phase 9: 9.3/9.4 dropped. Net change: −4 tasks (8.1/8.2 dropped, 8.5/8.6/8.7/8.8 replaced in-place, 9.3/9.4 dropped = net −2 from Phase 9). Total: 94 → 90 active.
>
> **Zero-pollution constraint (2026-04-24)**: New Phase 7.5 (9 tasks) adds centralized logger + stdout sweep across all plugin files. New task 16.9 adds a zero-pollution smoke test as a hard release gate for Phase 16. Task count: 90 → 100 active.

| Phase | Tasks (active) | Focus |
|---|---|---|
| 1 | 6 (1 resolved as closed) | Verification spikes (resolve 6 open questions — TQ-1 now closed NO-GO) |
| 2 | 11 | Structural foundation (mechanical moves, preserve legacy) |
| 3 | 3 | Host version detection |
| 4 | 4 | Legacy hooks builder (wrap existing) |
| 5 | 4 | v14 Tool registration (Zod) |
| 6 | 5 | v14 Completion delivery |
| 7 | 4 | v14 System + Event hooks (shipped) |
| 7.5 | 9 | Centralized logger + stdout sweep (zero-pollution hard constraint) |
| 8 | 6 | Plan Review core (PolicyResolver batch + /task policy + rewrite-parts) — OQ-1 resolved |
| 9 | 3 | v14 Plan Review implementation (messages.transform only; batching-fallback dropped) — OQ-1 resolved |
| 10 | 4 | v14 Hooks builder (wiring) |
| 11 | 0 | ~~TUI Plugin shared state~~ — DROPPED (ADR-8) |
| 12 | 4 | Server-side slash command interception (Live Control, post-pivot) |
| 13 | 0 | ~~TUI Plugin entry point~~ — DROPPED (ADR-8) |
| 14 | 5 | Integration & E2E tests |
| 15 | 7 | Documentation (no TUI install instructions) |
| 16 | 9 | Manual E2E validation (single plugin entry, slash command + PolicyResolver + zero-pollution gate) |
| 17 | 7 | Release v1.0.0 |
| 18 | 6 | Upstream PR to Gentle-AI |
| 19 | 3 | Archive & wrap |
| **TOTAL** | **100** | (was 90 — zero-pollution adds Phase 7.5 +9 tasks + task 16.9 = +10) |

## Implementation Order Rationale

- **Phase 1 FIRST** — open questions resolved before committing to heavy refactor. TQ-1 closed as NO-GO (2026-04-24), triggering ADR-8 pivot. OQ-1 (picker mechanism for Plan Review) resolved 2026-04-24 — Candidate 7 chosen; no picker implementation needed anywhere.
- **Phase 2 early and mechanical** — moves don't change behavior, keep 432 tests green. Gives us a clean base to build v14 on.
- **Phases 3–4 bridge legacy and routing** — enables gradual migration.
- **Phases 5–10 build v14 features** — bottom-up: primitives → core → builder.
- **Phase 7.5 BEFORE Phase 8** — the centralized logger must exist before any new v14 modules (Phase 8+) are written, so they can import `createLogger` from the start instead of using `console.log` that then needs to be swept again. The stdout sweep tasks (7.5.5–7.5.8) fix existing files written in Phases 7 and earlier. Phase 7.5 is a hard prerequisite for the zero-pollution constraint — all subsequent phases inherit the no-stdout discipline automatically. Task 16.9 (zero-pollution smoke test) validates this end-to-end before publish; it blocks release if any assertion fails.
- **Phase 8 before Phase 9** — PolicyResolver batch mode (8.5/8.6) and `/task policy` slash command (8.7/8.8) must exist before `messages-transform.ts` (9.2) calls `resolveBatch`. Note: 8.7/8.8 reference `slash-commands.ts` from Phase 12 — coordinate dependency; the test file can be created in Phase 8 even if the implementation module is finalized in Phase 12.
- **Phase 11 DROPPED** (ADR-8 — no TUI plugin in v1.0).
- **Phase 12 server-side slash commands** — replaces TUI Live Control. Depends on Phase 10 (v14 hooks builder). `/task policy` command (Phase 8.7/8.8) shares the same interceptor module as Phase 12 — ensure Phase 12 goes first or they land in the same batch.
- **Phase 13 DROPPED** (ADR-8 — no TUI plugin in v1.0).
- **Phases 14–15 integration + docs** — depend on completion of features. Docs updated for PolicyResolver + slash command UX (no picker mention).
- **Phase 16 manual E2E** — gate before publish. Validates policy config, `/task policy` override, `/task move-bg`, no picker appearing, AND zero-pollution (task 16.9 is a hard release block — no JSON blobs, no raw event dumps allowed in TUI output).
- **Phase 17 release** — auto via CI.
- **Phase 18 upstream PR** — depends on 17 being live. Single plugin entry in example config.
- **Phase 19 archive** — closes the change.

---

## Next

Ready for `sdd-apply`. In automatic mode, orchestrator proceeds to apply Phase 1 (verification spikes) first, then iterates through phases in order.
