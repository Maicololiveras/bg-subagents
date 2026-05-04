# plan-review Specification

## Purpose

Before the host executes a batch of subagent `task` delegations proposed by the LLM in a single turn, the user sees a consolidated picker listing every planned delegation and chooses BG/FG/Skip for each in a single confirmation. Replaces the per-call picker from v0.1.x on OpenCode 1.14+ hosts.

## Requirements

### Requirement: Batch Detection

The system MUST detect when a single LLM turn contains 2 or more `task` tool calls targeting subagents, and treat them as a "plan" subject to review.

#### Scenario: Multi-delegation detected

- GIVEN an LLM response containing 3 tool-call parts: `task({subagent_type: "sdd-explore", ...})`, `task({subagent_type: "sdd-spec", ...})`, `task({subagent_type: "sdd-design", ...})`
- WHEN `detectBatch(messageParts)` runs
- THEN it returns a batch with 3 entries, each with `agent_name`, `prompt`, and `original_part_index`

#### Scenario: Single-task delegation NOT a batch

- GIVEN an LLM response with exactly 1 `task` tool call and any number of non-task tool calls
- WHEN `detectBatch(messageParts)` runs
- THEN it returns an empty batch array (Plan Review does NOT trigger)
- AND the single `task` call is allowed to proceed (per-call picker handles it if policy says `ask`)

#### Scenario: Zero task calls

- GIVEN an LLM response with no `task` tool calls
- WHEN `detectBatch(messageParts)` runs
- THEN it returns an empty batch array
- AND message transform is a no-op

#### Scenario: Re-entry guard

- GIVEN an LLM response with tool calls that include `task_bg` (our own tool, not core `task`)
- WHEN `detectBatch(messageParts)` runs
- THEN `task_bg` calls are NOT counted as part of any batch
- AND the batch only contains core `task` calls

### Requirement: Picker UI Presentation

When a batch is detected, the system MUST present a picker listing all planned delegations with per-entry mode options. The picker MUST be non-blocking for other UI rendering but MUST block the tool execution until user confirms.

#### Scenario: Picker with 3 delegations

- GIVEN a batch of 3 subagent delegations detected
- WHEN the picker is invoked
- THEN the picker displays each entry with its `agent_name`, truncated prompt (first 60 chars), and three options: `[F]oreground`, `[B]ackground`, `[S]kip`
- AND the picker shows keyboard shortcuts: `[A]` all-background, `[N]` all-foreground, `[Enter]` confirm, `[Esc]` cancel all
- AND the default mode per entry comes from the resolved policy for that `agent_name`

#### Scenario: User confirms with keyboard defaults

- GIVEN the picker is rendered
- AND the default modes per agent are `foreground` (no policy override)
- WHEN the user presses `Enter` without changing any selection
- THEN the picker resolves with all 3 entries marked `foreground`

#### Scenario: User applies "all background" shortcut

- GIVEN the picker is rendered
- WHEN the user presses `A`
- THEN all 3 entries' modes are set to `background`
- AND the picker remains open awaiting final `Enter` confirmation

#### Scenario: User cancels entire batch

- GIVEN the picker is rendered
- WHEN the user presses `Esc`
- THEN the picker resolves with a `cancelled` result
- AND no tool calls are executed
- AND a synthetic assistant message SHOULD inform the LLM that the user cancelled

#### Scenario: Picker timeout applies defaults

- GIVEN the picker is rendered with a configured `timeout_ms` (default 2000ms if not specified in policy)
- WHEN the user does not interact within the timeout window
- THEN the picker resolves with each entry at its policy-resolved default mode
- AND an info log is emitted with `plan-review:timeout-default`

### Requirement: Message Part Rewriting

After the user confirms, the system MUST rewrite the LLM's message parts to reflect the chosen modes:
- `foreground` entries: leave the `task` call unchanged
- `background` entries: swap the tool call from `task` to `task_bg` with the same args
- `skip` entries: remove the tool call part entirely (and any dependent text)

#### Scenario: Mixed BG/FG plan

- GIVEN the user confirms: entry 0 = background, entry 1 = foreground, entry 2 = skip
- WHEN the transformed message parts are returned
- THEN part at index 0 has its `tool` field replaced with `"task_bg"` and args preserved
- AND part at index 1 is unchanged (still `task`)
- AND part at index 2 is removed from the parts array
- AND the host executes the rewritten plan

#### Scenario: All skipped

- GIVEN the user selects skip for all entries
- WHEN the transformed message parts are returned
- THEN all task-related parts are removed
- AND a `<user-notice>` text part is injected: `"User skipped all subagent delegations; respond without them."`

### Requirement: Non-TTY Fallback

If the session is running without a TTY (e.g., `opencode run` headless mode, CI), the system MUST fall back to applying the policy-resolved default mode for each entry without prompting.

#### Scenario: Headless mode

- GIVEN `process.stdout.isTTY === false`
- AND a batch of 2 delegations is detected
- WHEN Plan Review runs
- THEN no picker is shown
- AND each entry is resolved using its policy default mode
- AND an info log is emitted with `plan-review:headless-auto`

### Requirement: Per-Session Plan Review Toggle

The system SHOULD expose a way for the user to disable Plan Review for the current session (e.g., a keybind or slash command `/task plan-review off`). When disabled, all `task` calls pass through unchanged and are handled by the per-call picker or policy default.

#### Scenario: Disable Plan Review for session

- GIVEN Plan Review is enabled by default
- WHEN the user runs `/task plan-review off`
- THEN subsequent batches in the same session bypass the picker
- AND a toast confirms: `"Plan Review disabled for this session"`
- AND the setting is NOT persisted across sessions (defaults back to on in a new session)
