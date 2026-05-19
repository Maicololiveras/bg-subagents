# Tasks: OpenCode Agent Activity UI

## 1. Delivery/result contract

- [x] Add/adjust tests proving background completion never posts raw NDJSON, full stdout, or long logs to the parent transcript.
- [x] Add/adjust tests proving foreground completion is steered toward compact structured output.
- [x] Ensure `opencode run --format json` extraction returns final text events, not raw JSON event streams.
- [x] Normalize free-form agent output into the compact delivery format with task/log references.

## 2. Activity data model and aggregation

- [x] Define/extend activity record fields: task id, parent session id, child session id, agent, mode, status, timestamps, latest event, bounded progress events, summary, detail/log refs, delivered flag.
- [x] Add tests for event-to-activity aggregation from `session.created`, `message.part.updated`, `session.idle`, and `session.error`.
- [x] Bound progress/history stored in memory so large outputs do not degrade the TUI.

## 3. Agent cards/sidebar UX

- [x] Render BG/FG agent cards in `control-tui` with status marker, agent name, mode, elapsed time, short task id, and latest compact event.
- [x] Preserve existing policy, Codex status, and token sections.
- [x] Add tests/helpers for stable card labels and Windows-safe symbols.
- [ ] Verify no duplicate/conflicting display with `opencode-subagent-statusline` in the visual instance.

## 4. Agent detail console

- [x] Add “View details / Ver detalle” action for every task card.
- [x] Detail view shows task id, agent, mode, status, elapsed, prompt/description preview, latest events, result preview, and logs/history reference.
- [x] Large logs are shown as bounded excerpts only.
- [x] Existing actions remain available where valid: move FG to BG, kill, dismiss/back.

## 5. Orchestrator activity console

- [x] Capture parent/orchestrator activity snippets from available session/message/tool events.
- [x] Group activity by parent turn: thinking, tool use, decision/status, delivery.
- [x] Render a compact orchestrator console section or detail view without hiding the final answer.
- [x] Keep transcript cleanup best-effort unless OpenCode exposes a transcript-render seam.

## 6. FG/BG behavior and controls

- [x] Verify BG tasks return immediately and continue updating cards while parent remains interactive.
- [x] Verify FG tasks block parent but still show a running card/detail state.
- [x] Verify move-to-BG transitions status honestly and preserves detail refs.
- [x] Verify completion delivery is deduplicated and parent-facing text is compact.

## 7. Windows-safe visual polish

- [x] Replace fragile emoji with safe symbols plus colors, or provide terminal fallback.
- [ ] Confirm no replacement glyphs, stray asterisks, or question marks in Windows Terminal/conhost.
- [x] Keep color meaningful but not required to understand state.

## 8. OpenCode fork seam spike (gated)

- [ ] Only start after plugin-first V1/V2 limitations are proven.
- [ ] Prototype a local `agent_activity`/`tool_activity` transcript seam in `C:\SDK\opencode-fork`.
- [ ] Test whether plugin can provide compact card + external detail renderer + transcript visibility policy.
- [ ] Draft upstream issue/PR notes only after local spike proves value.

## 9. Verification/manual smoke

- [x] Run focused Vitest tests for delivery, extraction, aggregation, and UI helpers.
- [ ] Manual smoke: run BG task, keep typing in parent, open detail, verify compact completion.
- [ ] Manual smoke: run FG task, observe blocking card/detail, verify compact final response.
- [ ] Manual smoke: trigger error/cancel and verify card/detail/no duplicate delivery.
- [ ] Manual visual smoke currently blocked by isolated OpenCode auth: `Token refresh failed: 401`; do not handle credentials in this slice.
- [ ] Do not run build unless explicitly requested.
