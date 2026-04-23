# Design: OpenCode Plan Review + Live Control (v1.0)

## Technical Approach

Single npm package `@maicolextic/bg-subagents-opencode@1.0.0` with **two module exports** and **runtime-detected compat layer**:

```
@maicolextic/bg-subagents-opencode          (main)  → {default: {server, tui?}}
@maicolextic/bg-subagents-opencode/tui      (sub)   → {default: {tui}}
```

Entry `plugin.ts` implements the Plugin Input Protocol of both OpenCode versions. On each session boot:

1. `server(ctx)` receives `ctx` of either shape (legacy `{session_id, bus, session}` or v14 `{client, project, directory, ...}`).
2. `detectHostVersion(ctx)` classifies → `"v14" | "legacy" | "unknown"`.
3. Route to `buildV14Hooks(ctx)` or `buildLegacyHooks(ctx)` accordingly.
4. Each builder assembles its version-specific `Hooks` record and shares the core domain (`TaskRegistry`, `PolicyResolver`, `Picker`, `StrategyChain`).

Plan Review (v14 only) lives at the **message level** (not per-tool-call) using `experimental.chat.messages.transform`. If the batch detector finds 2+ `task` calls, it shows a picker and rewrites the message parts before the host executes tools. Fallback: per-call batching buffer in `tool.execute.before` if `messages.transform` proves unreliable.

Live Control (v14 TUI only) is a separate `TuiPlugin` in `src/tui-plugin/` that registers the `Ctrl+B` keybind, 5 slash commands, and (optionally) a sidebar slot. Communicates with the server plugin via process-local shared state (module-level singleton `TaskRegistry`).

---

## Architecture Decisions

### ADR-1: Dual-mode compatibility in one package (not two)

**Choice**: Single `@maicolextic/bg-subagents-opencode@1.0.0` with runtime version detection.

**Alternatives considered**:
- Two packages: `-opencode-legacy` + `-opencode` (v14-only).
- Abandon legacy, ship v14 only (minor version bump).

**Rationale**:
- User explicitly requested multi-version support. Two packages force users to pick the right one, increase documentation burden, and complicate the PR upstream.
- Runtime detection has low overhead (<50ms, <1KB of detection code) and is idiomatic for cross-API-version plugins (e.g., Webpack loaders, Babel plugins do this).
- Bundling both codepaths adds ~5KB gzipped — acceptable.
- Abandoning legacy breaks v0.1.x users on older OpenCode with no upgrade path.

### ADR-2: Plan Review via `experimental.chat.messages.transform` (primary) + per-call batching (fallback)

**Choice**: Use OpenCode 1.14's `experimental.chat.messages.transform` as the primary interception point. Keep a fallback implementation using time-window batching inside `tool.execute.before`.

**Alternatives considered**:
- `tool.execute.before` only, batched via 500ms debounce window.
- `chat.message` hook (read-only, emits AFTER message received).
- Per-call picker as today (reject; violates UX goal).

**Rationale**:
- `messages.transform` operates at the message level — we see the entire planned batch synchronously before any tool runs. Clean UX, no race conditions.
- The `experimental` prefix signals instability; OpenCode may change or remove it. Mitigation: abstract the "batch interception point" behind an internal interface so swapping implementations is trivial.
- Per-call batching is the battle-tested fallback. If `messages.transform` ever breaks, we enable it via env flag `BG_SUBAGENTS_PLAN_REVIEW=batching`.
- `chat.message` runs AFTER the LLM's message already includes tool invocations — too late to intercept cleanly.

**Implementation shape**:
```typescript
interface PlanInterceptor {
  intercept(parts: Part[]): Promise<{parts: Part[]; decisions: PlanDecision[]}>;
}

class MessagesTransformInterceptor implements PlanInterceptor { /* v14 primary */ }
class BatchingBeforeInterceptor implements PlanInterceptor { /* v14 fallback + legacy */ }
```

Env flag selects implementation; defaults to `MessagesTransformInterceptor` on v14.

### ADR-3: TUI plugin as separate module export (`./tui`)

**Choice**: Ship TUI plugin as `@maicolextic/bg-subagents-opencode/tui` — loaded by user explicitly in `opencode.json`.

**Alternatives considered**:
- Bundle TUI plugin into main entry (detect at runtime whether TUI API exists).
- Separate npm package (`@maicolextic/bg-subagents-opencode-tui`).

**Rationale**:
- OpenCode's plugin loader distinguishes `{server}` from `{tui}` module shapes and loads them differently. Exporting both from one module doesn't work — the `PluginModule` type explicitly excludes combining them (`tui?: never` on `PluginModule`).
- A separate subpath export (`"./tui"` in `package.json` `exports`) gives clean separation without a separate npm publish. Both subpaths ship from the same tarball.
- Users on legacy OpenCode just don't include `/tui` in their plugin array; no error. On v14 the user gets both.
- Separate npm package (third alt) doubles maintenance; we reject.

### ADR-4: Move-to-background cancels via `session.abort`, not `tool.cancel`

**Choice**: Use `client.session.abort({sessionID})` from the OpenCode SDK v2 for cancelling foreground tasks. `client.tool.cancel` is not exposed in the SDK.

**Alternatives considered**:
- `client.tool.cancel(callID)` — **does not exist in SDK v2**.
- Send a synthetic user message `/task cancel`.
- Kill the Node child process — too invasive.

**Rationale** (from reading `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`):
- `session` methods available: `delete, get, update, children, todo, init, fork, **abort**, unshare, share, diff, summarize, messages, prompt, deleteMessage`.
- `session.abort({sessionID})` terminates in-flight operations on that session — aggressive but correct for our use case.
- For subagents we spawned in child sessions (via our `runtime.ts` `session.create`), we can abort the child specifically; main session stays alive.
- If subagent ran in-process without a child session, we cancel via the `AbortSignal` passed to `runOpenCodeSubagent` (pre-existing path in `runtime.ts`).

**Resulting move-bg flow**:
```
1. TaskRegistry.get(taskID).abort()  // signals AbortController
2. client.session.abort({sessionID: childSessionID}) // if child session exists
3. Wait up to 3000ms for task to enter `cancelled` state
4. client.session.prompt({sessionID: mainSessionID, prompt: "", agent: "task_bg", tools: {task_bg: true}, system: `/inline-invoke task_bg({subagent_type: X, prompt: Y})`})
   // This triggers task_bg invocation in the main session; LLM won't generate new text
5. Toast: "Task moved to background. ID: <new>. Progress lost. /task list"
```

Open question (see below): exact mechanism for step 4 (synthetic tool invocation without LLM round-trip) needs verification.

### ADR-5: Zod version compatibility (3 → 4-beta bridge)

**Choice**: Keep `zod@3.25.76` as our dep. Expose tool definitions in BOTH shapes from a shared schema source using `zod-to-json-schema` (legacy JSON Schema) and a small wrapper for the new Zod input shape.

**Alternatives considered**:
- Upgrade protocol package to `zod@4-beta` — risky (beta, affects all consumers).
- Use `zod@3` at runtime and pray OpenCode accepts — the 1.14 types reject Zod 3 shapes at compile time.
- Ship bundled `zod@4-beta` just for the tool-register layer — bundle bloat.

**Rationale**:
- The v14 `ToolDefinition.args` is typed as `z.ZodRawShape` (from Zod). But at runtime, any object matching the shape works (structural). If OpenCode uses `parseAsync` internally, Zod 3 shapes should work too (Zod 3 shapes are compatible with Zod 4 for basic primitives, arrays, objects).
- Approach: write our `task_bg` tool schema once in Zod 3, export it as-is for v14, convert to JSON Schema for legacy via `zod-to-json-schema`.
- If Zod 3 shapes are rejected at runtime by OpenCode, fall back to Plan B: publish a tiny `@maicolextic/bg-subagents-opencode-zod4-shim` bridge package (isolates the breaking change).

**We MUST verify** (design risk): Test Zod 3 schema in actual OpenCode 1.14.21 boot. If it registers without error and the LLM can call `task_bg` with correct args, Plan A works. This is part of the `sdd-tasks` verification batch.

### ADR-6: Code organization — `host-compat/{legacy,v14}/` subdirs

**Choice**: Move existing `packages/opencode/src/hooks/*.ts` into `packages/opencode/src/host-compat/legacy/` unchanged. Create new `packages/opencode/src/host-compat/v14/` parallel.

**Alternatives considered**:
- Conditional code inside each existing hook file (`if (version === "v14") { ... } else { ... }`).
- Duplicate entire `packages/opencode/src/*` into v1 + v0 dirs.

**Rationale**:
- Conditionals inside each file obscure the per-version logic and make tests harder (need to mock both paths).
- Full directory duplication is overkill — core domain is shared.
- `host-compat/{legacy,v14}/` is explicit, self-documenting, and each path compiles as a standalone module (easier to delete legacy eventually).

### ADR-7: Delivery dedupe via registry-level flag

**Choice**: `TaskRegistry` exposes a `markDelivered(task_id)` method and maintains an internal `delivered: Set<string>`. Primary and fallback delivery paths both check `!delivered.has(id)` before writing the user-visible message.

**Alternatives considered**:
- Cancel fallback timer on primary success (race-prone; primary could fail AFTER timer fires).
- Ignore duplicates; let user see both (unacceptable UX).

**Rationale**:
- Registry is the single source of truth for task state — putting dedupe there keeps both delivery paths symmetric and testable.
- Atomic `add + check` via `Set.add(id).size > prevSize` semantics prevents concurrent duplicates.
- Preserves the **spec requirement** "exactly one completion message per task_id."

---

## Data Flow

### Plan Review (v14, happy path)

```
┌────────┐    1. LLM responds    ┌────────────────────────────┐
│  LLM   │─────────────────────→ │  experimental.chat.        │
└────────┘  (3 task tool calls)  │  messages.transform hook   │
                                 └──────────┬─────────────────┘
                                            │ 2. detectBatch(parts)
                                            ▼
                                 ┌────────────────────────────┐
                                 │  BatchDetector             │
                                 │  returns 3 entries         │
                                 └──────────┬─────────────────┘
                                            │ 3. resolver.resolve(agentName)
                                            ▼
                                 ┌────────────────────────────┐
                                 │  PolicyResolver            │
                                 │  returns default modes     │
                                 └──────────┬─────────────────┘
                                            │ 4. picker.prompt(entries)
                                            ▼
                                 ┌────────────────────────────┐
                                 │  Picker (TUI DialogSelect  │
                                 │  OR clack fallback)        │
                                 └──────────┬─────────────────┘
                                            │ 5. user picks: [BG, FG, Skip]
                                            ▼
                                 ┌────────────────────────────┐
                                 │  rewriteParts(decisions)   │
                                 │  - BG → swap to task_bg    │
                                 │  - FG → unchanged          │
                                 │  - Skip → remove           │
                                 └──────────┬─────────────────┘
                                            │ 6. output.messages mutated
                                            ▼
                                 ┌────────────────────────────┐
                                 │  OpenCode executes         │
                                 │  rewritten tool calls      │
                                 └────────────────────────────┘
```

### Live Control — Move to Background (v14 TUI)

```
User presses Ctrl+B while FG task is running
     │
     ▼
┌─────────────────────────────────────┐
│  TUI keybind handler                │
│  1. Find current FG task in         │
│     TaskRegistry (running, mode=fg) │
│  2. If none → toast "no FG task"    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  ui.DialogConfirm                   │
│  "Move to background? Lost progress"│
└──────────────┬──────────────────────┘
               │ user confirms
               ▼
┌─────────────────────────────────────┐
│  1. registry.cancel(taskId)         │
│  2. client.session.abort(child)     │
│     (if child session exists)       │
│  3. wait up to 3000ms for           │
│     state → "cancelled"             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  4. new Task spawn:                 │
│     registry.spawn({                │
│       meta: {tool: task_bg, ...},   │
│       run: (signal) => runSubagent  │
│     })                              │
│  5. Toast: "Moved. ID=new-id"       │
└─────────────────────────────────────┘
```

### Completion Delivery (v14)

```
BG task transitions to "completed"
     │
     ▼
┌─────────────────────────┐
│  TaskRegistry.onComplete│
└──────────┬──────────────┘
           │ CompletionEvent emitted
           ▼
┌─────────────────────────────────────┐
│  DeliveryCoordinator (v14)          │
│  ┌─────────────────────────────┐    │
│  │ PRIMARY:                    │    │
│  │ client.session.message      │    │
│  │ .create({sessionID, role:   │    │
│  │ "assistant", content})      │    │
│  └─────────────────────────────┘    │
│                                     │
│  On Promise resolve:                │
│    registry.markDelivered(id)       │
│    cancel fallback timer            │
│                                     │
│  On Promise reject OR timeout:      │
│  ┌─────────────────────────────┐    │
│  │ FALLBACK (after 2000ms):    │    │
│  │ client.session.prompt({     │    │
│  │   sessionID,                │    │
│  │   prompt: synthetic msg,    │    │
│  │   noReply: true             │    │
│  │ })                          │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Completion Delivery (legacy)

Unchanged from v0.1.4: `bus.emit("bg-subagents/task-complete", ...)` → `onDelivered(id)` → cancel 2000ms fallback timer → fallback uses `session.writeAssistantMessage`.

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/opencode/package.json` | Modify | Version 0.1.4 → 1.0.0. Add subpath export `"./tui"`. Add `zod-to-json-schema` dep (runtime). |
| `packages/opencode/src/plugin.ts` | Modify | Entry becomes routing shim; exports `{default: {server, tui?}}`. Delegates to compat layer. |
| `packages/opencode/src/types.ts` | Modify | Add v14 type mirrors. Keep legacy mirrors. Add `HostVersion` discriminated union. |
| `packages/opencode/src/hooks/` | Delete | Contents moved to `host-compat/legacy/`. |
| `packages/opencode/src/host-compat/` | Create | New subdirectory. |
| `packages/opencode/src/host-compat/version-detect.ts` | Create | `detectHostVersion(ctx): "v14" \| "legacy" \| "unknown"`. Honors `BG_SUBAGENTS_FORCE_COMPAT` env. |
| `packages/opencode/src/host-compat/legacy/index.ts` | Create | `buildLegacyHooks(ctx)` — builds legacy-shape Hooks. |
| `packages/opencode/src/host-compat/legacy/tool-register.ts` | Create | Moved from `hooks/tool-register.ts`, unchanged. |
| `packages/opencode/src/host-compat/legacy/tool-before.ts` | Create | Moved from `hooks/tool-before.ts`. |
| `packages/opencode/src/host-compat/legacy/chat-params.ts` | Create | Moved from `hooks/chat-params.ts`. |
| `packages/opencode/src/host-compat/legacy/event.ts` | Create | Moved from `hooks/event.ts`. |
| `packages/opencode/src/host-compat/legacy/chat-message-fallback.ts` | Create | Moved from `hooks/chat-message-fallback.ts`. |
| `packages/opencode/src/host-compat/v14/index.ts` | Create | `buildV14Hooks(ctx)` — builds v14-shape Hooks. |
| `packages/opencode/src/host-compat/v14/tool-register.ts` | Create | Zod schema → `{description, args, execute}` shape. |
| `packages/opencode/src/host-compat/v14/messages-transform.ts` | Create | `experimental.chat.messages.transform` handler for Plan Review. |
| `packages/opencode/src/host-compat/v14/system-transform.ts` | Create | `experimental.chat.system.transform` — replaces legacy `chat.params` for system injection. |
| `packages/opencode/src/host-compat/v14/delivery.ts` | Create | `DeliveryCoordinator` class: primary via `client.session.message.create`, fallback via `client.session.prompt(noReply)`. |
| `packages/opencode/src/host-compat/v14/event-handler.ts` | Create | `event` hook — consumes typed SDK `Event` union (read-only, logs interesting events). |
| `packages/opencode/src/host-compat/v14/batching-fallback.ts` | Create | Fallback Plan Review via `tool.execute.before` with time-window batching (used only if env flag set). |
| `packages/opencode/src/plan-review/` | Create | Plan Review shared logic. |
| `packages/opencode/src/plan-review/batch-detector.ts` | Create | `detectBatch(messageParts): BatchEntry[]`. |
| `packages/opencode/src/plan-review/plan-picker.ts` | Create | `pickPlan(entries, opts): Promise<PlanDecision[]>`. Chooses clack or TUI dialog based on caller. |
| `packages/opencode/src/plan-review/rewrite-parts.ts` | Create | `rewriteParts(parts, decisions): Part[]`. |
| `packages/opencode/src/plan-review/types.ts` | Create | `BatchEntry`, `PlanDecision`, `PlanInterceptor` interface. |
| `packages/opencode/src/tui-plugin/index.ts` | Create | TUI plugin entry. Exports `{default: {tui: TuiPlugin}}`. |
| `packages/opencode/src/tui-plugin/live-control.ts` | Create | Ctrl+B keybind + confirmation dialog + cancel+re-spawn flow. |
| `packages/opencode/src/tui-plugin/plan-review-dialog.ts` | Create | `ui.DialogSelect`-based picker implementation. |
| `packages/opencode/src/tui-plugin/commands.ts` | Create | 5 slash commands. |
| `packages/opencode/src/tui-plugin/sidebar.ts` | Create | Optional sidebar slot. |
| `packages/opencode/src/tui-plugin/shared-state.ts` | Create | Module-level singleton for passing `TaskRegistry` reference from server plugin to TUI. |
| `packages/opencode/src/strategies/OpenCodeTaskSwapStrategy.ts` | Modify | Consult host version from host_context. |
| `packages/opencode/src/runtime.ts` | Modify | Support v14 `client.session.*` API alongside legacy `session.create/prompt`. |
| `packages/opencode/src/__tests__/host-compat/` | Create | Tests for version detection + both builder paths. |
| `packages/opencode/src/__tests__/plan-review/` | Create | Tests for batch detector, picker, rewrite. |
| `packages/opencode/src/__tests__/tui-plugin/` | Create | Tests for TUI plugin (mocked TuiPluginApi). |
| `packages/opencode/src/__tests__/integration/v14-plan-review.test.ts` | Create | End-to-end v14 with mocked OpencodeClient. |
| `packages/opencode/src/__tests__/integration/live-control.test.ts` | Create | End-to-end TUI move-bg with mocks. |
| `packages/opencode/src/__tests__/integration/opencode-adapter.test.ts` | Modify | Update to exercise compat routing. |
| `packages/opencode/README.md` | Modify | Fix `plugins` → `plugin`. Document dual-mode. Describe Plan Review + Live Control UX. Migration note. |
| `docs/architecture.md` | Modify | Updated component diagram with compat layer. |
| `docs/migration-v0.1-to-v1.0.md` | Create | Migration guide for existing users. |
| `docs/skills/bg-subagents/SKILL.md` | Modify | Update for v1.0 UX and correct field names. |
| `docs/upstream/gentle-ai-pr.md` | Modify | Refine with v1.0 feature list and demo placeholder. |
| `.changeset/` | New changeset file | Major bump on `-opencode`; patch on `-core` if interface additions. |

**Summary**: ~18 new files, ~10 modified, ~5 moved/deleted.

---

## Interfaces / Contracts

### `detectHostVersion`

```typescript
// packages/opencode/src/host-compat/version-detect.ts
export type HostVersion = "v14" | "legacy" | "unknown";

export function detectHostVersion(ctx: unknown): HostVersion;
```

### Version-specific builders

```typescript
// packages/opencode/src/host-compat/legacy/index.ts
export function buildLegacyHooks(
  ctx: LegacyServerContext,
  overrides?: BuildServerOverrides,
): Promise<LegacyHooks>;

// packages/opencode/src/host-compat/v14/index.ts
export function buildV14Hooks(
  ctx: V14PluginInput,
  overrides?: BuildServerOverrides,
): Promise<V14Hooks>;
```

### Plan Review core types

```typescript
// packages/opencode/src/plan-review/types.ts
export interface BatchEntry {
  readonly agent_name: string;
  readonly prompt: string;
  readonly original_part_index: number;
  readonly call_id?: string;
}

export type PlanDecision =
  | { readonly entry: BatchEntry; readonly mode: "foreground" }
  | { readonly entry: BatchEntry; readonly mode: "background" }
  | { readonly entry: BatchEntry; readonly mode: "skip" };

export interface PlanInterceptor {
  intercept(
    parts: ReadonlyArray<Part>,
    ctx: InterceptorContext,
  ): Promise<{ parts: ReadonlyArray<Part>; decisions: ReadonlyArray<PlanDecision> }>;
}

export interface InterceptorContext {
  readonly resolver: PolicyResolver;
  readonly picker: PlanPicker;
  readonly logger?: Logger;
}
```

### TUI plugin shared state

```typescript
// packages/opencode/src/tui-plugin/shared-state.ts
// Module-level singleton — survives as long as the Node process.
export class SharedPluginState {
  readonly registry: TaskRegistry;
  readonly resolver: PolicyResolver;
  registerFromServer(state: SharedPluginState): void;
  static current(): SharedPluginState | null;
}
```

### v14 Delivery Coordinator

```typescript
// packages/opencode/src/host-compat/v14/delivery.ts
export interface DeliveryCoordinator {
  deliver(event: CompletionEvent, sessionID: string): Promise<void>;
}

export function createV14Delivery(opts: {
  client: OpencodeClient;
  registry: TaskRegistry;
  ackTimeoutMs?: number;  // default 2000
  logger?: Logger;
}): DeliveryCoordinator;
```

### `package.json` `exports`

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./tui": {
      "types": "./dist/tui-plugin/index.d.ts",
      "import": "./dist/tui-plugin/index.js"
    }
  }
}
```

---

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `detectHostVersion(ctx)` with hand-crafted ctx objects | Vitest table-driven tests. Cover: legacy ctx, v14 ctx, partial ctx, env override, unknown |
| Unit | `batch-detector.ts` — various message parts | Table-driven: 0, 1, 2, 3+ task calls, mixed with non-task, re-entry (task_bg) |
| Unit | `rewrite-parts.ts` — decision → parts transformation | For each decision kind: foreground unchanged, background swapped, skip removed |
| Unit | `plan-picker.ts` — clack fallback renders and resolves | Mock clack prompts, verify output |
| Unit | `delivery.ts` (v14) — primary + fallback paths | Mock `OpencodeClient`, assert single-delivery dedupe |
| Unit | `tui-plugin/live-control.ts` — keybind handler | Mock `TuiPluginApi`, assert dialog shown, cancel invoked, re-spawn called |
| Unit | `tui-plugin/commands.ts` — slash command handlers | Mock registry, assert correct state transitions |
| Integration | `buildV14Hooks` wiring — mocked ctx | Assert all hooks registered, correct types, plugin:booted log emitted |
| Integration | `buildLegacyHooks` wiring — mocked ctx | Parity with existing v0.1.4 behavior (regression suite) |
| Integration | v14 Plan Review E2E | Fake `experimental.chat.messages.transform` trigger with 3 task calls → assert picker shown → assert parts rewritten |
| Integration | v14 Live Control E2E | Fake TuiPluginApi → press "Ctrl+B" simulated key → assert cancel + re-spawn flow completes |
| Integration | v14 Completion Delivery | Fake `OpencodeClient.session.message.create` → assert primary fires, fallback cancelled |
| Regression | Existing 432 vitest tests | Must remain green after refactor (move to `host-compat/legacy/` paths) |
| Manual | Real OpenCode 1.14.21 on user's machine | E2E validation before publish: install local, run sdd-orchestrator, verify Plan Review + Live Control |
| Manual | Real OpenCode <1.14 (if accessible) | Validate legacy codepath if/when we find a legacy binary |

**Coverage target**: ≥80% for new modules. Keep existing coverage unchanged or improved.

**Test files**: Add `__tests__/` subdirs under each new module. Use existing vitest setup; no new test runner.

---

## Migration / Rollout

### Ship sequence

1. **v1.0.0 release via existing CI** (already validated today). OIDC Trusted Publishing + provenance. No CI changes needed.
2. **Deprecation of v0.1.x** immediately after v1.0.0 is confirmed live:
   ```bash
   npm deprecate "@maicolextic/bg-subagents-opencode@<1.0.0" \
     "Incompatible with OpenCode 1.14+. Please upgrade to v1.0.0 or pin to v0.1.4 for legacy OpenCode."
   ```
3. **Update published Gentle-AI upstream PR** (`docs/upstream/gentle-ai-pr.md`) to reference v1.0.0 and include demo capture.
4. **Open the upstream PR** on `Gentleman-Programming/gentle-ai` with the final artifacts.

### User migration path

From `v0.1.x` on legacy OpenCode:
- Install `v1.0.0` — transparent upgrade, per-call picker still works.
- No config changes needed.

From `v0.1.x` on OpenCode 1.14+ (broken installs):
- Upgrade to `v1.0.0` — plugin works for the first time, Plan Review + Live Control available.
- Recommended: add `/tui` subpath to `opencode.json`:
  ```json
  {"plugin": ["@maicolextic/bg-subagents-opencode", "@maicolextic/bg-subagents-opencode/tui"]}
  ```
- Migration guide at `docs/migration-v0.1-to-v1.0.md`.

### Feature flags for rollout

- `BG_SUBAGENTS_FORCE_COMPAT=legacy|v14` — override detection.
- `BG_SUBAGENTS_PLAN_REVIEW=messages-transform|batching|off` — pick Plan Review impl.
- `BG_SUBAGENTS_TUI=on|off` — opt-out of TUI plugin if installed.

No phased rollout needed (no user data migration).

---

## Open Questions

- [ ] **ZQ-1: Does OpenCode 1.14.21 accept Zod 3 schemas in `ToolDefinition.args`?** Needs runtime verification during `sdd-apply` (tasks phase). If no, fall back to Plan B (Zod 4-beta shim package).
- [ ] **EQ-1: Is `experimental.chat.messages.transform` semantically suitable?** Need to verify: (a) it fires BEFORE tools execute, (b) mutating `output.messages.parts` replaces the pre-execution call, (c) we can add/remove parts (not just modify). Test during `sdd-apply` batch 3. If not, enable batching fallback permanently.
- [ ] **SQ-1: Does `client.session.abort({sessionID})` truly cancel in-flight tool calls, or only prompt streaming?** Test in move-bg implementation. If only streaming, pair with `AbortSignal` propagation from `runOpenCodeSubagent`.
- [ ] **DQ-1: What's the exact mechanism for dispatching a synthetic tool invocation via `client.session.prompt({noReply: true})`?** Need to verify OpenCode accepts this pattern or whether we need a different approach (e.g., direct registry spawn without going through LLM).
- [ ] **TQ-1: Can `TuiPlugin` and server `Plugin` share state via module-level singleton safely?** Both run in the same Node process but might have different module resolutions (main entry vs `/tui` subpath). Verify both resolve to the same instance.
- [ ] **MQ-1: Does OpenCode support `experimental.chat.messages.transform` consistently across 1.14.20 and 1.14.21?** Minor versions may differ. We'll test against 1.14.21 (user's version) first and handle older minor versions as bug reports later.

**None of these BLOCK starting tasks/apply** — each has a documented Plan B. sdd-tasks should schedule verification early in the batch plan.

---

## Next Step

Ready for `sdd-tasks` (break down implementation into ordered task checklist with file-level mappings). The task breakdown should prioritize:

1. **Verification tasks first** — resolve ZQ-1, EQ-1, SQ-1 before heavy refactor.
2. **Structural moves** — host-compat/legacy relocation (mechanical).
3. **New v14 modules** — hook-by-hook with tests.
4. **Plan Review core** — batch detector + picker + rewriter with tests.
5. **TUI plugin** — last, depends on shared-state contract.
6. **Integration** — mock-driven E2E.
7. **Docs + migration guide** — parallel with code.
8. **Manual E2E** in real OpenCode — gate before publish.
9. **Release + deprecate v0.1.x**.
10. **Upstream PR to Gentle-AI**.
