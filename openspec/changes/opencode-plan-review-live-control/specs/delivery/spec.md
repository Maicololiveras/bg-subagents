# delivery Specification

## Purpose

Defines how task completion events reach the main chat. Replaces the `ctx.bus.emit` pattern (legacy) with `OpencodeClient` session writes on OpenCode 1.14+, while preserving a chat-message fallback mechanism on both versions.

## Requirements

### Requirement: Primary Delivery on v14 Hosts

When a BG task completes on an OpenCode 1.14+ host, the system MUST deliver the completion notification by calling `client.session.message.create` (or equivalent SDK method) to inject an assistant-visible message into the main chat session.

#### Scenario: BG task completes on v14

- GIVEN a BG task spawned via `task_bg` transitions to `completed`
- AND the plugin is running on OpenCode 1.14+
- WHEN the `TaskRegistry.onComplete` callback fires
- THEN `client.session.message.create({session_id, role: "assistant", content: "[bg-subagents] Task {id} completed: {summary}"})` is invoked
- AND the message appears in the user's main chat

#### Scenario: BG task errors on v14

- GIVEN a BG task transitions to `error` with an `error_message`
- AND the plugin is running on OpenCode 1.14+
- WHEN the completion callback fires
- THEN a message is posted with `"[bg-subagents] Task {id} errored: {error_message}"`
- AND the error is also logged at warn level

### Requirement: Primary Delivery on Legacy Hosts

On legacy hosts, the system MUST use `ctx.bus.emit("bg-subagents/task-complete", payload)` as the primary delivery channel, preserving current v0.1.x behavior.

#### Scenario: BG task completes on legacy

- GIVEN a BG task transitions to `completed`
- AND the plugin is running on a legacy host (ctx has `bus.emit`)
- WHEN the completion callback fires
- THEN `ctx.bus.emit({type: "bg-subagents/task-complete", task_id, status, result, ts})` is called exactly once
- AND a fallback timer is NOT armed because bus delivery is assumed successful

### Requirement: Fallback Delivery When Primary Fails or Is Unavailable

If primary delivery is unavailable (no bus on legacy, no client on a stripped v14 ctx) OR the primary throws, the system MUST deliver via a fallback: a synthetic assistant-visible message written through the best available channel, armed after a 2000ms ack timeout.

#### Scenario: No client method on v14

- GIVEN v14 host but `client.session.message.create` is undefined (stripped SDK)
- WHEN a completion fires
- THEN the fallback arms a 2000ms timer
- AND on timer expiry, the fallback writes via whatever session-write surface is available (`client.session.message.send`, or a warn log if none)

#### Scenario: Legacy bus throws

- GIVEN legacy host
- AND `ctx.bus.emit` throws synchronously
- WHEN a completion fires
- THEN a warn log is emitted `delivery:bus-failed`
- AND the fallback timer is armed
- AND on expiry, the fallback uses `session.writeAssistantMessage`

#### Scenario: No bus, no session surface

- GIVEN neither `client.session.message.*` NOR `bus.emit` NOR `session.writeAssistantMessage` is available
- WHEN a completion fires
- THEN a warn log is emitted `delivery:no-channel`
- AND the completion is recorded in `HistoryStore` (so `/task show <id>` can surface it)
- AND no further delivery is attempted

### Requirement: Ack-Based Fallback Cancellation

The fallback timer MUST be cancelled when primary delivery is acked. Acking happens via:
- Legacy: `onDelivered(task_id)` callback from `wireBusEvents`
- v14: a successful resolution of the `client.session.message.create` promise

#### Scenario: Legacy ack cancels fallback

- GIVEN a completion event fires on legacy host
- AND primary bus delivery succeeds
- WHEN `onDelivered(task_id)` is invoked
- THEN the fallback timer for that `task_id` is cleared
- AND no synthetic message is written by the fallback

#### Scenario: v14 promise resolves cancels fallback

- GIVEN a completion event fires on v14 host
- WHEN `client.session.message.create(...)` resolves successfully
- THEN the fallback for that `task_id` is marked delivered
- AND no synthetic message is written

#### Scenario: v14 promise rejects triggers fallback

- GIVEN a completion event fires on v14 host
- AND `client.session.message.create(...)` rejects with an error
- WHEN the rejection is observed
- THEN a warn log is emitted `delivery:primary-failed` with the error message
- AND the fallback timer remains armed (or re-armed) to deliver via alternate surface

### Requirement: Fallback Timeout Configurable

The ack timeout SHOULD default to 2000ms and SHOULD be configurable via `ackTimeoutMs` override in `buildServer` opts (for tests) and via policy JSONC's `ack_timeout_ms` field (for users).

#### Scenario: Override via policy

- GIVEN the user has configured `"ack_timeout_ms": 5000` in `~/.config/bg-subagents/policy.jsonc`
- WHEN a completion arms its fallback
- THEN the timer is set to 5000ms

#### Scenario: Test override

- GIVEN a test calls `buildServer(ctx, {ackTimeoutMs: 50})`
- WHEN a completion arms its fallback
- THEN the timer is set to 50ms (for faster test execution)

### Requirement: Single Delivery Per Task

For any given `task_id`, a completion message MUST be delivered at most once to the main chat, regardless of how many delivery channels attempt it. Duplicates are never acceptable.

#### Scenario: Primary succeeds before fallback fires

- GIVEN a completion fires
- AND primary delivery succeeds within 100ms
- WHEN the fallback timer (2000ms) would normally fire
- THEN no second message is injected
- AND the main chat has exactly one completion message for that `task_id`

#### Scenario: Fallback fires while primary is still in flight

- GIVEN a completion fires
- AND primary delivery takes 3000ms
- AND fallback fires at 2000ms
- WHEN primary eventually succeeds
- THEN the fallback's synthetic message is already injected
- AND primary's message is suppressed (via registry-level dedupe flag)
- AND the main chat has exactly one completion message
