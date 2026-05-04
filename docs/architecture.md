# Architecture

A contributor-oriented overview of how bg-subagents is structured. Read this before touching the code.

---

## Package topology

```
@maicolextic/bg-subagents-protocol   (zero deps — wire contract only)
          |
@maicolextic/bg-subagents-core       (domain runtime — no host deps)
          |
@maicolextic/bg-subagents-opencode   (v1.0 — OpenCode adapter: server plugin + TUI plugin)
@maicolextic/bg-subagents-claude-code (v0.2 — roadmap)
@maicolextic/bg-subagents-mcp        (v0.3 — roadmap)
```

`protocol` exports types, zod schemas, and `PROTOCOL_VERSION`. It has no runtime deps beyond `zod`.

`core` is pure domain — policy, registry, picker, invoker, history, CLI commands. It depends on `protocol` and has no knowledge of any specific host (OpenCode, Claude Code, etc.).

Each adapter is a thin wiring layer that bridges core's interfaces to a host-specific plugin surface. The OpenCode adapter is the only shipped adapter in v1.0. It exposes **two separate entry points** — the server plugin (loaded via `opencode.json`) and the TUI plugin (loaded via `tui.json`).

---

## v1.0 Architecture overview

```
OpenCode session
      │
      ├─── SERVER PLUGIN  (loaded from opencode.json)
      │         │
      │    plugin.ts   ← detects host version → routes to v14 or legacy builder
      │         │
      │    ┌────┴──────────────────────────────────────────────────────────┐
      │    │  host-compat/                                                 │
      │    │                                                               │
      │    │  version-detect.ts      ← inspects ctx.client vs ctx.bus     │
      │    │                                                               │
      │    │  v14/                   ← OpenCode 1.14+ (primary path)      │
      │    │    tool-register.ts     ← registers task_bg with Zod schema  │
      │    │    system-transform.ts  ← appends task_bg to system prompt   │
      │    │    event-handler.ts     ← logs session lifecycle events      │
      │    │    delivery.ts          ← primary + fallback completion path  │
      │    │    messages-transform.ts← LLM→PolicyResolver→rewriteParts    │
      │    │    slash-commands.ts    ← /task list|show|kill|logs|move-bg  │
      │    │    index.ts             ← buildV14Hooks: wires all the above  │
      │    │                                                               │
      │    │  legacy/                ← OpenCode <1.14 (graceful degrade)  │
      │    │    tool-register.ts     ← JSON-schema task_bg registration   │
      │    │    tool-before.ts       ← per-call picker intercept          │
      │    │    chat-params.ts       ← injects task_bg system prompt      │
      │    │    event.ts             ← bus.onEvent subscriber             │
      │    │    chat-message-fallback.ts ← 2000ms synthetic message      │
      │    │    task-command.ts      ← /task slash commands (legacy)      │
      │    │    index.ts             ← buildLegacyHooks: wires all above  │
      │    └───────────────────────────────────────────────────────────────┘
      │         │
      │    ┌────┴────────────────────────┐
      │    │  core (@maicolextic/bg-subagents-core)                       │
      │    │                                                               │
      │    │  TaskRegistry    ← in-memory task state + onComplete bus     │
      │    │  PolicyResolver  ← reads policy.jsonc; resolveBatch()        │
      │    │  HistoryStore    ← JSONL on disk, gzip rotation              │
      │    │  StrategyChain   ← picks invocation strategy                 │
      │    │  createLogger    ← file-routed logger (zero stdout)          │
      │    └─────────────────────────────────────────────────────────────-┘
      │         │
      │    SharedPluginState  ← Symbol.for("@maicolextic/bg-subagents/shared")
      │         │                 on globalThis — bridges server → TUI
      │         │
      └─── TUI PLUGIN  (loaded from tui.json via "@maicolextic/bg-subagents-opencode/tui")
                │
            tui-plugin/
              index.ts           ← TUI entry point; id: "bg-subagents-tui" REQUIRED
              shared-state.ts    ← reads globalThis symbol → TaskRegistry + PolicyStore
              sidebar.ts         ← sidebar_content slot; getSidebarData()
              keybinds.ts        ← Ctrl+B / Ctrl+F / ↓ via api.command.register
              plan-review-dialog.ts ← reserved; not runtime-verified here
```

---

## Data flow (server side)

```
~/.config/bg-subagents/policy.jsonc
      │
      ▼
loadPolicy() → normalizes legacy bg/fg to background/foreground
      │
      ▼
PolicyResolver.resolveBatch(tasks[])
      ▲
      │
LLM generates task tool calls
      │
      ▼
messages-transform hook (experimental.chat.messages.transform)
      │
      ▼
rewriteParts(decisions[])
      │
      ├── mode = "background" → rewriteParts replaces task → task_bg
      └── mode = "foreground" → parts pass through unchanged as native task
      │
      ▼
Rewritten message parts forwarded to OpenCode host
      │
      ▼
TaskRegistry.spawn(task_bg args) → { task_id, status: "running" }
      │
      ▼
TaskRegistry.onComplete(event)
      │
      ├─→ primary: client.session.message.create(...)   [v14 path]
      │              OR bus.emit("bg-subagents/task-complete") [legacy path]
      └─→ fallback: session.writeAssistantMessage(...)  [2000ms timer]
```

### Verified SDD control flow

```text
policy.jsonc
  default_mode_by_agent_name:
    sdd-explore = bg/background
    sdd-apply   = fg/foreground
    sdd-verify  = fg/foreground
        │
        ▼
loadPolicy() normalizes modes
        │
        ▼
messages.transform
        │
        ├─ sdd-explore → task_bg
        ├─ sdd-apply   → task
        └─ sdd-verify  → task

/task policy bg|fg|default
        │
        ▼
chat.message hook updates TaskPolicyStore for the session
        │
        ▼
messages.transform applies the session override before per-agent policy

control-tui session.created
        │
        ▼
auto-flip helper checks bg policy and parent session
        │
        ├─ mark parent before respawn to prevent loops
        └─ promptAsync detaches the replacement background task
```

| Mode | Runtime path | UX contract |
|------|--------------|-------------|
| `background` | `messages.transform` rewrites `task` to `task_bg`, or control-tui auto-flip detaches a native task. | Does not block the interactive interface. |
| `foreground` | Native OpenCode `task`. | Blocks by design while the delegated task owns the turn. |

The verified config source is `~/.config/bg-subagents/policy.jsonc`, especially `default_mode_by_agent_name`. Canonical values are `background` and `foreground`; legacy shorthand values `bg` and `fg` are accepted and normalized on load. Historical `bgSubagents.policy` references describe an older flat config shape and should not be treated as the current happy path unless a specific compatibility path is being tested.

## UI flow (TUI side)

```
User presses Ctrl+B / Ctrl+F / ↓
      │
      ▼
api.command.register callback fires (keybinds.ts)
      │
      ▼
SharedPluginState.current() — reads globalThis Symbol
      │
      ├── undefined → api.ui.toast("bg-subagents not ready yet")
      └── state     → getSidebarData() filters tasks by mode/status
                          │
                          ▼
                     api.ui.dialog.replace(
                       () => api.ui.DialogSelect({ title, options, onSelect })
                     )

User opens OpenCode sidebar
      │
      ▼
TUI host invokes sidebar_content slot render (sidebar.ts)
      │
      ▼
getSidebarData() → SidebarTaskRow[] (sorted: running first, terminal by recency)
      │
      ▼
Returns data object to TUI host for rendering
(Phase v1.1: upgrades to real SolidJS JSX component via @opentui/solid)
```

---

## Component responsibilities

| Component | Responsibility |
|-----------|---------------|
| `plugin.ts` | Session entry point. Detects host version, calls `buildV14Hooks` or `buildLegacyHooks`, wires disposal. |
| `host-compat/version-detect.ts` | Inspects ctx shape to return `"v14"` or `"legacy"`. Honors `BG_SUBAGENTS_FORCE_COMPAT` env override. |
| `host-compat/v14/tool-register.ts` | Registers `task_bg` tool with Zod schema for OpenCode 1.14+ tool surface. |
| `host-compat/v14/system-transform.ts` | Appends task_bg advertisement to the system prompt array when plugin is booted. |
| `host-compat/v14/event-handler.ts` | Read-only event consumer; logs session lifecycle events (session.idle, session.created, etc). |
| `host-compat/v14/delivery.ts` | Coordinates primary (`client.session.message.create`) + fallback delivery with deduplication. |
| `host-compat/v14/messages-transform.ts` | Intercepts LLM message parts, calls `PolicyResolver.resolveBatch`, rewrites task → task_bg. |
| `host-compat/v14/slash-commands.ts` | Implements `/task list`, `/task show`, `/task kill`, `/task logs`, `/task move-bg`, `/task policy` via the server `chat.message` hook. Exports `TaskPolicyStore`. |
| `host-compat/v14/index.ts` | `buildV14Hooks(ctx)` — assembles all v14 hooks and initializes SharedPluginState. |
| `host-compat/legacy/` | Mirror of v14 using the pre-1.14 OpenCode API surface. Per-call picker intercept instead of batch PolicyResolver. |
| `tui-plugin/index.ts` | TUI entry point. `id: "bg-subagents-tui"` REQUIRED. Wires sidebar, keybinds, lifecycle. |
| `tui-plugin/shared-state.ts` | Singleton bridge via `Symbol.for("@maicolextic/bg-subagents/shared")` on `globalThis`. Server writes; TUI reads. |
| `tui-plugin/sidebar.ts` | `sidebar_content` slot plugin. `getSidebarData()` maps TaskRegistry to sorted `SidebarTaskRow[]`. |
| `tui-plugin/keybinds.ts` | Three TuiCommand entries: Ctrl+B (BG tasks), Ctrl+F (FG tasks), ↓ (all tasks). Dialogs via `api.ui.dialog.replace`. |
| `tui-plugin/plan-review-dialog.ts` | Reserved/deferred — do not document as a verified runtime picker. |

---

## Hook wiring table

### v14 hooks (OpenCode 1.14+)

| Hook | File | What it does |
|------|------|-------------|
| `tool` | `v14/tool-register.ts` | Registers `task_bg` with Zod 3 raw shape. |
| `experimental.chat.messages.transform` | `v14/messages-transform.ts` | Batch-resolves policy; rewrites task → task_bg in LLM message parts. |
| `experimental.chat.system.transform` | `v14/system-transform.ts` | Appends task_bg advertisement to `output.system[]`. |
| `event` | `v14/event-handler.ts` | Logs session lifecycle events (read-only). |
| delivery (primary) | `v14/delivery.ts` | `client.session.message.create` on task completion. |
| delivery (fallback) | `v14/delivery.ts` | 2000ms timer writes synthetic assistant message if primary fails. |
| `chat.message` | `v14/slash-commands.ts` | Intercepts `/task *` and `/task policy *` slash commands. |

### Legacy hooks (OpenCode <1.14)

| Hook | File | What it does |
|------|------|-------------|
| `tool` | `legacy/tool-register.ts` | Registers `task_bg` with JSON schema. |
| `tool.execute.before` | `legacy/tool-before.ts` | Intercepts every `task` call; per-call picker → foreground or task_bg swap. |
| `chat.params` | `legacy/chat-params.ts` | Appends task_bg system prompt addendum. |
| bus event (emit) | `legacy/event.ts` | Subscribes to `TaskRegistry.onComplete` → `bus.emit`. |
| `chat.message` fallback | `legacy/chat-message-fallback.ts` | 2000ms timer; fires if bus delivery hasn't acked. |
| `/task` commands | `legacy/task-command.ts` | Legacy slash command handler. |

### TUI hooks (tui.json path, OpenCode 1.14.23+)

| Hook | File | What it does |
|------|------|-------------|
| `api.slots.register` | `tui-plugin/sidebar.ts` | Registers `sidebar_content` slot; renders `SidebarTaskRow[]` on each host render cycle. |
| `api.command.register` | `tui-plugin/keybinds.ts` | Registers 3 TuiCommands: Ctrl+B, Ctrl+F, ↓ with `api.ui.dialog.replace` handlers. |
| `api.lifecycle.onDispose` | `tui-plugin/index.ts` | Clears polling interval on TUI plugin shutdown. |

---

## SharedPluginState bridge

The server plugin and TUI plugin run in the same Bun process but are loaded by different plugin loaders (server loader reads `opencode.json`; TUI loader reads `tui.json`). They share state via a process-global symbol:

```
Symbol.for("@maicolextic/bg-subagents/shared")
```

- **Server writes** (at boot, from `buildV14Hooks`): `registerFromServer({ registry, policyStore })`
- **TUI reads** (at boot + on every render): `current()` → `SharedPluginState | undefined`
- Race at startup: TUI may boot before the server plugin. All TUI code handles `current() === undefined` gracefully — sidebar renders empty, keybinds show a toast.

---

## Strategy chain

`BackgroundInvoker` is implemented as a `StrategyChain` that tries each strategy in order, returning the first successful rewrite:

```
OpenCodeTaskSwapStrategy  ← checks host_context.opencode_task_bg_registered
      |
NativeBackgroundStrategy  ← checks host_context for native background fork capability
      |
SubagentSwapStrategy      ← swaps to a background-capable subagent variant
      |
PromptInjectionStrategy   ← last resort: injects background instruction into prompt
```

The OpenCode adapter prepends `OpenCodeTaskSwapStrategy` before the canonical core strategies so the `task_bg` tool swap takes priority on an OpenCode host.

---

## Completion delivery contract

Two paths compete for delivery; only one fires per task:

```
TaskRegistry.onComplete(event)
      │
      ├─→  PRIMARY (v14): client.session.message.create(...)
      │         │
      │         └─→  ack: registry.markDelivered(task_id) → fallback timer cancelled
      │
      ├─→  PRIMARY (legacy): bus.emit("bg-subagents/task-complete", ...)
      │         │
      │         └─→  ack: fallback.markDelivered(task_id) → timer cancelled
      │
      └─→  FALLBACK: setTimeout(2000ms)
                │
                └─→  session.writeAssistantMessage(...)
                     "[bg-subagents] Task tsk_... completed with status COMPLETED."
```

If the OpenCode session doesn't have the primary delivery surface available (headless, test environments), the fallback is the only delivery path. This is deliberate — the plugin degrades gracefully.

---

## State storage

| What | Where | Lifetime |
|------|-------|---------|
| TaskRegistry | In-memory (per session) | Cleared on session end |
| TaskPolicyStore | In-memory (per session, shared via globalThis) | Cleared on session end |
| SharedPluginState | `globalThis[Symbol.for(...)]` | Per-process; written at server boot |
| HistoryStore | JSONL files on disk | `retention_days` (default 30) |
| Policy | Loaded from `~/.config/bg-subagents/policy.jsonc` | Reloaded on `PolicyResolver.reload()` |
| Host context | In-memory map keyed by session_id | Cleared by `clearHostContext` |

History files live at `~/.local/share/bg-subagents/history/` (Linux/macOS) or `%APPDATA%\bg-subagents\history\` (Windows). The path is resolved by `resolveHistoryPath()` from `@maicolextic/bg-subagents-core`.

Log file lives at `~/.opencode/logs/bg-subagents.log` (per `packages/core/src/logger.ts`).

---

## Install — two config files

Users must declare the plugin in **both** files to get the full v1.0 experience:

```json
// opencode.json — server plugin (PolicyResolver, /task commands, completion delivery)
{
  "plugins": ["@maicolextic/bg-subagents-opencode"]
}

// tui.json — TUI plugin (sidebar, Ctrl+B/F/↓ keybinds)
{
  "plugins": ["@maicolextic/bg-subagents-opencode/tui"]
}
```

The server plugin is functional standalone (server-side features work without the TUI plugin). The TUI plugin requires the server plugin to be booted first for `SharedPluginState` to be available.

---

## Adding a new adapter

1. Create `packages/<host>/` with a `package.json` depending on `@maicolextic/bg-subagents-core`.
2. Implement the host's plugin entry point (e.g. `server(ctx)` for OpenCode, `activate()` for Claude Code).
3. Wire the five integration points (tool registration, before-hook, chat params, bus events, fallback).
4. Prepend a host-specific strategy to the `StrategyChain` if the host has a native background fork capability.
5. Add a changeset with `minor` bump on the new adapter and `patch` on `core` if needed.
