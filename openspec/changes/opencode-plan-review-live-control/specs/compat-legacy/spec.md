# compat-legacy Specification

## Purpose

Preserves the user-facing behavior of `@maicolextic/bg-subagents-opencode@0.1.x` on legacy OpenCode hosts (pre-1.14). Users who installed v0.1.x on legacy OpenCode and who upgrade to v1.0.0 MUST see no functional regression. The per-call picker UX, policy resolution, and completion delivery remain as they were.

## Requirements

### Requirement: Per-Call Picker Preserved on Legacy

On legacy hosts, the system MUST preserve the v0.1.x behavior of intercepting every core `task` tool call via `tool.execute.before` and presenting a per-call picker when the resolved policy mode is `ask`.

#### Scenario: Legacy host, single task call with ask-mode policy

- GIVEN a legacy host (ctx has `bus`, `session`, `session_id`)
- AND policy resolves `mode: "ask"` for agent `sdd-explore`
- WHEN the LLM calls `task({subagent_type: "sdd-explore", prompt: "..."})`
- THEN the pre-existing per-call picker appears with `[B]ackground / [N]ormal / [Esc]`
- AND the user's choice determines whether the call passes through or swaps to `task_bg`

#### Scenario: Legacy host, foreground policy

- GIVEN a legacy host
- AND policy resolves `mode: "foreground"` for agent `sdd-apply`
- WHEN the LLM calls `task({subagent_type: "sdd-apply", prompt: "..."})`
- THEN NO picker appears
- AND the call passes through unchanged

#### Scenario: Legacy host, background policy

- GIVEN a legacy host
- AND policy resolves `mode: "background"` for agent `sdd-explore`
- WHEN the LLM calls `task({subagent_type: "sdd-explore", prompt: "..."})`
- THEN NO picker appears
- AND the call is transparently swapped to `task_bg` with the same args

### Requirement: Plan Review NOT Active on Legacy

Plan Review (batch picker) is an OpenCode 1.14+ feature. On legacy hosts, the system MUST NOT attempt batch detection or message-level interception.

#### Scenario: Legacy host, 3 task calls in one turn

- GIVEN a legacy host
- AND the LLM responds with 3 `task` calls in one turn
- WHEN the plugin processes the turn
- THEN each `task` call is intercepted individually via `tool.execute.before`
- AND 3 separate per-call pickers appear in sequence (or 3 passthrough/swap decisions per resolved policy)
- AND NO Plan Review batch picker appears

### Requirement: Live Control NOT Active on Legacy

Live Control (Ctrl+B move-to-bg, TUI slash commands) requires the OpenCode 1.14+ TUI plugin API. On legacy hosts, these features MUST NOT be advertised or attempted.

#### Scenario: Legacy host, TUI plugin import

- GIVEN a user tries to load `@maicolextic/bg-subagents-opencode/tui` on a legacy OpenCode
- WHEN OpenCode attempts to load the module
- THEN EITHER OpenCode's plugin loader rejects it due to missing `tui` API (preferred)
- OR our entry file throws immediately with `"TUI plugin requires OpenCode >= 1.14.0"`
- AND the server plugin still functions normally via legacy compat

### Requirement: Completion Delivery Via Legacy Bus

On legacy hosts, completion delivery MUST use `ctx.bus.emit("bg-subagents/task-complete", ...)` as primary with `session.writeAssistantMessage` as fallback, preserving the v0.1.x delivery contract exactly.

#### Scenario: Legacy BG completion, bus available

- GIVEN legacy host with bus
- AND a BG task completes
- WHEN the completion callback fires
- THEN `bus.emit({type: "bg-subagents/task-complete", task_id, status, result, ts})` is called
- AND a 2000ms fallback timer is armed
- AND if `onDelivered(task_id)` is called, the timer is cancelled

### Requirement: System Prompt Steer Via chat.params (Legacy)

On legacy hosts, the system prompt addendum telling the LLM about `task_bg` MUST be injected via the `chat.params` hook (legacy signature that accepts and returns `system: string`), preserving v0.1.x behavior.

#### Scenario: Legacy chat.params returns system addendum

- GIVEN legacy host
- AND `isTaskBgRegistered(sessionId)` returns true
- WHEN `chat.params` fires with `{system: "existing system prompt", session_id}`
- THEN the returned result is `{system: "existing system prompt\n\n<task_bg advertisement>"}`
- AND the LLM sees the advertisement

### Requirement: Graceful Degradation on Missing Legacy Surface

If a legacy host is missing a specific surface (e.g., no `bus`, no `session` API), the system MUST degrade gracefully: disable the feature that needs it, log a warning, and keep the rest of the plugin working.

#### Scenario: Legacy host without bus

- GIVEN legacy ctx with `session_id` and `session` but NO `bus`
- WHEN the plugin boots
- THEN primary delivery channel falls back to `session.writeAssistantMessage` (no bus events)
- AND a warn log `bus-events:no-bus` is emitted (matches v0.1.x exact message)
- AND the fallback timer is ALWAYS armed (no ack mechanism without bus)

#### Scenario: Legacy host without session.writeAssistantMessage

- GIVEN legacy ctx with bus and session but session lacks `writeAssistantMessage`
- WHEN a completion needs fallback delivery
- THEN a warn log `delivery:legacy-no-session-writer` is emitted
- AND the completion is recorded in `HistoryStore` only

### Requirement: No Breaking Changes to Core Public API on Legacy Users' Installs

The `@maicolextic/bg-subagents-core` package's public exports (used by v0.1.x legacy installs) MUST remain backward-compatible. Any additions are OK; renames or removals are NOT.

#### Scenario: v0.1.x user upgrades to v1.0 core

- GIVEN a user on OpenCode < 1.14 upgrades `@maicolextic/bg-subagents-opencode` from 0.1.4 → 1.0.0
- AND this pulls in a new core version (e.g., 0.2.0)
- WHEN the user runs their OpenCode session
- THEN all existing imports from core still work (TaskRegistry, PolicyResolver, Picker, etc.)
- AND no runtime errors from missing exports
