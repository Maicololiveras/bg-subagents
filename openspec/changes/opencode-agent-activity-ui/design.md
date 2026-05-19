# Design: OpenCode Agent Activity UI

## Context

`bg-subagents` already splits protocol, core, and OpenCode adapter code. BG execution is exposed through `task_bg`, stored in `TaskRegistry`, surfaced by `/task` commands and a TUI sidebar, and completed through `createV14Delivery()` using `client.session.prompt({ noReply: true })`. OpenCode core has native FG `task` cards, but plugin seams do not currently own transcript rendering or suppression.

## Goals

- Keep parent chat clean: compact status plus detail reference only.
- Use plugin-first surfaces for BG activity and observable FG activity.
- Keep `/task show|logs` as fallback detail access.
- Spike an OpenCode fork seam only for transcript-level mini-console gaps.

## Architecture Overview

Plugin-first layering stays intact:

```text
agent run -> TaskRegistry -> activity projection -> TUI card/detail
                     |-> compact delivery -> parent noReply message
```

Core owns formatting and activity shape. The OpenCode adapter owns host metadata, delivery, slash-command fallback, and TUI rendering.

## Data Model

Activity records SHOULD project existing `TaskState` plus metadata:

| Field | Source | Purpose |
|---|---|---|
| `id` | registry task id | stable lookup/detail key |
| `mode` | `meta.mode` | `bg` or `fg` display |
| `agentName` | `agent_name/agent/subagent_type` | card identity |
| `status` | task status | running/done/failed mapping |
| `summary` | result/error formatter | parent-facing outcome |
| `detailRef` | task id/history path/session refs | on-demand lookup |
| `parentSessionId` / `childSessionId` | tool/session metadata | navigation when available |

## Event Flow

```text
task_bg execute
  -> registry.spawn(meta: mode, agent, prompt, parent_session_id)
  -> immediate tool output: "running in background"
  -> completion event
  -> formatCompactAgentDelivery()
  -> noReply parent message
  -> sidebar/detail reads registry/history
```

FG `task` and host `delegate` are observed from TUI/plugin events when available; unsupported fields degrade to compact cards without navigation.

## UI Model

Cards show `status`, `mode`, `agentName`, `id`, elapsed time, and a detail hint. Detail console/dialog shows metadata, result, error, logs, and refs. Windows rendering MUST use text labels first; icons are optional decoration only.

## Delivery Contract

Agents SHOULD return `status`, `executive_summary`, `artifacts`, `risks`, and `next_recommended`. `formatCompactAgentDelivery()` preserves structured compact output; raw/free text is reduced to a bounded excerpt with logs/history reference.

## OpenCode Fork Seam Spike

Spike only if plugin-first cannot keep transcript clean. Candidate seam: plugin-provided `agent_activity` part with summary renderer, detail provider, and transcript visibility policy. Do not commit to upstream API before proving current TUI slots are insufficient.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Core | structured/raw/error formatting | Vitest unit + snapshots |
| Adapter | `task_bg` metadata and delivery refs | Vitest with fake registry/client |
| TUI | card projection and sorting | Vitest using `getSidebarData(nowMs)` |
| Compatibility | Windows-safe labels/no emoji dependency | snapshot assertions |

No build in this phase.

## Migration and Compatibility

No data migration. Existing `/task list|show|logs|move-bg|kill|policy` remains stable fallback UX. Existing OpenCode 1.14+ v14 adapter branches stay explicit; legacy hosts degrade to current delivery behavior.

## Risks

- Current plugin APIs may not suppress transcript internals; fork seam may be required.
- Multiple TUI plugins can duplicate activity UI unless ownership is clarified.
- Host `delegation_read` notification source is inferred, not source-proven.
- FG activity may expose fewer refs than BG `task_bg` metadata.
