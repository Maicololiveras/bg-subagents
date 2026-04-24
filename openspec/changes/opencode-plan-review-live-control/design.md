# Design: OpenCode Plan Review + Live Control (v1.0)

## Technical Approach

> **Plan D pivot (2026-04-24, post-spike TQ-1 runtime)**: v1.0 is **server-side only**. The TUI plugin (`./tui` subpath, `Ctrl+B` keybind, sidebar) is **deferred to v1.1**. See ADR-8 for the full decision. The sections below reflect the post-pivot architecture.

Single npm package `@maicolextic/bg-subagents-opencode@1.0.0` with a **single main export** and **runtime-detected compat layer**:

```
@maicolextic/bg-subagents-opencode          (main)  → {default: Plugin}
```

Entry `plugin.ts` implements the Plugin Input Protocol of both OpenCode versions. On each session boot:

1. `server(ctx)` receives `ctx` of either shape (legacy `{session_id, bus, session}` or v14 `{client, project, directory, ...}`).
2. `detectHostVersion(ctx)` classifies → `"v14" | "legacy" | "unknown"`.
3. Route to `buildV14Hooks(ctx)` or `buildLegacyHooks(ctx)` accordingly.
4. Each builder assembles its version-specific `Hooks` record and shares the core domain (`TaskRegistry`, `PolicyResolver`, `Picker`, `StrategyChain`).

Plan Review (v14 only) lives at the **message level** (not per-tool-call) using `experimental.chat.messages.transform`. When the hook fires, it iterates over ALL `task` calls in the message (no minimum threshold), performs a **PolicyResolver lookup** per `agent_name` to determine BG/FG mode, then rewrites the message parts before the host executes tools. No interactive picker, no batch threshold, no blocking during the transform. The user controls routing via: (a) per-agent-type default policy in bg-subagents config, and (b) a session-level `/task policy <bg|fg|default>` slash command set BEFORE sending the prompt. Post-spawn moves remain available via `/task move-bg <id>` (Phase 12). Fallback: per-call path in `tool.execute.before` still exists for legacy (pre-1.14) only — not used in the v14 Plan Review flow.

> **OQ-1 resolved (2026-04-24)**: Candidate 7 (PolicyResolver defaults + slash override) is the v1.0 primary. Interactive picker (Candidates 1–6) is NOT implemented in v1.0. See "Open Questions (Post-Pivot)" section for full resolution details and the rationale for deferring per-entry control (Candidate 6) to v1.1.

Live Control (v14, server-side) is implemented as **slash command interception** — the server plugin intercepts `/task move-bg <id>` and related commands via the `chat.message` hook (or equivalent server-side message handler). There is no Ctrl+B keybind, no sidebar, and no TUI module in v1.0. These are deferred to v1.1 pending a public OpenCode TUI loader.

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

### ADR-2: Plan Review via `experimental.chat.messages.transform` (primary) + per-call path (legacy fallback)

> **Post-OQ-1 amendment (2026-04-24)**: The picker step described in the original ADR-2 rationale is removed for v1.0. The flow is now: `messages.transform` fires → iterate all `task` parts → PolicyResolver lookup per agent → rewrite. No user interaction, no batch threshold, no picker invocation. See OQ-1 resolution in "Open Questions (Post-Pivot)" section. The `PlanPicker` interface is removed from the interceptor contract; `InterceptorContext.picker` is dropped. The env flag `BG_SUBAGENTS_PLAN_REVIEW=batching` still selects the legacy per-call fallback for pre-1.14 hosts.

### ADR-2 (original): Plan Review via `experimental.chat.messages.transform` (primary) + per-call batching (fallback)

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

**Post-spike amendment (EQ-1, 2026-04-23) — CRITICAL idempotency requirement**:

The EQ-1 verification spike on OpenCode 1.14.22 confirmed `messages.transform` fires and mutations reach the LLM payload, BUT also revealed that the hook **fires MULTIPLE times per turn** with a fresh `output.messages` each invocation. Mutations do NOT persist to session history between fires. The `MessagesTransformInterceptor` MUST therefore be **idempotent**: either (a) check for a marker part the interceptor injects on first fire and skip if present, or (b) rebuild the rewrite deterministically from current state each fire. Design choice: marker-based idempotency — inject a hidden `PlanReviewMarker` part on first rewrite, detect-and-return-unchanged on subsequent fires for the same logical batch.

**Implementation shape**:
```typescript
interface PlanInterceptor {
  intercept(parts: Part[]): Promise<{parts: Part[]; decisions: PlanDecision[]}>;
}

class MessagesTransformInterceptor implements PlanInterceptor {
  // v14 primary. MUST be idempotent — see ADR-2 post-spike amendment.
  // Detects PlanReviewMarker part and short-circuits on repeat fires.
}
class BatchingBeforeInterceptor implements PlanInterceptor { /* v14 fallback + legacy */ }
```

Env flag selects implementation; defaults to `MessagesTransformInterceptor` on v14.

### ADR-3: TUI plugin as separate module export (`./tui`) — ~~SUPERSEDED~~ → REACTIVATED

> **STATUS (original): SUPERSEDED by ADR-8 (2026-04-24, Plan D pivot).**
> ADR-3 was preserved as historical record after a runtime spike (TQ-1) using `opencode.json` concluded that the TUI loader rejected `{tui: fn}` exports.
>
> **Post-TQ-1 re-spike (2026-04-24) — ADR-3 REACTIVATED**
>
> The original TQ-1 spike used `opencode.json` as the config file — which routes to the **server plugin loader**, not the TUI plugin loader. The server loader correctly rejects `{tui: fn}` shapes with `"must default export an object with server()"`. This was a configuration mistake, not evidence that TUI loading is impossible.
>
> A subsequent re-spike using `tui.json` (the correct config file for TUI plugins, introduced in anomalyco/opencode PR #19347 on 2026-03-27) confirmed the TUI loader is fully functional in OpenCode 1.14.23+:
>
> ```
> # tui.json (in workspace root or ~/.config/opencode/)
> { "plugin": ["@maicolextic/bg-subagents-opencode/tui"] }
> ```
>
> Evidence from the re-spike runtime log:
> ```
> service=tui.plugin path=... loading tui plugin
> phase=boot meta.id=bg-subagents-spike-tq1
> ```
>
> The `id` field in the TUI plugin's default export was present (`id: "bg-subagents-spike-tq1"`) and the verify log confirmed boot via `meta.id`. See engram topic `sdd/opencode-plan-review-live-control/spike/tq1-runtime-result` for full log evidence.
>
> **ADR-3 is the CURRENT design for v1.0 TUI distribution.** ADR-8's rationale was based on the wrong config file; it is superseded by ADR-9 (see below). The `./tui` subpath export ships in v1.0.

**Original choice**: Ship TUI plugin as `@maicolextic/bg-subagents-opencode/tui` — loaded by user explicitly in `opencode.json` (exact config mechanism TBD — see TQ-1 below).

**Alternatives considered**:
- Bundle TUI plugin into main entry (detect at runtime whether TUI API exists).
- Separate npm package (`@maicolextic/bg-subagents-opencode-tui`).

**Rationale (original)**:
- OpenCode's plugin loader distinguishes `{server}` from `{tui}` module shapes and loads them differently. Exporting both from one module doesn't work — the `PluginModule` type explicitly excludes combining them (`tui?: never` on `PluginModule`).
- A separate subpath export (`"./tui"` in `package.json` `exports`) gives clean separation without a separate npm publish. Both subpaths ship from the same tarball.
- Users on legacy OpenCode just don't include `/tui` in their plugin array; no error. On v14 the user gets both.
- Separate npm package (third alt) doubles maintenance; we reject.

**Post-spike amendment (TQ-1 static, 2026-04-23)**: The TUI plugin auto-discovery path is NOT the same as the server plugin path. Dropping a `TuiPluginModule` file into `~/.config/opencode/plugins/` crashes OpenCode at boot. A runtime API `TuiPluginApi.plugins.add(spec)` exists, but the user-facing config mechanism was still unknown.

**Post-spike amendment (TQ-1 runtime, 2026-04-24) — REFUTATION**: OpenCode 1.14.22's `plugin` array loader rejects `{tui: fn}` default exports with an explicit error: `"must default export an object with server()"`. The module loads, but registration fails. The `./tui` subpath from `@opencode-ai/plugin` has NO external loading mechanism in 1.14.22. This fully refutes the subpath export approach for v1.0. **Decision: pivot to ADR-8.**

### ADR-8: v1.0 is server-side only; TUI plugin deferred to v1.1

**Superseded 2026-04-24 by ADR-9.**

The TUI loader was proven functional in OpenCode 1.14.23+ via `tui.json` (re-spike after TQ-1). ADR-8 was written when we believed the TUI loader was inaccessible — that belief was based on the wrong config file (`opencode.json` instead of `tui.json`). v1.0 scope was subsequently expanded to include the TUI layer (see ADR-9). ADR-8 is preserved below as historical record.

**Choice (historical)**: v1.0 ships as a single-export server-only plugin. TUI features (Ctrl+B keybind, DialogSelect picker, sidebar slot, `./tui` subpath) are removed from v1.0 scope and deferred to v1.1.

**Rationale**:
The TQ-1 runtime spike (2026-04-24) proved that OpenCode 1.14.22's plugin loader cannot load a `{tui: fn}` default export — it demands `{server: fn}` or a `Plugin` function, and rejects TUI-shaped modules with an unambiguous error. There is no discovered workaround. Building a TUI plugin surface for v1.0 under these constraints would mean: (a) shipping code that cannot load at runtime, or (b) investing in a speculative config-field research path with no guarantee of finding a public mechanism before the release gate. Neither is acceptable.

**Why defer vs build-anyway**:
- "Build anyway despite refutation" would require a new spike series to find an alternative TUI registration path, with unknown timeline and no guarantee.
- Deferring to v1.1 explicitly scopes that research as a dedicated effort once/if OpenCode exposes a public TUI loader (the project is active; a v1.15 or later may add it).
- Every feature cut from TUI aligns with the `complement-not-redesign` principle: the plugin stops touching the TUI surface entirely in v1.0 — it cooperates with OpenCode's server extension point exclusively, which is confirmed stable.

**What stays (confirmed viable)**:
- Plan Review via `experimental.chat.messages.transform` (server hook — confirmed GO in EQ-1 spike, Phase 7 shipped, functional in live smoke test).
- All server-side hooks: `experimental.chat.system.transform`, `event`, `tool` registration (Zod 4, v14 shape), completion delivery.
- Full legacy codepath (unchanged).

**What changes**:
- Live Control (`Ctrl+B` → move FG task to BG) is **converted to a slash command**: `/task move-bg <id>`. The server plugin intercepts `/task *` patterns via the `chat.message` hook (or equivalent server-side message handler — exact mechanism is an open question for Phase 8, flagged below). This keeps Live Control functional without any TUI surface.
- Slash commands `/task list`, `/task show`, `/task logs`, `/task kill`, `/task move-bg` are all server-side intercepted in v1.0 — no `api.command.register` call needed.

**What drops (v1.0)**:
- `src/tui-plugin/` directory and all its modules (`live-control.ts`, `plan-review-dialog.ts`, `commands.ts`, `sidebar.ts`, `shared-state.ts`, `index.ts`).
- `./tui` subpath export in `package.json`.
- `SharedPluginState` singleton (no longer needed — commands go through server).
- Phase 11 (Shared State), Phase 12.1-2 (TUI DialogSelect), Phase 12.7 (sidebar), Phase 13 (TUI entry point): all dropped.
- `__tests__/tui-plugin/` test directory: dropped.
- Ctrl+B keybind: dropped.
- `BG_SUBAGENTS_TUI=on|off` feature flag: dropped.

**What defers to v1.1**:
- TUI plugin entirely — pending a public OpenCode TUI loader being discovered or released. Research owner: v1.1 kickoff spike. Trigger: OpenCode changelog shows a `tui.plugin` config field or equivalent public mechanism.

**How this aligns with `complement-not-redesign`**:
This pivot makes the alignment stronger, not weaker. v1.0 was already a complement; this version doubles down by removing ALL TUI surface from scope. The plugin is a "bracito más" — a server-side extension arm that adds background task orchestration without touching OpenCode's UI, layout, or interaction model. Slash commands are the natural server-side Live Control surface: they're text-based, composable, and require zero TUI cooperation from the host.

**Spike evidence**: engram topic `sdd/opencode-plan-review-live-control/spike/tq1-runtime-result` (obs #1235).

### ADR-9: v1.0 includes TUI layer (scope expansion 2026-04-24)

**Choice**: v1.0 scope EXPANDED from server-side only (Plan D / ADR-8) to include the full TUI plugin layer.

**Rationale**:
- User's original vision always included the sidebar + keybinds + task modal UX (the "↓ to manage" interaction pattern native to OpenCode). We deferred under Plan D only because we believed the TUI loader was inaccessible. It is not — `tui.json` unlocks it.
- Baby due July 2026. Target ship v1.0.0 to npm: early June 2026 (~6 weeks from 2026-04-24). TUI layer is estimated at 3–5 additional weeks; it fits the timeline comfortably.
- Nothing already built is wasted: all server-side code (PolicyResolver, rewrite-parts, messages-transform, `/task policy`, `/task list/show/logs/kill/move-bg`) remains necessary and ships as-is. The TUI plugin is purely additive.
- Shipping a complete TUI-native v1.0 makes the gentle-ai PR and the OpenCode docs PR concrete demos — maximizes upstream visibility and community value.
- Users on OpenCode without `tui.json` support (pre-1.14.23) still get full server-side functionality. TUI plugin is opt-in via `tui.json`. No regression for server-only users.

**What is IN v1.0 — TUI layer**:
- Sidebar slot (`api.slots.register` with `sidebar_content`) — live background task list, reads from SharedPluginState, refreshes every 1000ms.
- TUI-native plan review dialog (`api.ui.DialogSelect`) — interactive picker on multi-delegation turns; ADDITIVE on top of PolicyResolver (Candidate 7); does not replace PolicyResolver path.
- Keybinds: `Ctrl+B` (focus BG task panel), `Ctrl+F` (filter tasks), `↓` (select task for detail modal) — registered via `TuiCommand.keybind`.
- Modal for task details (logs, actions, move-bg) — `api.ui.DialogSelect`.
- SharedPluginState via `Symbol.for` globalThis pattern shared between server plugin and TUI plugin.

**What stays server-side-only (also in v1.0)**:
- PolicyResolver + `resolveBatch` — the synchronous `messages.transform` constraint does not permit async TUI picker on every message turn.
- `messages-transform` interceptor — synchronous, server-side.
- `/task policy` slash command — session override for PolicyResolver.
- `/task list`, `/task show`, `/task logs`, `/task kill`, `/task move-bg` — server-side slash commands (still needed; TUI is additive).
- Rewrite-parts, completion messages as markdown cards.

**Why both** (server + TUI): The TUI plugin is additive. Users without `tui.json` (or on legacy OpenCode) still get full server-side orchestration. Users who add `tui.json` get the visual UX on top. The server-side slash commands remain the canonical Live Control interface; the TUI layer provides a richer optional experience.

**Distribution**:
```json
// opencode.json (server plugin — required)
{ "plugin": ["@maicolextic/bg-subagents-opencode"] }

// tui.json (TUI plugin — optional, adds sidebar + keybinds + modals)
{ "plugin": ["@maicolextic/bg-subagents-opencode/tui"] }
```

---

### ADR-4: Move-to-background cancels via `session.abort`, not `tool.cancel`

**Choice**: Use `client.session.abort({ path: { id } })` from the **OpenCode SDK v1** (the client exposed via `PluginInput.client`) for cancelling foreground tasks. `client.tool.cancel` is not exposed in the SDK.

**CRITICAL — SDK version correction (DQ-1, 2026-04-23)**: The plugin runtime's `PluginInput.client` is the **v1 SDK client**, NOT v2. `@opencode-ai/plugin/dist/index.d.ts` imports `createOpencodeClient` from `@opencode-ai/sdk` (DEFAULT entry), which resolves to the v1 `OpencodeClient`. This was discovered empirically when DQ-1's first run failed with `"Invalid string: must start with ses"` — server received literal `{id}` because v1 URL template is `/session/{id}/message` and we had passed v2-shape flat params. **All `client.session.*` calls in this design use v1 shape `{ path: { id }, body: {...}, query?: {...} }` — NOT flat `{ sessionID, ... }`.** If v2 semantics are ever needed (newer experimental endpoints), construct a v2 client explicitly: `import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"; const v2 = createOpencodeClient({ baseUrl: input.serverUrl.toString() })`.

**Alternatives considered**:
- `client.tool.cancel(callID)` — **does not exist in either v1 or v2 SDK**.
- Send a synthetic user message `/task cancel`.
- Kill the Node child process — too invasive.

**Rationale** (verified against `@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` — v1 shapes):
- `session` methods available (v1): `delete, get, update, children, todo, init, fork, **abort**, unshare, share, diff, summarize, messages, prompt, deleteMessage`.
- `client.session.abort({ path: { id } })` terminates in-flight operations on that session. **SQ-1 spike confirmed** the abort propagates to the plugin's `ctx.abort: AbortSignal` within ~1s on OpenCode 1.14.22.
- For subagents we spawned in child sessions (via our `runtime.ts` `session.create`), we can abort the child specifically; main session stays alive.
- If subagent ran in-process without a child session, we cancel via the `AbortSignal` passed to `runOpenCodeSubagent` (pre-existing path in `runtime.ts`).

**Resulting move-bg flow**:
```
1. TaskRegistry.get(taskID).abort()  // signals AbortController
2. client.session.abort({ path: { id: childSessionID } }) // if child session exists — v1 shape
3. Wait up to 3000ms for task to enter `cancelled` state
4. client.session.prompt({
     path: { id: mainSessionID },
     body: {
       noReply: true,
       parts: [{ type: "text", text: "<synthetic task_bg invocation>" }]
     }
   })
   // DQ-1 confirmed: creates a user turn visible in transcript, does NOT trigger auto LLM reply.
5. Toast: "Task moved to background. ID: <new>. Progress lost. /task list"
```

**DQ-1 resolution**: `client.session.prompt({ path: { id }, body: { noReply: true, parts: [...] } })` is the verified mechanism for step 4. Timing caveat: if the LLM is mid-turn when `noReply:true` fires, the synthetic user turn lands in the transcript and may become the "last user message" — Plan Review + move-bg must choose whether synthetic deliveries land pre-LLM or post-LLM consistently.

### ADR-5: Zod 4 for v14 tool registration, Zod 3 for internal protocol

**Choice** (REVISED post-spike, 2026-04-23 — ZQ-1): Import `z` directly from `@opencode-ai/plugin/tool` (which re-exports the bundled **Zod 4.1.8**) for v14 tool registration in `packages/opencode/src/host-compat/v14/`. Keep `zod@3.25.76` in `packages/protocol` for internal contract validation. No shim, no conversion layer, no third Zod install.

**Original choice (SUPERSEDED)**: "Keep zod@3 + zod-to-json-schema bridge. Publish a Zod 4 shim package if runtime rejected Zod 3 shapes." This plan assumed we had to avoid Zod 4 ourselves. ZQ-1 confirmed the plugin SDK already bundles Zod 4.

**Alternatives considered**:
- Upgrade `packages/protocol` to Zod 4 — breaks all consumers of `@maicolextic/bg-subagents-protocol@1.0.0`; unnecessary when v14-only code can import Zod 4 from the plugin SDK instead.
- Install `zod@4` in `packages/opencode` — redundant with the bundled version; risks version drift between our install and the SDK's bundle.
- Keep the shim bridge — unnecessary complexity now that Zod 4 ships inside the plugin SDK.

**Rationale**:
- `@opencode-ai/plugin/tool` bundles and re-exports Zod 4.1.8 as part of its public surface. Importing from there guarantees shape compatibility with the host's `ToolDefinition.args` validation regardless of what's installed in our node_modules.
- `packages/protocol` has zero OpenCode coupling — its Zod 3 schemas validate `bg-subagents` internal contracts (TaskDefinition, ProgressEvent, CompletionEvent). Keeping Zod 3 there preserves compatibility with any external consumer of `@maicolextic/bg-subagents-protocol`.
- Legacy (`host-compat/legacy/`) continues to use `zod-to-json-schema` for its existing JSON Schema tool registration path. No change there.
- Dependency discipline: `packages/opencode` declares `@opencode-ai/plugin` as a peer/dev dep but does NOT declare `zod` — the Zod instance comes transitively through the plugin SDK import.

**Implementation**:
```typescript
// packages/opencode/src/host-compat/v14/tool-register.ts
import { z } from "@opencode-ai/plugin/tool"; // Zod 4 bundled

export const taskBgArgs = z.object({
  subagent_type: z.string(),
  prompt: z.string(),
  // ...
});
```

**ZQ-1 resolution**: Confirmed at type level that `@opencode-ai/plugin/tool` re-exports Zod 4, and `packages/opencode` compiles cleanly against it. No runtime failure path remaining for Zod shape — the original risk is eliminated by using the SDK's own bundled instance.

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

> **OQ-1 resolved (2026-04-24)**: No interactive picker in v1.0. PolicyResolver lookup replaces the picker step. Session-level override via `/task policy <bg|fg|default>` (set before the prompt turn). Per-entry interactive control deferred to v1.1.

```
┌────────┐    1. LLM responds    ┌────────────────────────────┐
│  LLM   │─────────────────────→ │  experimental.chat.        │
└────────┘  (N task tool calls)  │  messages.transform hook   │
                                 └──────────┬─────────────────┘
                                            │ 2. iterate ALL task parts
                                            │    (no batch threshold)
                                            ▼
                                 ┌────────────────────────────┐
                                 │  for each task call:       │
                                 │  resolver.resolve(         │
                                 │    agentName,              │
                                 │    sessionOverride?        │
                                 │  ) → PolicyDecision        │
                                 │  (checks session-level     │
                                 │   /task policy override    │
                                 │   first, then per-agent    │
                                 │   config default)          │
                                 └──────────┬─────────────────┘
                                            │ 3. decisions: PolicyDecision[]
                                            ▼
                                 ┌────────────────────────────┐
                                 │  rewriteParts(decisions)   │
                                 │  - background → task_bg    │
                                 │  - foreground → unchanged  │
                                 └──────────┬─────────────────┘
                                            │ 4. output.messages mutated
                                            ▼
                                 ┌────────────────────────────┐
                                 │  OpenCode executes         │
                                 │  rewritten tool calls      │
                                 └────────────────────────────┘
```

**Policy config example** (in bg-subagents config):
```json
{
  "policy": {
    "sdd-explore": "background",
    "sdd-apply":   "foreground",
    "sdd-verify":  "background",
    "*":           "background"
  }
}
```

**Session-level override** (slash command, set BEFORE prompt turn):
```
/task policy bg       → all task calls this turn → background
/task policy fg       → all task calls this turn → foreground
/task policy default  → revert to per-agent config defaults
```

### Live Control — Move to Background (v14, server-side slash command)

> **Plan D pivot (ADR-8)**: Ctrl+B keybind and TUI DialogConfirm are dropped in v1.0. Live Control is implemented as server-side slash command interception.

```
User types /task move-bg <id> in the OpenCode chat
     │
     ▼
┌─────────────────────────────────────┐
│  Server plugin message interceptor  │
│  (chat.message hook or equivalent)  │
│  Detects /task move-bg <id> pattern │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Validate: task <id> exists in      │
│  registry, is running, mode=fg      │
│  If not → reply with error text     │
└──────────────┬──────────────────────┘
               │ valid
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
│  5. Reply: "Moved to BG. ID=new-id" │
└─────────────────────────────────────┘
```

**⚠ Open Question (for Phase 8)**: The exact server-side hook for intercepting user-typed slash commands is not yet confirmed. See "Open Questions" section below.

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
│  │ PRIMARY (v1 SDK shape):     │    │
│  │ client.session.prompt({     │    │
│  │   path: { id: sessionID },  │    │
│  │   body: {                   │    │
│  │     noReply: true,          │    │
│  │     parts: [{               │    │
│  │       type: "text",         │    │
│  │       text: completionMsg   │    │
│  │     }]                      │    │
│  │   }                         │    │
│  │ })                          │    │
│  └─────────────────────────────┘    │
│                                     │
│  On Promise resolve:                │
│    registry.markDelivered(id)       │
│    cancel fallback timer            │
│                                     │
│  On Promise reject OR timeout:      │
│  ┌─────────────────────────────┐    │
│  │ FALLBACK (after 2000ms):    │    │
│  │ retry client.session.prompt │    │
│  │ with same v1 shape (diff    │    │
│  │ markDelivered guard)        │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Amendment (DQ-1, 2026-04-23)**: Primary delivery is now `client.session.prompt({ path: { id }, body: { noReply: true, parts: [...] } })` — v1 SDK shape, verified live on OpenCode 1.14.22. The earlier design referenced `client.session.message.create(...)` as primary; that method exists on v2 but NOT v1, and the plugin runtime gives us v1. Both primary and fallback now use the same method with the same shape — dedupe via `registry.markDelivered(id)` is unchanged.

### Completion Delivery (legacy)

Unchanged from v0.1.4: `bus.emit("bg-subagents/task-complete", ...)` → `onDelivered(id)` → cancel 2000ms fallback timer → fallback uses `session.writeAssistantMessage`.

### Diagnostic Log Routing (all paths)

Per the Zero Visual Pollution constraint (see Non-Functional Requirements), ALL internal diagnostic output follows this routing:

```
┌──────────────────────────────────────────────────────┐
│  plugin code (event-handler, delivery, index, etc.)  │
│  logger.debug("v14-event", { event_type: ... })      │
└─────────────────────┬────────────────────────────────┘
                      │
          ┌───────────┴────────────┐
          │                        │
          ▼ (default, prod)        ▼ (BG_SUBAGENTS_DEBUG=true only)
┌──────────────────┐    ┌───────────────────────────────┐
│  log file        │    │  stderr (NOT stdout)           │
│  ~/.opencode/    │    │  development visibility only   │
│  logs/           │    └───────────────────────────────┘
│  bg-subagents.   │
│  log             │
└──────────────────┘

stdout ← NOTHING from bg-subagents in production
         (only user-visible markdown cards via
          client.session.prompt noReply path)
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/opencode/package.json` | Modify | Version 0.1.4 → 1.0.0. Add `zod-to-json-schema` dep (runtime). Add `./tui` subpath export (ADR-9 rescues TUI layer). |
| `packages/opencode/src/plugin.ts` | Modify | Entry becomes routing shim; exports single `Plugin` function. Delegates to compat layer. |
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
| `packages/opencode/src/plan-review/batch-detector.ts` | Create | `detectBatch(messageParts): BatchEntry[]`. Iterates ALL task parts — no minimum count threshold (OQ-1 resolution). |
| ~~`packages/opencode/src/plan-review/plan-picker.ts`~~ | ~~Create~~ | **DROPPED (OQ-1 resolution, 2026-04-24)** — No interactive picker in v1.0. PolicyResolver batch decision replaces picker output. Deferred to v1.1 if per-entry control via TUI DialogSelect becomes available. |
| `packages/opencode/src/plan-review/rewrite-parts.ts` | Create | `rewriteParts(parts, decisions): Part[]`. Takes `PolicyDecision[]` from PolicyResolver (not picker output). |
| `packages/opencode/src/plan-review/types.ts` | Create | `BatchEntry`, `PolicyDecision`, `PlanInterceptor` interface. `PlanPicker` interface removed (OQ-1 resolution). |
| `packages/opencode/src/tui-plugin/` | Create | **RESCUED (ADR-9, 2026-04-24)** — TUI plugin IN v1.0. Includes `shared-state.ts`, `plan-review-dialog.ts`, `sidebar.ts`, `commands.ts`, `index.ts`. |
| `packages/opencode/src/host-compat/v14/slash-commands.ts` | Create | Server-side `/task *` slash command interceptor. Handles `list`, `show`, `logs`, `kill`, `move-bg`. |
| `packages/opencode/src/strategies/OpenCodeTaskSwapStrategy.ts` | Modify | Consult host version from host_context. |
| `packages/opencode/src/runtime.ts` | Modify | Support v14 `client.session.*` API alongside legacy `session.create/prompt`. |
| `packages/opencode/src/__tests__/host-compat/` | Create | Tests for version detection + both builder paths. |
| `packages/opencode/src/__tests__/plan-review/` | Create | Tests for batch detector, picker, rewrite. |
| `packages/opencode/src/__tests__/tui-plugin/` | Create | **RESCUED (ADR-9, 2026-04-24)** — TUI plugin tests back in v1.0. Covers shared-state, plan-review-dialog, sidebar slot. |
| `packages/opencode/src/__tests__/host-compat/v14/slash-commands.test.ts` | Create | Tests for server-side slash command interceptor. |
| `packages/opencode/src/__tests__/integration/v14-plan-review.test.ts` | Create | End-to-end v14 with mocked OpencodeClient. |
| `packages/opencode/src/__tests__/integration/live-control.test.ts` | Create | End-to-end `/task move-bg <id>` via server-side message interception. |
| `packages/opencode/src/__tests__/integration/opencode-adapter.test.ts` | Modify | Update to exercise compat routing. |
| `packages/opencode/README.md` | Modify | Fix `plugins` → `plugin`. Document single main export. Describe Plan Review + slash command Live Control UX. Migration note. |
| `docs/architecture.md` | Modify | Updated component diagram with compat layer. |
| `docs/migration-v0.1-to-v1.0.md` | Create | Migration guide for existing users. |
| `docs/skills/bg-subagents/SKILL.md` | Modify | Update for v1.0 UX and correct field names. |
| `docs/upstream/gentle-ai-pr.md` | Modify | Refine with v1.0 feature list and demo placeholder. |
| `.changeset/` | New changeset file | Major bump on `-opencode`; patch on `-core` if interface additions. |

**Summary**: ~13 new files, ~10 modified, ~5 moved/deleted. (ADR-8 drops ~6 TUI files from the original count.)

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
  // picker removed — OQ-1 resolved (2026-04-24): no interactive picker in v1.0.
  // PolicyResolver.resolveBatch() replaces picker output entirely.
  readonly logger?: Logger;
}
```

### ~~TUI plugin shared state~~ (DROPPED — ADR-8)

> `src/tui-plugin/shared-state.ts` is not shipped in v1.0. No shared state is needed when all Live Control commands go through the server plugin.

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

> **ADR-9 (2026-04-24)**: TUI subpath export RESTORED. Both main and `./tui` subpaths ship in v1.0. The `./tui` subpath is loaded via `tui.json` (NOT `opencode.json`) — see ADR-3 reactivation and the Plugin Loader Contract section for the `id` field requirement.

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

## Non-Functional Requirements

### Zero visual pollution (hard constraint)

**Rule**: bg-subagents MUST emit ZERO output to stdout during normal production operation. Any raw JSON, structured log line, or diagnostic print that reaches stdout is a critical defect — it corrupts the OpenCode TUI and violates the `complement-not-redesign` principle. This was surfaced by user feedback from a screenshot showing raw JSON blobs like `{"ts":...,"level":"info","msg":"v14-event","event_type":"session.idle",...}` polluting the OpenCode CLI. User's exact verdict: "unacceptable before v1.0 ships."

See engram topic `preference/zero-cli-pollution` for the original feedback context and the specific screenshot evidence.

**Where user-visible content MAY appear**: ONLY via `messages.transform` injecting clean markdown cards through `client.session.prompt({ ..., body: { noReply: true, parts: [...] } })`. The markdown card format is the sole permitted user-visible channel. No raw text, no JSON, no structured logs in chat output.

**Debug opt-in**: `BG_SUBAGENTS_DEBUG=true` enables stdout diagnostic output **exclusively for local development**. When this env var is unset (the default, and always the case in installed/production use), all diagnostic output MUST be suppressed from stdout. Debug mode MUST NOT be enabled in CI or in published npm packages.

**Log file target**: All diagnostic messages (info, debug, warn, error) route to a log file. Cross-platform path resolution:

```
Unix/macOS:  ~/.opencode/logs/bg-subagents.log
Windows:     %APPDATA%\opencode\logs\bg-subagents.log  (resolved via os.homedir() + platform check)
Override:    BG_SUBAGENTS_LOG_FILE=<absolute-path>     (escape hatch for CI or custom setups)
```

Resolution order: `BG_SUBAGENTS_LOG_FILE` env var → platform-default path. The `createLogger` factory resolves the path once at boot and holds the file descriptor for the process lifetime.

**Centralized logger contract** (`packages/core/src/logger.ts`):

```typescript
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): Logger;
```

- All methods route to the log file in production (one JSON-line per call with `ts`, `level`, `ns`, `msg`, `meta`).
- When `BG_SUBAGENTS_DEBUG=true`, methods additionally write to stderr (NOT stdout) so the terminal can show them without corrupting TUI stdout.
- `debug()` is a strict no-op when `BG_SUBAGENTS_DEBUG` is unset — zero overhead in production.
- Existing `console.log`, `console.error`, and any direct `process.stdout.write` calls in the plugin codebase MUST be replaced with logger calls. See the stdout sweep tasks in Phase 7.5.

**Error handling policy**:

- Non-critical errors (delivery retry, event parsing failure, slash command parse error): log to file silently. Never surface in stdout.
- Critical, user-actionable errors (plugin boot failure, registry corruption, task spawn failure): surface via a markdown card injected through `client.session.prompt` — NEVER via a raw `console.error` or stdout dump.
- Format for critical error card:
  ```
  **[bg-subagents] Error**: <short description>.
  Check `~/.opencode/logs/bg-subagents.log` for details.
  ```

**Log file behavior**:

- File is created on first write if it does not exist. Parent directory is created if missing.
- Append-only. No automatic rotation in v1.0 (deferred to v1.1 if log size becomes a concern).
- On file-open failure, the plugin continues operating (task orchestration still works) and falls back to stderr-only logging with a single one-time warning on stderr.

**Files implementing this constraint**:
- `packages/core/src/logger.ts` — centralized logger (new file, Phase 7.5)
- `packages/opencode/src/host-compat/v14/event-handler.ts` — replace `console.log` with `logger.debug`
- `packages/opencode/src/host-compat/v14/index.ts` — replace `plugin:booted` log
- `packages/opencode/src/host-compat/v14/delivery.ts` — replace `delivery:primary-*` logs
- `packages/opencode/src/host-compat/legacy/*` — same discipline for all legacy codepath files

### Portability (hard constraint)

**Rule**: The plugin must work identically on Windows, Linux, and macOS. ZERO hardcoded paths, zero assumptions about any specific user's machine or directory layout. All paths MUST be resolved via Node APIs (`os.homedir()`, `path.join()`). Any hardcoded path (e.g., `C:/SDK/...`, `/home/...`, `/Users/...`) in production code is a critical defect.

**Config storage**: End-user configuration lives embedded in `opencode.json` under the key `bgSubagents`. No extra config files, no environment setup beyond what is listed below. Plugin falls back to internal defaults if the key is absent — a minimum-viable install has zero required config.

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"],
  "bgSubagents": {
    "policy": {
      "*": "background"
    }
  }
}
```

**Log file paths**: Use `path.join(os.homedir(), ".local", "share", "opencode", "logs", "bg-subagents.log")` on all platforms. This path is cross-platform verified: OpenCode itself stores its database at `~/.local/share/opencode/opencode.db` on Windows via Bun (confirmed in smoke test output). Using `path.join()` — never string concatenation with `/` or `\` — ensures correct separators on every OS.

**Env vars**: `BG_SUBAGENTS_*` prefix for all feature flags and overrides (e.g., `BG_SUBAGENTS_DEBUG`, `BG_SUBAGENTS_LOG_FILE`, `BG_SUBAGENTS_FORCE_COMPAT`, `BG_SUBAGENTS_PLAN_REVIEW`). OS-neutral naming — no platform-specific variable conventions.

**Installation story (minimum viable)**:

```bash
npm install @maicolextic/bg-subagents-opencode
```

Add to `opencode.json`:

```json
{
  "plugin": ["@maicolextic/bg-subagents-opencode"]
}
```

Nothing else required. No global config files, no environment variable setup, no post-install scripts, no manual directory creation.

**Dev-only exceptions (NEVER shipped to end users)**:

- `scripts/spike-*/` folders — Michael's local spike workspace. These may reference `C:/SDK/bg-subagents/` or other machine-specific paths. They are never published.
- `~/.config/opencode/plugins/bg-subagents.ts` dev shim — hardcodes `file:///C:/SDK/bg-subagents/packages/opencode/src/plugin.ts` for local development link. This is Michael's personal dev setup and explicitly out of scope for distribution. It is never included in the npm package.

The distinction between dev-only tools and production-distributed code MUST remain unambiguous. Any file that references a machine-specific path must live under `scripts/` or be explicitly documented as a dev-only artifact excluded from the published tarball.

**Reference**: engram topic `preference/portability-hard-constraint` (obs #1248) for full context, rationale, and Gentle-AI integration notes.

---

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `detectHostVersion(ctx)` with hand-crafted ctx objects | Vitest table-driven tests. Cover: legacy ctx, v14 ctx, partial ctx, env override, unknown |
| Unit | `batch-detector.ts` — various message parts | Table-driven: 0, 1, 2, 3+ task calls, mixed with non-task, re-entry (task_bg). No minimum threshold (OQ-1 resolution). |
| Unit | `rewrite-parts.ts` — decision → parts transformation | For each decision kind: foreground unchanged, background swapped. Skip decision removed (no picker = no skip path in v1.0). |
| ~~Unit~~ | ~~`plan-picker.ts` — clack fallback renders and resolves~~ | **DROPPED (OQ-1 resolution, 2026-04-24)** — No interactive picker in v1.0. |
| Unit | PolicyResolver batch mode — per-agent config + session override | Table-driven: agent name matches config key, wildcard fallback, session override wins |
| Unit | `/task policy` slash command — session override sets and clears | Assert session state mutated; PolicyResolver honors override on next turn |
| Unit | `delivery.ts` (v14) — primary + fallback paths | Mock `OpencodeClient`, assert single-delivery dedupe |
| ~~Unit~~ | ~~`tui-plugin/live-control.ts`~~ | **DROPPED (ADR-8)** — No TUI plugin in v1.0 |
| ~~Unit~~ | ~~`tui-plugin/commands.ts`~~ | **DROPPED (ADR-8)** — No TUI plugin in v1.0 |
| Unit | `host-compat/v14/slash-commands.ts` — server-side interceptor | Mock message hook; assert `/task list|show|logs|kill|move-bg` patterns parsed + dispatched |
| Integration | `buildV14Hooks` wiring — mocked ctx | Assert all hooks registered, correct types, plugin:booted log emitted |
| Integration | `buildLegacyHooks` wiring — mocked ctx | Parity with existing v0.1.4 behavior (regression suite) |
| Integration | v14 Plan Review E2E | Fake `experimental.chat.messages.transform` trigger with 3 task calls → PolicyResolver assigns BG/FG per agent_name → assert parts rewritten per policy decisions (no picker) |
| Integration | v14 Live Control E2E | Fake message hook with `/task move-bg <id>` input → assert cancel + re-spawn flow completes |
| Integration | v14 Completion Delivery | Fake `OpencodeClient.session.message.create` → assert primary fires, fallback cancelled |
| Regression | Existing 432 vitest tests | Must remain green after refactor (move to `host-compat/legacy/` paths) |
| Manual | Real OpenCode 1.14.21 on user's machine | E2E validation before publish: install local, run sdd-orchestrator, verify Plan Review + Live Control |
| Manual | Real OpenCode <1.14 (if accessible) | Validate legacy codepath if/when we find a legacy binary |
| CI | Cross-platform path correctness | Test suite MUST pass on `ubuntu-latest` AND `windows-latest` GitHub Actions runners (macOS optional but nice-to-have). Any test that constructs filesystem paths MUST use `path.join()` / `os.homedir()` — never string concatenation of `/` or `\`. |

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
- Upgrade to `v1.0.0` — plugin works for the first time. Plan Review + slash command Live Control available.
- Single entry in `opencode.json` (no `/tui` subpath needed):
  ```json
  {"plugin": ["@maicolextic/bg-subagents-opencode"]}
  ```
- Migration guide at `docs/migration-v0.1-to-v1.0.md`.

### Feature flags for rollout

- `BG_SUBAGENTS_FORCE_COMPAT=legacy|v14` — override detection.
- `BG_SUBAGENTS_PLAN_REVIEW=messages-transform|batching|off` — pick Plan Review impl.
- ~~`BG_SUBAGENTS_TUI=on|off`~~ — **DROPPED (ADR-8)**. No TUI plugin in v1.0.

No phased rollout needed (no user data migration).

---

## Plugin Loader Contract (post-spike, 2026-04-23)

Three non-obvious rules from the OpenCode 1.14.22 plugin loader, discovered during Phase 1 spikes. Any new plugin file in this package MUST honor them:

1. **Default export must be a FUNCTION (the `Plugin` type), not a `PluginModule` object.** Despite `@opencode-ai/plugin` exporting both types, the loader rejects object-shaped default exports with `"Plugin export is not a function"`. Reference pattern: `~/.config/opencode/plugins/engram.ts` uses `export const Engram: Plugin = (input) => { ... }` and loads fine. Anti-pattern: `export default { id, server }` fails.

2. **Auto-discovery matches `.ts` ONLY, top-level ONLY** at `~/.config/opencode/plugins/`. Not `.mjs`, not `.js`, not recursive. Helper files and spike scripts in that directory that are NOT plugins MUST use a `.mjs` extension to avoid being mis-loaded as plugins on every boot.

3. **TUI plugins use a SEPARATE loader** — NOT the main plugin dir. Dropping a `TuiPlugin` file into `~/.config/opencode/plugins/` crashes OpenCode at boot (`TypeError: undefined is not an object (evaluating 'f.auth')`). The `plugin` array in `opencode.json` also rejects `{tui: fn}` exports with `"must default export an object with server()"` (confirmed in TQ-1 runtime spike, 2026-04-24). **This refuted ADR-3 and triggered ADR-8 (Plan D pivot).** The `./tui` subpath is NOT shipped in v1.0. A runtime API `TuiPluginApi.plugins.add(spec)` exists; the config-based TUI loading path remains unknown and is deferred to v1.1 research.

These rules are invariants for the plugin and for any spike scripts we deploy during development.

**TUI plugin runtime requires `id` field**

The SDK type `TuiPluginModule.id?: string` declares `id` as optional. However, the TUI plugin runtime loader in OpenCode 1.14.23 throws `TypeError: Path plugin ... must export id` if the `id` field is absent from the default export. The runtime enforces `id` as REQUIRED despite the type permitting its omission.

**Rule**: Always include `id: string` in the default export of any TUI plugin:

```typescript
export default {
  id: "bg-subagents-tui",   // REQUIRED at runtime, even though type says optional
  tui: TuiPlugin,
};
```

This is a candidate for the OpenCode docs PR (see `docs/upstream/opencode-docs-pr.md`): the type vs runtime mismatch should be documented or fixed upstream (either make `id: string` required in the type, or make the runtime tolerant of missing `id` by generating a uuid fallback).

**SharedPluginState — Symbol.for globalThis pattern**

The TUI plugin and the server plugin share the same Bun process (single runtime). They can share in-memory state without HTTP round-trips or module-graph assumptions via a well-known globalThis symbol:

```typescript
// Server plugin — sets at boot in buildV14Hooks
const STATE_KEY = Symbol.for("@maicolextic/bg-subagents/shared");
(globalThis as any)[STATE_KEY] = {
  registry: taskRegistry,
  policyStore: policyStore,
  // ...other shared refs
};

// TUI plugin — reads at boot in tui-plugin/index.ts
const STATE_KEY = Symbol.for("@maicolextic/bg-subagents/shared");
const shared = (globalThis as any)[STATE_KEY];
// shared.registry, shared.policyStore available directly
```

`Symbol.for(key)` is process-global and key-based — the same string key resolves to the same Symbol across any module boundary. Both plugins will get the same Symbol instance without importing from each other.

**Plan B** (if processes are ever separated in a future OpenCode architecture): the existing server client query via `api.client` (already in the design for DQ-1) is the fallback. The SharedPluginState singleton is preferred for v1.0 because it has zero latency and no IPC overhead.

---

## Open Questions

All spike-gated questions resolved during Phase 1 (2026-04-23). Two defer to later phases.

- [x] **ZQ-1 RESOLVED (GO, 2026-04-23)** — Plugin SDK bundles Zod 4.1.8 at `@opencode-ai/plugin/tool`. No shim needed. Original plan (zod@3 + conversion layer) superseded; see ADR-5.
- [x] **EQ-1 RESOLVED (GO, 2026-04-23, commit b061006)** — `experimental.chat.messages.transform` fires per-turn and mutations reach the LLM payload (LLM Thinking confirmed mutated text was received; UI shows original). Caveat: hook fires **multiple times per turn with fresh `output.messages`**; mutations do NOT persist to session history. ADR-2 amended with idempotency requirement.
- [x] **SQ-1 RESOLVED (GO, 2026-04-23, commit 0258072)** — `client.session.abort({ path: { id } })` propagates to the plugin's `ctx.abort: AbortSignal` within ~1s on OpenCode 1.14.22. v1 SDK shape required.
- [x] **DQ-1 RESOLVED (GO, 2026-04-23, commit 2ffe45c)** — `client.session.prompt({ path: { id }, body: { noReply: true, parts: [...] } })` creates a user turn in the session transcript **without triggering an auto assistant reply**. Requires v1 SDK shape (NOT flat `{ sessionID }`). See ADR-4 amendment for the critical v1-vs-v2 note.
- [x] **TQ-1 RESOLVED (NO-GO, 2026-04-24)** — TUI plugin cannot be loaded by OpenCode 1.14.22 via either auto-discovery dir or `opencode.json` `plugin` array. Both reject `{tui: fn}` exports. This refutes ADR-3 and triggers ADR-8 (Plan D). TUI plugin deferred to v1.1. Evidence: engram #1235, topic `sdd/opencode-plan-review-live-control/spike/tq1-runtime-result`.
- [ ] **MQ-1 DEFERRED to Phase 16 manual E2E** — cross-minor consistency (1.14.20 ↔ 1.14.22) validated during manual end-to-end gating before release.

---

## Open Questions (Post-Pivot, v1.0)

### OQ-1: How does the server plugin prompt the user for BG/FG/Skip decisions without TUI DialogSelect?

**STATUS: RESOLVED — 2026-04-24**
**Verdict: PRIMARY = Candidate 7 (PolicyResolver defaults + slash command override). FALLBACK = Candidate 6 (async chat injection) — documented but NOT implemented in v1.0, deferred to v1.1.**

**Spike evidence**: engram topic `sdd/opencode-plan-review-live-control/oq-1/question-raise-research` (obs #1237). Type-level exhaustive research confirmed Candidate 3 (native `QuestionRequest`) is architecturally impossible from a server plugin in OpenCode 1.14.22.

---

**Why Candidate 3 is impossible** (type-level spike, 2026-04-24):

- `PluginInput.client` is the **v1 `OpencodeClient`** from `@opencode-ai/sdk`. It has zero `question` surface — not present in v1 types at all.
- The v2 SDK has a `Question` class (`list`, `reply`, `reject`), but **no create/raise endpoint**. `QuestionRequest` is fired internally by OpenCode when the AI assistant calls an internal tool during an LLM turn — external plugins cannot create one.
- `QuestionRequest.tool?: { messageID, callID }` proves it is tied to a real LLM tool call, not an external API call.
- `EventQuestionAsked` flow: OpenCode server fires internally → TUI `TuiState.question()` reads session state → TUI renders modal → user answers → client calls `/question/{id}/reply`. A server plugin in `messages.transform` has no entry point into this chain.
- A server plugin cannot block the `messages.transform` hook waiting for an async question reply — it would deadlock the message pipeline.

**Why Candidate 7 over Candidate 6** (acceptance decision, Michael, 2026-04-24):

- Candidate 6 (async chat injection) — inject a synthetic assistant message asking "BG or FG?", parse user's next text reply — is architecturally viable but adds a full LLM round-trip per plan-review turn, corrupts the conversation flow, and is hard to test reliably. Complexity does not justify the marginal gain for v1.0.
- Candidate 7 (PolicyResolver defaults) is zero interactive overhead, zero blocking, and leverages the existing `PolicyResolver` primitive that was already in the design. It fits `complement-not-redesign` better than any alternative: the plugin stays silent during the transform and applies config-driven intent.
- Per-entry interactive control (Candidate 6) is deferred to v1.1, where it can be done properly via TUI DialogSelect if/when OpenCode exposes a public TUI loader.

**Resolved mechanism — Candidate 7 (v1.0 implementation)**:

1. **PolicyResolver per-agent default modes** — configured in bg-subagents config under `policy` key. Syntax:
   ```json
   {
     "policy": {
       "sdd-explore": "background",
       "sdd-apply":   "foreground",
       "sdd-verify":  "background",
       "sdd-tasks":   "background",
       "*":           "background"
     }
   }
   ```
   PolicyResolver resolves `agentName → "background" | "foreground"`. Wildcard `"*"` is the catch-all default. The `PolicyResolver.resolveBatch(entries[])` method (new or extended) returns `PolicyDecision[]` for the full set of task calls in one step.

2. **Slash command `/task policy <bg|fg|default>`** — sets a session-level override that PolicyResolver honors for the NEXT turn's `messages.transform` invocation. Syntax:
   - `/task policy bg` — all task calls next turn → background (regardless of per-agent config)
   - `/task policy fg` — all task calls next turn → foreground
   - `/task policy default` — clear override; revert to per-agent config defaults
   
   Mechanism: intercept in the server-side message hook (same interceptor as Phase 12 slash commands). Store override in a session-scoped map (keyed by session ID). PolicyResolver reads this map before per-agent config lookup.

3. **Post-spawn `/task move-bg <id>`** — already in Plan D Phase 12. Allows moving a specific foreground task to background after it has started. Not part of Plan Review proper.

4. **NO picker, NO prompt, NO blocking during `messages.transform`** — the hook fires, iterates all task parts, calls PolicyResolver, rewrites, returns. Total overhead: O(N) PolicyResolver lookups, all synchronous or fast-async.

**Deferred (v1.1)**: Per-entry interactive control (Candidate 6 async chat injection or TUI DialogSelect picker). Trigger for v1.1 research: OpenCode changelog shows `tui.plugin` config field or equivalent public TUI loader. At that point, a real multi-option picker can replace the PolicyResolver lookup step without changing the `messages.transform` interception layer.

**Amendment 2026-04-24**: Candidate 7 (PolicyResolver + slash overrides) remains the PRIMARY path for server plugin `messages.transform` context — the synchronous constraint is unchanged; a server plugin cannot block the transform hook waiting for user input. The TUI plugin path (ADR-9 scope expansion) can OPTIONALLY offer a richer interactive picker via `api.ui.DialogSelect` for multi-delegation turns — documented in Phase 12.1/12.2 rescued tasks. Both paths coexist: the TUI picker is ADDITIVE and triggers on turns where the user is actively watching the TUI; the PolicyResolver path handles all other cases silently. The TUI picker does NOT replace PolicyResolver — it supplements it for interactive sessions.

---

**Original candidates list** (for historical reference):

1. ~~`@clack/prompts` inline~~ — TUI owns terminal; concurrent writes corrupt render. Not viable without isolated terminal access.
2. ~~`PermissionRequest` raise~~ — binary allow/deny only; insufficient for 3-choice (BG/FG/Skip). Also no confirmed API from server plugin.
3. ~~`QuestionRequest` (Candidate 3)~~ — **IMPOSSIBLE**. No raise endpoint in v1 or v2 SDK. Tied to internal LLM tool calls only. (Engram #1237.)
4. ~~Custom LLM message injection via `messages.transform`~~ — adds LLM round-trip, corrupts flow.
5. ~~Non-interactive PolicyResolver fallback~~ — this is now Candidate 7 (the primary, not a "last resort").
6. **Async chat injection** — documented, NOT implemented in v1.0. Deferred to v1.1.
7. **PolicyResolver defaults + slash override** — CHOSEN PRIMARY for v1.0.

**Spike evidence**: `docs/opencode-1.14-verification.md`. Engram #1237 (OQ-1 type-level research). Engram #1236 (Plan D acceptance).

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
