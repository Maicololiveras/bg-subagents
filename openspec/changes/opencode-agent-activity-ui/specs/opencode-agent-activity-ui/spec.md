# Delta for opencode-agent-activity-ui

## ADDED Requirements

### Requirement: Clean Main Chat

The OpenCode-facing adapter MUST keep the main chat clean: parent replies MUST be human-readable, and agent activity MUST appear as compact status/summary unless detail is explicitly requested.

#### Scenario: No raw task output in chat

- GIVEN an agent returns NDJSON, logs, or a long transcript
- WHEN the parent chat is updated
- THEN only compact status/id/summary and detail instructions are shown
- AND raw output is hidden from the main chat by default

### Requirement: Compact Activity Notifications

Activity notifications MUST mirror host/delegation style: status, id, mode, short summary, and a clear detail affordance. They MUST be bounded in length.

#### Scenario: BG completion notification

- GIVEN a background activity reaches terminal status
- WHEN the adapter notifies the parent
- THEN the message includes status, id, mode, summary, and detail command/reference
- AND it fits within the configured compact length budget

### Requirement: Orchestrator Activity Panel

Where plugin APIs permit, orchestrator thinking, tool calls, and decisions SHOULD be grouped in an activity panel or mini-console instead of the main chat.

#### Scenario: Grouped activity stream

- GIVEN plugin UI slots can render activity
- WHEN thinking, tool, or decision events occur
- THEN they are grouped by activity/session in the panel
- AND the main chat receives only compact summaries

#### Scenario: Plugin limitation fallback

- GIVEN plugin APIs cannot suppress transcript content
- WHEN detailed activity cannot be moved off-chat
- THEN the adapter uses the cleanest compact card/message available
- AND detail remains available on demand

### Requirement: Agent Cards and Detail Interaction

The UI MUST expose BG and FG agent cards with status, mode, elapsed time, latest event, and detail actions. Click SHOULD open detail; right-click SHOULD expose contextual actions when supported.

#### Scenario: Card shows live status

- GIVEN an activity is running
- WHEN the card renders
- THEN it displays id, BG/FG mode, status, elapsed time, and latest event

#### Scenario: Detail opens on demand

- GIVEN a user clicks an activity card or runs a detail command
- WHEN detail opens
- THEN logs, progress, and result history are shown outside the main chat where possible
