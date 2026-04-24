# Exploration: OpenCode plugin API migration + Plan Review + Live Control

## Current State

### Plugin architecture (existing, v0.1.4)

`@maicolextic/bg-subagents-opencode@0.1.4` ships a **server plugin** that hooks into OpenCode via `plugin.server(ctx)` and registers:

| Hook | Purpose | File |
|---|---|---|
| `tool: [task_bg]` | Register new `task_bg` tool | `hooks/tool-register.ts` |
| `tool.execute.before` | Intercept every `task` call → show picker → swap to `task_bg` on BG | `hooks/tool-before.ts` |
| `chat.params` | Inject system addendum advertising `task_bg` | `hooks/chat-params.ts` |
| `event` (bus) | Re-publish completion events to host bus | `hooks/event.ts` |
| `chat.message` fallback | 2s ack timeout → synthetic assistant message | `hooks/chat-message-fallback.ts` |

Internal domain (pure in `@maicolextic/bg-subagents-core`): `TaskRegistry`, `HistoryStore`, `PolicyResolver`, `Picker`, `StrategyChain` with 4 fallback strategies.

### Verified bugs against OpenCode 1.14.20+

Tested today (2026-04-23) in user's real OpenCode setup. Observed:

1. **`plugin:booted` log appears** — plugin DOES load and register
2. **`bus-events:no-bus` warning** — `ctx.bus` is NOT present in OpenCode 1.14 server plugin ctx
3. **`tool.execute.before` hook is never invoked** — verified via `fs.appendFileSync` debug marker, file never written despite multiple subagent delegations
4. **`task_bg` tool appears in LLM's tool list** but with nonsense identifier `functions.0` — indicates the ToolDefinition shape is partially consumed (description passes through) but not fully valid

## Affected Areas

### Current plugin code (all refactor candidates)

- `packages/opencode/src/plugin.ts` — main entry; wires all 5 hooks. MUST detect host API version and branch.
- `packages/opencode/src/types.ts` — **local mirror of OpenCode hook types**; currently models legacy API (`tool_name`, `tool_input`, return `{continue}` objects). MUST support both shapes.
- `packages/opencode/src/hooks/tool-register.ts` — returns `{name, description, parameters (JSON Schema), execute}`. New API requires `{description, args (Zod), execute}` + key from object.
- `packages/opencode/src/hooks/tool-before.ts` — reads `input.tool_name` / `input.tool_input`; returns `{continue, deny_reason}`. New API: `(input: {tool, sessionID, callID}, output: {args}) => Promise<void>` with output mutation.
- `packages/opencode/src/hooks/chat-params.ts` — reads/writes `system` field. New API: `(input: {sessionID, agent, model, provider, message}, output: {temperature, topP, topK, maxOutputTokens, options})` — NO `system` field in this hook anymore; system prompts need `experimental.chat.system.transform`.
- `packages/opencode/src/hooks/event.ts` — subscribes to `registry.onComplete` and uses `ctx.bus.emit`. New API: no `ctx.bus`; must use `client: OpencodeClient` for session writes OR the `event` hook as READ-ONLY consumer of the `Event` union (project, session, tool execution, etc.).
- `packages/opencode/src/hooks/chat-message-fallback.ts` — calls `session.writeAssistantMessage`. New API uses `client` (OpencodeClient) with session-post methods.
- `packages/opencode/src/runtime.ts` — `runOpenCodeSubagent`; unclear if SessionApi surface is fully compatible.
- `packages/opencode/src/strategies/OpenCodeTaskSwapStrategy.ts` — strategy that swaps `task` → `task_bg`; depends on how interception works.

### New files required

- `packages/opencode/src/host-compat/` (new subdir):
  - `version-detect.ts` — runtime detection of OpenCode plugin API shape
  - `legacy-hooks.ts` — build hooks against legacy API
  - `v14-hooks.ts` — build hooks against OpenCode 1.14+ API
- `packages/opencode/src/plan-review/` (new subdir):
  - `batch-collector.ts` — accumulates tool calls within a single LLM turn
  - `plan-picker.ts` — renders the multi-choice dialog for BG/FG per agent
- `packages/opencode/src/tui-plugin/` (new subdir — OpenCode 1.14+ only):
  - `live-control.ts` — registers TUI keybind + dialog for "move to background"
  - `commands.ts` — registers `/task move-bg <id>` and related slash commands

### Tests to add/update

- `packages/opencode/src/__tests__/host-compat/*` — unit tests for version detection branching
- `packages/opencode/src/__tests__/plan-review/*` — batch collection + picker logic
- `packages/opencode/src/__tests__/integration/plan-review.test.ts` — fake host ctx simulating 2+ tool calls in one turn
- `packages/opencode/src/__tests__/integration/live-control.test.ts` — simulating TUI move-bg flow

### Docs to update

- `packages/opencode/README.md` — fix `plugins` → `plugin`, new install instructions, Plan Review + Live Control UX
- `docs/skills/bg-subagents/SKILL.md` — same fixes, plus new usage patterns
- `docs/architecture.md` — new component diagram with version branch
- `docs/upstream/gentle-ai-pr.md` — refine with demo links + new UX description

---

## OpenCode 1.14+ API findings (authoritative source)

Read from installed `@opencode-ai/plugin@1.14.20` type definitions.

### Server hooks (`Hooks` interface, `dist/index.d.ts`)

```typescript
export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>;
  config?: (input: Config) => Promise<void>;
  tool?: { [key: string]: ToolDefinition };  // object map, NOT array
  auth?: AuthHook;
  provider?: ProviderHook;
  "chat.message"?: (input: {sessionID, agent?, model?, messageID?, variant?},
                    output: {message: UserMessage, parts: Part[]}) => Promise<void>;
  "chat.params"?: (input: {sessionID, agent, model, provider, message},
                   output: {temperature, topP, topK, maxOutputTokens, options}) => Promise<void>;
  "chat.headers"?: (input, output: {headers}) => Promise<void>;
  "permission.ask"?: (input, output: {status}) => Promise<void>;
  "command.execute.before"?: (input, output: {parts}) => Promise<void>;
  "tool.execute.before"?: (input: {tool, sessionID, callID},
                           output: {args}) => Promise<void>;
  "tool.execute.after"?: (input: {tool, sessionID, callID, args},
                           output: {title, output, metadata}) => Promise<void>;
  "shell.env"?: (input, output: {env}) => Promise<void>;
  "experimental.chat.messages.transform"?: (input, output: {messages}) => Promise<void>;
  "experimental.chat.system.transform"?: (input: {sessionID?, model},
                                           output: {system: string[]}) => Promise<void>;
  "experimental.session.compacting"?: ...;
  "experimental.compaction.autocontinue"?: ...;
  "experimental.text.complete"?: ...;
  "tool.definition"?: (input: {toolID}, output: {description, parameters}) => Promise<void>;
}
```

### Key deltas from legacy API

| Legacy | OpenCode 1.14+ |
|---|---|
| `tool: ReadonlyArray<HookToolDefinition>` with `name` in object | `tool: {[key]: ToolDefinition}` — name is the **key**, not a field |
| `HookToolDefinition.parameters: Record<string, unknown>` (JSON Schema) | `ToolDefinition.args: z.ZodRawShape` (Zod schemas) |
| `tool.execute.before (input: {tool_name, tool_input, session_id}): Promise<{continue, deny_reason?, replacement?}>` | `tool.execute.before (input: {tool, sessionID, callID}, output: {args}): Promise<void>` — mutate `output.args` |
| `chat.params (input: {system, session_id}): {system?}` | `chat.params (input: {sessionID, agent, model, provider, message}, output: {temperature, topP, topK, maxOutputTokens, options}): Promise<void>` — **NO system field** |
| System prompt injection via `chat.params` | NEW hook: `experimental.chat.system.transform (input: {sessionID?, model}, output: {system: string[]})` |
| `ctx.bus.emit(...)` | **GONE** — use `ctx.client: OpencodeClient` to post messages |
| `ctx.session.writeAssistantMessage(...)` | Use `client.session.message.send()` or `client.session.message.create()` |
| `event?: (BusEvent) => void` (custom BusEvent) | `event?: (input: {event: Event}) => Promise<void>` where Event is a typed SDK union (50+ event types) |

### PluginServerContext (OpenCode 1.14+)

From `PluginInput` type:

```typescript
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>;  // OpencodeClient v2
  project: Project;
  directory: string;
  worktree: string;
  experimental_workspace: { register(type, adaptor): void };
  serverUrl: URL;
  $: BunShell;
};
```

**No `session_id`, no `bus`, no `session` api**. All session operations go via `client`. The `server(ctx)` signature is `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`.

### How to cancel / swap a tool in new API

There is **no `continue: false` return**. To block/transform a tool call, mutate `output.args`:
- **Swap**: probably not possible directly — the tool identifier is locked. You'd need to either change `args` in a way that makes `task` behave like `task_bg` (i.e. the `task` tool itself reads a `background: true` flag) OR cancel + emit a new tool call via the TUI command surface.
- **Cancel**: open question. One approach: set `output.args` to something the tool rejects, OR throw an Error. **Needs verification with OpenCode source or community patterns.**
- **Alternative strategy**: Use `experimental.chat.messages.transform` to intercept at the MESSAGE level (before any tools run), rewrite the assistant's planned tool calls, and dispatch substitutes.

### TUI plugin API (for Live Control)

From `@opencode-ai/plugin/dist/tui.d.ts`:

`TuiPluginApi` surfaces we care about:
- `command.register(() => TuiCommand[])` — add `/task move-bg`, `/task list`, etc.
- `keybind.create(defaults, overrides)` — bind `ctrl+B` to "move current to bg"
- `ui.dialog` + `DialogSelect`, `DialogConfirm` — render Plan Review UI
- `state.session.status(sessionID)` — see which tools are currently running
- `client: OpencodeClient` — cancel tool calls, spawn new tasks
- `event: TuiEventBus` — subscribe to `session.idle`, `message.part.updated`, etc.
- `kv.get/set` — persist user preferences (default modes)

A TUI plugin is a separate module export: `{tui: TuiPlugin}` (vs `{server: Plugin}`). **One package can have BOTH** by exporting two modules or by splitting into two npm packages.

### Legacy API (what we built against)

From current `packages/opencode/src/types.ts`. Key differences **from new API**:
- `ctx` had `session_id`, `bus`, `session`, `log`
- `tool` was array of `{name, ...}` objects
- hooks returned objects, did not mutate

**We have no authoritative source for legacy API beyond our own type mirror**. Need to verify which OpenCode version this mirror was built against (git blame tooling available).

---

## Approaches

### 1. **Dual-mode plugin via runtime version detection** — single npm package, two codepaths

Entry point detects the shape of the `ctx` passed to `server(ctx)` and branches:
- If `ctx` has `client: OpencodeClient` → New API codepath
- If `ctx` has `bus` and `session` → Legacy API codepath
- Else → log compat warning, try legacy

Each codepath has its own `hooks/*` file under `src/host-compat/{legacy,v14}/`. The core domain (registry, policy, picker) is shared.

**Pros**:
- One package to distribute and pin
- Users don't need to pick the right version
- Works on both old installs (existing users) and new (Gentleman, PR recipient)

**Cons**:
- Bigger bundle (both paths shipped)
- More tests (both paths need coverage)
- Complexity around edge cases (what if OpenCode evolves another API?)

**Effort**: High — ~3 days for initial refactor + testing

### 2. **Two separate adapter packages** — `-opencode-legacy` and `-opencode` (new)

Ship two npm packages:
- `@maicolextic/bg-subagents-opencode-legacy` → legacy API only (pinned to OpenCode < 1.14)
- `@maicolextic/bg-subagents-opencode` → OpenCode 1.14+ only

User installs the one that matches their OpenCode version.

**Pros**:
- Clean separation, each package is simpler
- No runtime detection overhead
- Easier to deprecate legacy eventually

**Cons**:
- Users have to choose the right package
- Two publish pipelines to maintain
- PR upstream gets complicated (which one to recommend?)

**Effort**: Medium — ~2 days per package but doubled infra work

### 3. **Abandon legacy, ship 1.14+ only** — drop multi-version compat

Deprecate v0.1.x in npm. Ship v0.2.0 targeting only OpenCode 1.14+.

**Pros**:
- Simplest — single codepath, single API target
- Smaller surface to test and maintain

**Cons**:
- **User explicitly said they want multi-version support**
- Users on older OpenCode can't upgrade

**Effort**: Low-Medium — ~1.5 days

### 4. **MCP-only pivot** — ship an MCP server, not a plugin

Already evaluated and rejected by user. Included for completeness.

**Pros**: Stable protocol, portable across clients.

**Cons**: Can't intercept the `task` tool; no picker; no Live Control shortcut.

**Effort**: ~2 days but loses core feature.

---

## Plan Review architecture (applies to any approach)

### How to detect a batch of tool calls from one LLM turn

Three mechanisms in OpenCode 1.14+:

**A. `experimental.chat.messages.transform`** — Intercept the LLM's response BEFORE any tools run. This hook receives `{messages: {info, parts}[]}`. We scan `parts` for `type === "tool"` entries, identify which are `task` calls, build the Plan Review UI, and REWRITE the message parts to substitute approved tool calls.

**B. `tool.execute.before` with in-memory batching** — Collect consecutive `task` tool calls within a tight time window (e.g. 500ms) in a session-scoped buffer. Show the picker when the batch "settles" (no new calls in 500ms) or when a non-`task` tool arrives. **Complexity**: async coordination, race conditions.

**C. `tool.execute.before` per-call, but cache decisions** — Show picker on the first call of a batch, remember the decision for the rest of that turn ("apply to all in this turn"). **Drawback**: user can't see all delegations upfront.

**Recommended**: **A** (`experimental.chat.messages.transform`). Gives us full visibility into the plan AND the ability to rewrite.

### UI rendering

Two options:
- **Headless (server plugin)**: use `@clack/prompts` on stderr (our current approach). Works in non-TUI contexts. Blocks rendering but clack integrates cleanly.
- **TUI plugin**: use `ui.DialogSelect` from the TUI plugin API. Richer, better aligned with OpenCode. **Requires shipping a TUI plugin module alongside the server plugin**.

**Recommended**: **Hybrid** — use TUI `DialogSelect` when available (detect by presence of `tui` API on the plugin input); fall back to clack otherwise.

---

## Live Control architecture

### "Move foreground task to background" — technical feasibility

There is **no way to move a running tool execution off the main thread/session mid-flight** in OpenCode. The tool is synchronous from OpenCode's perspective — its result resolves, and the LLM's response continues.

**Workaround (the only feasible one)**:
1. User presses keybind (e.g. `Ctrl+B`) while task is running in foreground
2. TUI plugin calls `client.session.abort()` or `client.tool.cancel(callID)` to **cancel** the running task
3. TUI plugin posts a new synthetic message to the session: "Re-running {agent} in background via task_bg" OR directly invokes `task_bg` via `client.session.message.send()`
4. The subagent restarts from scratch in BG

**Tradeoff**: **loses progress** of the foreground run. Acceptable if the task is idempotent (exploration, reads). Dangerous if the task was making mutations.

### Slash commands for task control

From TUI plugin `command.register`, we can ship:

| Command | Implementation |
|---|---|
| `/task list` | Query `TaskRegistry` via `client.session.message.list` or internal registry access |
| `/task show <id>` | Format registry entry |
| `/task logs <id> [--tail=N]` | Read JSONL from `HistoryStore` |
| `/task kill <id>` | `TaskRegistry.cancel(id)` + bus emit |
| `/task move-bg <id>` | Cancel FG, spawn BG with same args |

---

## Recommendation

**Approach 1 (dual-mode) + Plan Review via `experimental.chat.messages.transform` + hybrid UI + TUI plugin for Live Control**.

Rationale:
1. **Multi-version compat is a hard requirement**. Approaches 2 and 3 violate it.
2. **Runtime detection is idiomatic** for a plugin crossing API versions. Most monorepos with this problem do exactly this.
3. **Plan Review at the MESSAGE level** (`experimental.chat.messages.transform`) gives us the cleanest UX — user sees the plan upfront, decides once, no per-call friction.
4. **TUI plugin for Live Control** means shipping a separate plugin module (`{tui: TuiPlugin}`) in the same npm package. OpenCode 1.14+ supports this natively; legacy consumers just don't get the TUI features (graceful degradation).
5. **Single package, single publish pipeline** — much easier to document and PR upstream.

### Package layout after refactor

```
packages/opencode/
├── src/
│   ├── plugin.ts                       # exports {server, tui} — routes to compat layer
│   ├── types.ts                        # shared types
│   ├── host-compat/
│   │   ├── version-detect.ts           # runtime detection
│   │   ├── legacy/                     # legacy API hooks (current code, moved)
│   │   │   ├── tool-register.ts
│   │   │   ├── tool-before.ts
│   │   │   ├── chat-params.ts
│   │   │   ├── event.ts
│   │   │   └── chat-message-fallback.ts
│   │   └── v14/                        # OpenCode 1.14+ hooks (new)
│   │       ├── tool-register.ts        # Zod schemas
│   │       ├── messages-transform.ts   # experimental.chat.messages.transform for Plan Review
│   │       ├── system-transform.ts     # experimental.chat.system.transform (replaces chat-params)
│   │       ├── event.ts                # read-only Event union handler
│   │       └── delivery.ts             # client.session.message for completion delivery
│   ├── plan-review/
│   │   ├── batch-detector.ts           # identify batches in message parts
│   │   └── picker-ui.ts                # clack-based fallback picker
│   ├── tui-plugin/                     # OpenCode 1.14+ TUI plugin
│   │   ├── index.ts                    # TuiPlugin entry
│   │   ├── live-control.ts             # Ctrl+B keybind + dialog
│   │   ├── plan-review-dialog.ts       # ui.DialogSelect picker
│   │   └── commands.ts                 # /task move-bg, /task list, etc.
│   ├── runtime.ts                      # runOpenCodeSubagent (shared)
│   └── strategies/
│       └── OpenCodeTaskSwapStrategy.ts # shared (core-facing)
```

---

## Risks

1. **`experimental.chat.messages.transform` might have unknown semantics** — the "experimental" prefix signals instability. OpenCode may change or remove it. Mitigation: keep a fallback to per-call batching via `tool.execute.before` if messages.transform doesn't work as expected.

2. **Zod version conflicts** — OpenCode plugin API uses zod 4-beta (`effect@4.0.0-beta.48` dep signals bleeding edge). Our protocol package uses `zod@3.25.76`. Need to verify compatibility; may require peer-dep range or dual-zod.

3. **"Move to background" loses progress** — users may expect seamless transition. We must document clearly: "move-bg cancels and restarts, don't use on mutating tasks."

4. **TUI plugin module increases bundle size** — the `@opentui/core` + `@opentui/solid` peer deps are heavy. Mitigation: split TUI module into a separate entrypoint (`@maicolextic/bg-subagents-opencode/tui`), lazy-loaded only when available.

5. **Version detection heuristics might misfire** — if OpenCode ships a future API version that changes ctx shape again, our detection breaks. Mitigation: also check a version string from `client.app.version()` if available; add a feature flag to force legacy.

6. **Existing v0.1.x users on npm** — we published v0.1.0–0.1.4 all with legacy-only API. Users who installed those on OpenCode 1.14 have broken plugins. Mitigation: `npm deprecate` v0.1.x after shipping v0.2, with message pointing to v0.2.

7. **Testing coverage** — running actual OpenCode 1.14 in CI is hard (it's a TUI binary). Need to mock the new API ctx shape in vitest and do real manual E2E before PR upstream.

---

## Ready for Proposal

**Yes.** The investigation covers enough ground to write a coherent proposal. Key decisions to make in `sdd-propose`:

1. Confirm Approach 1 (dual-mode via runtime detection) vs alternatives
2. Confirm `experimental.chat.messages.transform` as the primary Plan Review interception point
3. Decide on TUI plugin inclusion in v0.2 vs deferring to v0.2.1
4. Decide on package/version bump scope (v0.2.0 minor, or v1.0.0 major given breaking changes to consumers)
5. Decide on deprecation of v0.1.x in npm
