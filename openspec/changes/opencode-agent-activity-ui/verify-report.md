# Verification Report: opencode-agent-activity-ui

**Mode**: Standard verification with strict focused Vitest evidence; no build run per user constraint.
**Verdict**: PARTIAL

## Completeness

| Metric | Value |
|---|---:|
| Tasks total | 36 |
| Tasks complete | 25 |
| Tasks incomplete | 11 |

Incomplete items are mostly gated or blocked: visual duplicate/statusline check, Windows terminal glyph smoke, gated OpenCode fork seam spike, manual BG/FG/error smoke blocked by isolated OpenCode auth (`Token refresh failed: 401`), and the explicit build task remains unchecked because build is disallowed for this slice.

## Automated Verification

Expanded focused activity UI slice passed:

```text
pnpm exec vitest run packages/opencode/src/__tests__/tui-plugin/sidebar.test.ts packages/control-tui/src/actions.test.ts packages/control-tui/src/events.test.ts packages/control-tui/src/task-ui.test.ts packages/control-tui/src/orchestrator-activity.test.ts packages/opencode/src/__tests__/runtime.test.ts packages/opencode/src/__tests__/host-compat/v14/delivery.test.ts packages/opencode/src/__tests__/host-compat/legacy/chat-params.test.ts packages/opencode/src/__tests__/host-compat/v14/tool-register.test.ts packages/core/src/__tests__/delivery-format.test.ts

Test Files  10 passed (10)
Tests       88 passed (88)
```

The broader focused suite now includes `packages/opencode/src/__tests__/tui-plugin/sidebar.test.ts`. The prior collection failure (`TypeError: createLogger is not a function`) was resolved by exporting `createLogger` from the Vitest core public facade.

## Manual Smoke / Auth Blocker

Manual visual smoke is **not complete**. It remains blocked by isolated OpenCode auth: `Token refresh failed: 401`. No credential handling was attempted, and the manual smoke tasks are not falsely marked complete.

## Gated OpenCode Fork Seam

The `C:\SDK\opencode-fork` `agent_activity`/`tool_activity` seam spike remains intentionally **not started**. This matches the proposal/design gate: only start after plugin-first V1/V2 limitations are proven. Current implementation keeps transcript cleanup best-effort through plugin/TUI surfaces and compact delivery.

## Static Compliance Summary

| Area | Status | Evidence |
|---|---|---|
| Clean parent transcript / compact delivery | Automated pass | `formatCompactAgentDelivery`, v14 delivery, `deliverBgResult`, runtime JSON extraction tests prove raw NDJSON/log compaction and detail references. |
| Activity data model / aggregation | Automated pass | `ActiveTask` includes refs, status, mode, timestamps, latest/progress events, summary, detail refs; `events.test.ts` covers created/progress/idle/error and bounded history. |
| Agent cards/sidebar UX | Automated pass, manual partial | `task-ui.ts`/`tui.tsx` render BG/FG cards with ASCII status markers, mode, elapsed time, id, latest event; visual duplicate/statusline smoke remains unchecked. |
| Detail console | Automated pass | `formatTaskDetailRows` and TUI detail action show bounded metadata, recent events, result/error preview, and logs/history refs. |
| Orchestrator activity console | Automated pass | `orchestrator-activity.ts` captures compact parent snippets and excludes child progress; TUI renders compact orchestrator lines. |
| FG/BG behavior and controls | Automated pass | `tool-register.test.ts`, `events.test.ts`, and `actions.test.ts` cover immediate BG return, FG running state, move-to-BG refs, dedupe, compact delivery. |
| Windows-safe rendering | Automated partial | Card markers are ASCII (`RUN`, `OK`, `ERR`, `BG`) and tested; live Windows Terminal/conhost glyph smoke remains unchecked. |

## Risks

- Manual UX correctness cannot be fully claimed until auth-blocked visual smoke runs in a real OpenCode session.
- Plugin APIs may still be insufficient for true transcript suppression; the fork seam remains gated and unproven.
- Broader full-repo Vitest may still need dependency/facade cleanup beyond this focused activity UI gate.
- Build/type-check not executed by explicit user constraint.
