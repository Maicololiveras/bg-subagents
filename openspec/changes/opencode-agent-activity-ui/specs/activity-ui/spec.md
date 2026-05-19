# activity-ui Specification

## ADDED Requirements

### Requirement: Clean parent transcript

The system MUST keep the parent chat focused on user-facing summaries and MUST NOT include raw logs, stdout, internal reasoning, or full child-agent transcripts by default.

#### Scenario: Background task completes

- GIVEN a `task_bg` activity has completed with logs and a result
- WHEN completion is delivered to the parent session
- THEN the parent transcript MUST show only compact status, summary, and a detail reference
- AND full logs MUST remain available through detail access.

#### Scenario: Foreground task completes

- GIVEN a foreground `task` activity has completed while the parent turn is active
- WHEN the parent transcript renders the result
- THEN it MUST show a compact completion card or summary
- AND raw child transcript detail MUST be hidden from the main transcript by default.

### Requirement: Compact activity notification

The system MUST deliver concise activity notifications containing id, agent, status, summary, and detail reference.

#### Scenario: Agent completes successfully

- GIVEN an agent activity finishes successfully
- WHEN the notification is formatted
- THEN it MUST include success status, agent identity, task id, concise outcome, and detail reference.

#### Scenario: Agent fails

- GIVEN an agent activity finishes with an error
- WHEN the notification is formatted
- THEN it MUST include failure status, agent identity, task id, concise error summary, and detail reference.

### Requirement: Agent activity cards

The system SHOULD render running and terminal agent activity as compact cards using available TUI/plugin surfaces.

#### Scenario: Background agent running

- GIVEN a `task_bg` entry is running in the registry
- WHEN activity UI data is rendered
- THEN the card SHOULD show background mode, agent name, task id, status, and elapsed time.

#### Scenario: Foreground agent running

- GIVEN a foreground `task` or observed delegate is running
- WHEN activity UI data is rendered
- THEN the card SHOULD show foreground mode, agent name, status, and available child-session or detail reference.

### Requirement: Agent detail console

The system MUST provide on-demand access to full agent details without polluting the parent transcript.

#### Scenario: User opens agent detail

- GIVEN an activity card or reference exists
- WHEN the user opens detail for that id
- THEN the console MUST show result, metadata, logs, and relevant parent/child refs.

#### Scenario: Large logs exist

- GIVEN an activity has large logs
- WHEN detail is opened
- THEN the console MUST preserve readable access without inserting those logs into the parent transcript.

### Requirement: Orchestrator activity console

The system MAY expose parent orchestration activity outside the main transcript when host UI seams allow it.

#### Scenario: Parent is reasoning and using tools

- GIVEN the parent is reasoning or using tools during orchestration
- WHEN the UI supports an external activity console
- THEN internal activity SHOULD appear there instead of as verbose parent transcript content.

### Requirement: Windows-compatible visual rendering

The system MUST remain readable in Windows terminals that lack emoji glyph support.

#### Scenario: Terminal lacks emoji glyphs

- GIVEN the terminal cannot render emoji reliably
- WHEN cards or notifications are shown
- THEN status MUST remain understandable through ASCII text labels such as `running`, `done`, and `failed`.

### Requirement: Structured delivery contract

The system MUST prefer structured agent results and MUST compact raw/free-text results safely.

#### Scenario: Agent returns valid structured result

- GIVEN an agent returns `status`, `executive_summary`, `artifacts`, `risks`, and `next_recommended`
- WHEN compact delivery is formatted
- THEN those fields SHOULD be preserved as the parent-facing summary.

#### Scenario: Agent returns raw/free text

- GIVEN an agent returns unstructured text or logs
- WHEN compact delivery is formatted
- THEN the system MUST extract a short safe excerpt and point to logs/history for full detail.
