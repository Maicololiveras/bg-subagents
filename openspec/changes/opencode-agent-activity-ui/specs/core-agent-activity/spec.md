# Delta for core-agent-activity

## ADDED Requirements

### Requirement: Agent Activity Record

Core MUST model each activity with id, status, mode, elapsed time, latest event, summary, parent/child references, and detail/log/result references.

#### Scenario: Activity record is complete

- GIVEN a BG or FG task is registered
- WHEN its activity record is read
- THEN the record exposes mode, status, elapsed time, latest event, summary, and references

#### Scenario: Latest event updates compactly

- GIVEN an activity emits progress events
- WHEN a new event is accepted
- THEN `latestEvent` changes without appending full logs to the parent message

### Requirement: On-Demand Detail History

Core MUST retain activity history sufficient for detail panels and slash-command fallbacks to show progress, logs, and results on demand.

#### Scenario: Detail panel reads history

- GIVEN an activity has progress, logs, and a final result
- WHEN detail is requested by id
- THEN history returns ordered progress, logs, and result sections

#### Scenario: Unknown detail id

- GIVEN a requested activity id is absent or expired
- WHEN detail is requested
- THEN the system returns a compact not-found response
- AND parent chat is not filled with diagnostic dumps

### Requirement: Parent Chat Hygiene

Core delivery formatting MUST produce human-readable parent summaries and MUST NOT include raw NDJSON, unbounded logs, stack traces, or full transcripts by default.

#### Scenario: Long transcript is summarized

- GIVEN an agent produces a long transcript
- WHEN compact delivery is formatted
- THEN the formatter emits a short human summary plus detail reference
- AND omits the full transcript
