# Proposal: OpenCode Agent Activity UI

## Problem

Background/foreground agent work is visible, but the main chat can become polluted with implementation detail, logs, or host-layer notifications. `[TASK NOTIFICATION]` is a host/delegation-layer pattern, not OpenCode core, yet its contract is the right UX: compact status now, full detail on demand.

## Goals

- Keep the chat principal clean with compact agent status/summary only.
- Replicate compact notification/status plus detail-readable-on-demand UX.
- Implement plugin-first in `bg-subagents` with strict TDD and Vitest.
- Support BG `task_bg` first, while allowing FG `task` and host `delegate` observation where plugin APIs permit.

## Non-goals

- No product-code changes in this proposal phase.
- No build verification for this phase.
- No OpenCode fork work unless plugin APIs cannot keep transcript detail clean.
- No first-class upstream API commitment before a spike proves the seam.

## Proposed Approach

Enhance `bg-subagents` as the implementation center: model each agent activity with id, mode, status, summary, parent/child refs, logs refs, and detail refs. Render compact cards/status via the TUI plugin/sidebar/dialog surfaces and keep `/task show|logs` as fallback detail access. Make completion delivery concise and detail-on-demand oriented; only spike `opencode-fork` for transcript suppression/custom card seams that plugins cannot provide.

## Scope Slices

### V1 Plugin-first activity UI

- TDD compact delivery formatting, `task_bg` metadata, and parent-chat hygiene.
- Add/extend TUI status/cards/detail dialogs from registry/events.
- Validate no raw logs/results are pushed into the main chat by default.

### V2 Detail routes and persisted history

- Persist activity history/detail references for later retrieval.
- Add detail navigation/routes or dialogs backed by registry/history.
- Keep slash commands as stable fallback UX.

### V3 OpenCode seam spike

- Prototype only if V1/V2 cannot clean transcript behavior.
- Explore plugin API for compact activity card, external detail renderer, and transcript visibility policy.

## Risks and Tradeoffs

- Plugin APIs may not support transcript suppression; mitigate with V3 spike gate.
- Multiple TUI plugins may overlap visually; define ownership or consolidate event observation.
- Host notification attribution is high-confidence but indirect; avoid coupling to undocumented producer internals.
- Plugin-first is lower risk but may not deliver a true mini-console without upstream seams.

## Validation Plan

- Strict TDD with Vitest for formatter, metadata, event/card mapping, and detail lookup behavior.
- Snapshot or unit tests for compact wording and no-log parent delivery.
- Manual OpenCode/TUI smoke only after tests; no build in this phase.
- Rollback by disabling new TUI surfaces/delivery formatting and retaining existing `/task` commands.

## Open Questions

- Can current TUI APIs provide acceptable detail navigation without transcript ownership?
- Should `bg-subagents` absorb `opencode-subagent-statusline` behavior or interoperate beside it?
- What minimum OpenCode seam is needed if plugin-first cannot hide detail cleanly?
