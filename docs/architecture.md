# Architecture

A contributor-oriented overview of how bg-subagents is structured. Read this before touching the code.

---

## Package topology

```
@maicolextic/bg-subagents-protocol   (zero deps — wire contract only)
          |
@maicolextic/bg-subagents-core       (domain runtime — no host deps)
          |
@maicolextic/bg-subagents-opencode   (v0.1 — OpenCode adapter)
@maicolextic/bg-subagents-claude-code (v0.2 — roadmap)
@maicolextic/bg-subagents-mcp        (v0.3 — roadmap)
```

`protocol` exports types, zod schemas, and `PROTOCOL_VERSION`. It has no runtime deps beyond `zod`.

`core` is pure domain — policy, registry, picker, invoker, history, CLI commands. It depends on `protocol` and has no knowledge of any specific host (OpenCode, Claude Code, etc.).

Each adapter is a thin wiring layer that bridges core's interfaces to a host-specific plugin surface. The OpenCode adapter is the only shipped adapter in v0.1.

---

## Component diagram

```
OpenCode session
      |
  plugin.ts  (bootstraps everything once per session)
      |
  ┌───────────────────────────────────────────────────────┐
  │  Hooks registered with OpenCode                       │
  │                                                       │
  │  tool              → registerTaskBgTool               │
  │  tool.execute.before → interceptTaskTool              │
  │  chat.params       → steerChatParams                  │
  │  (bus.onEvent)     → wireBusEvents (primary delivery) │
  │  (chat.message)    → chatMessageFallback              │
  └───────────────────┬───────────────────────────────────┘
                      │
              ┌───────┴────────┐
              │     core       │
              │                │
              │  PolicyResolver│  ← reads policy.jsonc via PolicyLoader
              │  TaskRegistry  │  ← in-memory task state + onComplete bus
              │  HistoryStore  │  ← JSONL on disk, gzip rotation
              │  Picker        │  ← ClackPicker (TTY) or BarePicker (headless)
              │  StrategyChain │  ← picks invocation strategy
              └────────────────┘
```

---

## Hook wiring in OpenCode

The plugin registers five integration points:

| Hook | File | What it does |
|------|------|-------------|
| `tool` | `hooks/tool-register.ts` | Registers the `task_bg` tool definition. The model can call it directly. |
| `tool.execute.before` | `hooks/tool-before.ts` | Intercepts every `task` call. Resolves policy → prompts picker → either passes through or swaps to `task_bg`. |
| `chat.params` | `hooks/chat-params.ts` | Appends a system-prompt addendum describing `task_bg` alongside `task`. Only fires if the plugin booted successfully. |
| bus event (emit) | `hooks/event.ts` | Subscribes to `TaskRegistry.onComplete` and re-publishes via `bus.emit("bg-subagents/task-complete", ...)`. |
| `chat.message` fallback | `hooks/chat-message-fallback.ts` | Arms a 2000 ms timer per completion. If the bus delivery hasn't acked by then, injects a synthetic assistant message. |

---

## Completion delivery contract

Two paths compete for delivery; only one fires per task:

```
TaskRegistry.onComplete(event)
      │
      ├─→  bus.emit("bg-subagents/task-complete", ...)   [PRIMARY]
      │         │
      │         └─→  ack: fallback.markDelivered(task_id)  → timer cancelled
      │
      └─→  setTimeout(2000ms)                             [FALLBACK]
                │
                └─→  session.writeAssistantMessage(...)
                     "[bg-subagents] Task tsk_... completed with status COMPLETED."
```

If the OpenCode session doesn't have a `bus.emit` surface (headless, test environments), the fallback is the only delivery path. This is deliberate — the plugin degrades gracefully.

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

## State storage

| What | Where | Lifetime |
|------|-------|---------|
| TaskRegistry | In-memory (per session) | Cleared on session end |
| HistoryStore | JSONL files on disk | `retention_days` (default 30) |
| Policy | Loaded from `~/.config/bg-subagents/policy.jsonc` | Reloaded on `PolicyResolver.reload()` |
| Host context | In-memory map keyed by session_id | Cleared by `clearHostContext` |

History files live at `~/.local/share/bg-subagents/history/` (Linux/macOS) or `%APPDATA%\bg-subagents\history\` (Windows). The path is resolved by `resolveHistoryPath()` from `@maicolextic/bg-subagents-core`.

---

## Adding a new adapter

1. Create `packages/<host>/` with a `package.json` depending on `@maicolextic/bg-subagents-core`.
2. Implement the host's plugin entry point (e.g. `server(ctx)` for OpenCode, `activate()` for Claude Code).
3. Wire the five integration points (tool registration, before-hook, chat params, bus events, fallback).
4. Prepend a host-specific strategy to the `StrategyChain` if the host has a native background fork capability.
5. Add a changeset with `minor` bump on the new adapter and `patch` on `core` if needed.
