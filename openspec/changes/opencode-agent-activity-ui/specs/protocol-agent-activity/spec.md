# Delta for protocol-agent-activity

## ADDED Requirements

### Requirement: Structured Compact Agent Delivery

Agent-to-parent delivery MUST use a structured, compact contract containing `id`, `mode`, `status`, `summary`, and detail references. It MUST NOT require raw NDJSON, full transcripts, or long logs in parent chat.

#### Scenario: Compact completion payload

- GIVEN an agent finishes with logs and result detail
- WHEN it delivers to the parent
- THEN the parent-facing payload includes status, id, mode, summary, and detail references
- AND raw logs/transcripts are excluded from the compact payload

#### Scenario: Detail remains addressable

- GIVEN compact delivery references detail by id
- WHEN a caller requests detail by that id
- THEN the full progress, logs, and result are retrievable on demand

### Requirement: Foreground and Background Semantics

The contract MUST distinguish FG and BG modes. FG MUST block parent continuation until terminal status; BG MUST NOT block parent continuation. Both modes MUST use compact delivery, and the parent MAY consolidate multiple terminal summaries.

#### Scenario: FG blocks parent turn

- GIVEN a foreground agent is running
- WHEN the parent turn evaluates continuation
- THEN continuation waits for agent terminal status
- AND compact status remains available during execution

#### Scenario: BG does not block parent turn

- GIVEN a background agent is running
- WHEN the parent receives the spawn acknowledgement
- THEN the parent may continue responding immediately
- AND completion is delivered later as a compact notification

### Requirement: Windows-Compatible Presentation Tokens

Protocol-provided visual tokens SHOULD have ASCII-safe fallbacks for symbols and SHOULD define semantic color names rather than terminal-specific escape sequences.

#### Scenario: Windows fallback symbols

- GIVEN a Windows terminal without reliable glyph support
- WHEN an activity status is rendered
- THEN the renderer can choose ASCII-safe tokens such as `[RUN]`, `[OK]`, `[ERR]`, or `[BG]`
