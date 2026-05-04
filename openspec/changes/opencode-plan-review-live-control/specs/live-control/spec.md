# live-control Specification

## Purpose

While a foreground subagent task is executing and blocking the main conversation, the user can intervene via keyboard shortcut or slash command to move it to background. Implemented as an OpenCode 1.14+ TUI plugin module; not available on legacy hosts.

## Requirements

### Requirement: Keybind Registration

The TUI plugin MUST register a keybind (default: `Ctrl+B`) that triggers the "move to background" flow for the currently-running foreground subagent task, if any.

#### Scenario: Default keybind active

- GIVEN the TUI plugin is loaded
- WHEN the OpenCode TUI starts a session
- THEN the keybind `Ctrl+B` is registered and visible in the keybind list
- AND the keybind action is labeled `"Move current task to background"`

#### Scenario: User-overridden keybind

- GIVEN the user has configured a custom keybind in `opencode.json` or `~/.config/opencode/keybinds.json` mapping `"bg-subagents.move-bg"` to `Ctrl+Alt+B`
- WHEN the TUI plugin loads
- THEN the keybind honors the user override
- AND `Ctrl+B` is NOT bound by our plugin

### Requirement: Move-to-Background Flow

When the user invokes the move-to-background action and there is an active foreground subagent task, the system MUST:
1. Display a confirmation dialog
2. On confirm: cancel the foreground task
3. Re-spawn an equivalent task via `task_bg` with the same args
4. Deliver the new task's `task_id` to the main chat as a notification

#### Scenario: Confirm move-to-bg with running FG task

- GIVEN a foreground `task(subagent_type: "sdd-explore", prompt: "...")` is currently executing
- WHEN the user presses `Ctrl+B`
- THEN a confirmation dialog appears with title `"Move subagent to background?"` and message `"The current foreground task will be cancelled and restarted in the background. Any progress will be lost. Proceed?"`
- AND the dialog has two options: `[C]onfirm`, `[A]bort`

#### Scenario: User confirms move

- GIVEN the confirmation dialog is shown
- WHEN the user presses `C` or `Enter`
- THEN `client.tool.cancel(callID)` is invoked (or `client.session.abort()` as fallback)
- AND a `task_bg` invocation is posted via `client.session.message.send` with the same args as the cancelled task
- AND a toast appears: `"Task moved to background. ID: {task_id}. Use /task list to monitor."`

#### Scenario: User aborts move

- GIVEN the confirmation dialog is shown
- WHEN the user presses `A` or `Esc`
- THEN the dialog closes with no action
- AND the foreground task continues running
- AND no toast is shown

#### Scenario: No active foreground task

- GIVEN no foreground subagent task is currently running
- WHEN the user presses `Ctrl+B`
- THEN a toast is shown: `"No foreground task to move"`
- AND no dialog is opened

#### Scenario: Cancel fails

- GIVEN the move-to-bg flow begins
- AND `client.tool.cancel(callID)` throws or times out after 3000ms
- WHEN the cancel step fails
- THEN the flow aborts
- AND a toast is shown: `"Move-to-background failed: could not cancel task"`
- AND the original foreground task may still be running (we did not create a BG duplicate)

### Requirement: Slash Command Registration

The TUI plugin MUST register the following slash commands:

| Command | Arguments | Behavior |
|---|---|---|
| `/task list` | `[--status=<s>] [--agent=<a>] [--since=<t>]` | List tasks with optional filters |
| `/task show <id>` | — | Print full detail for a task |
| `/task logs <id>` | `[--tail=N]` | Stream JSONL log lines |
| `/task kill <id>` | — | Abort a running task (FG or BG) |
| `/task move-bg <id>` | — | Explicitly move an FG task to BG by id |

#### Scenario: List all running tasks

- GIVEN 2 BG tasks running and 1 FG task running
- WHEN the user runs `/task list`
- THEN the output table shows 3 rows with columns: `id`, `status`, `agent`, `started`, `duration`, `mode`
- AND statuses are accurately reflected (`running`, `completed`, `killed`, `error`)

#### Scenario: Filter by status

- GIVEN 5 tasks of mixed statuses
- WHEN the user runs `/task list --status=completed`
- THEN only completed tasks are shown

#### Scenario: Kill a running task

- GIVEN a BG task with id `tsk_abc123` is running
- WHEN the user runs `/task kill tsk_abc123`
- THEN the task's status transitions to `killed`
- AND a toast: `"Task tsk_abc123 killed"`
- AND `/task list` no longer shows it as running

#### Scenario: Move-bg by explicit id (for user-initiated without keybind)

- GIVEN a FG task `tsk_xyz789` is running
- WHEN the user runs `/task move-bg tsk_xyz789`
- THEN the same flow as the `Ctrl+B` keybind executes (confirmation + cancel + re-spawn)

### Requirement: Optional Sidebar Status Slot

The TUI plugin MAY register a sidebar slot (`sidebar_content`) that shows a live-updating list of active BG tasks with status, elapsed time, and `agent_name`. This is optional and SHOULD be toggleable via `/task sidebar on|off`.

#### Scenario: Sidebar on with 2 active BG tasks

- GIVEN 2 BG tasks are running
- AND `/task sidebar on` was issued earlier (or default is on per config)
- WHEN the session UI renders
- THEN the sidebar shows a section `"Background tasks (2)"` with one row per task
- AND rows update at minimum every 1000ms

#### Scenario: Sidebar off

- GIVEN `/task sidebar off` was issued
- WHEN the session UI renders
- THEN no bg-subagents section appears in the sidebar

### Requirement: TUI Plugin Independent Loading

The TUI plugin MUST be loadable independently of the server plugin via a separate package subpath export: `@maicolextic/bg-subagents-opencode/tui`. Loading the TUI plugin without the server plugin SHOULD work but with degraded features (no task state access).

#### Scenario: Both plugins loaded

- GIVEN the user's `opencode.json` has `"plugin": ["@maicolextic/bg-subagents-opencode", "@maicolextic/bg-subagents-opencode/tui"]`
- WHEN OpenCode boots
- THEN both plugins load
- AND the TUI can query the server plugin's task registry via shared state (process-local)

#### Scenario: Only TUI plugin loaded

- GIVEN the user's `opencode.json` has only `"plugin": ["@maicolextic/bg-subagents-opencode/tui"]`
- WHEN OpenCode boots
- THEN the TUI plugin loads
- AND slash commands are registered but `/task list` shows `"Server plugin not loaded — task registry unavailable"`
- AND `Ctrl+B` shows a toast: `"Server plugin not loaded; cannot move task to background"`

### Requirement: Not Loaded on Legacy Hosts

The TUI plugin module MUST NOT load on OpenCode versions that do not support the TUI plugin API (< 1.14). Attempting to register it on a legacy host MUST fail gracefully without crashing OpenCode.

#### Scenario: Legacy host rejects TUI plugin

- GIVEN OpenCode version < 1.14 (legacy API)
- AND the user's config includes `"plugin": [".../tui"]`
- WHEN OpenCode attempts to load the TUI plugin
- THEN either OpenCode refuses to load it (preferred) or our entry file immediately throws with `"TUI plugin requires OpenCode >= 1.14.0"`
- AND the server plugin continues to work normally via legacy compat path
