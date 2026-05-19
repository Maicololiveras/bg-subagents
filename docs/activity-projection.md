# Activity Projection + Clean Transcript (PR5)

This note captures the PR5 verification/docs boundary for
`clean-transcript-activity-boxes`.

## Default clean transcript scope

- Show only **user messages + assistant final answers + compact activity refs**.
- Internal runtime activity is represented as activity boxes/cards, not inline transcript noise.

## Safety + bounded signals

By default, projection and delivery surfaces must emit bounded, safe summaries only:

- Allowed: state transitions, compact progress snippets, compact errors/results, inspectable refs.
- Not allowed by default: raw chain-of-thought, raw stdout, full logs, full child transcripts.

## Canonical architecture entities

- `AgentActivityProjection`
- `ActivityBoxVM`
- `DetailVM`
- `TranscriptSummaryVM`

`control-tui` is the canonical richer interaction model and `opencode` TUI plugin
is a lightweight projection consumer.

## Policy-gated action model

- Read-only defaults enabled: `inspect`, `focus`, `enter`.
- Side effects gated + host/runtime revalidation required: `kill`, `cancel`, `move-to-BG`.

## Host seam limits

OpenCode host/plugin seams currently limit full transcript suppression/replacement.
When complete suppression is unavailable, delivery must remain compact and bounded
via `TranscriptSummaryVM`-style summaries.

## PR5 verification smoke plan

Verification command used for this PR5 slice:

```bash
pnpm exec vitest run \
  packages/core/src/activity-projection.test.ts \
  packages/core/src/__tests__/delivery-format.test.ts \
  packages/opencode/src/__tests__/host-compat/v14/delivery.test.ts \
  packages/control-tui/src/task-ui.test.ts \
  packages/control-tui/src/events.test.ts \
  packages/control-tui/src/orchestrator-activity.test.ts \
  packages/control-tui/src/actions.test.ts \
  packages/opencode/src/__tests__/tui-plugin/sidebar.test.ts \
  packages/opencode/src/__tests__/tui-plugin/keybinds.test.ts \
  packages/opencode/src/__tests__/tui-plugin/index.test.ts \
  packages/opencode/src/__tests__/tui-plugin/shared-state.test.ts
```

### 1) Config smoke (local contract)

1. Validate policy defaults and overrides resolve predictably.
2. Validate read-only actions stay enabled by default and side-effect actions stay gated by default.

### 2) Synthetic event smoke (automated)

1. Run projection tests for normalization, dedupe, bounds, sanitization.
2. Run delivery-format + v14 delivery tests to ensure compact output/no raw internals leakage.
3. Run control-tui parity/action tests for canonical FG/BG projection behavior.
4. Run opencode plugin sidebar/keybind/index tests for lightweight consumer behavior and policy gates.

### 3) Real visual smoke (deferred)

Deferred until blockers are solved:

- OpenCode auth 401 in host run path.
- Plugin loadout mismatch/wrong plugin in local environment.
- Potential stale/zombie active card detection follow-up (`active sdd-apply 898m58` seen while no live delegation/process was detected).

### Blocker status (PR5)

| Blocker | Status | Notes |
|---|---|---|
| OpenCode auth 401 | Open | Prevents reliable real-host visual verification pass. |
| Plugin loadout mismatch/wrong plugin | Open | Synthetic/plugin unit tests pass, but local host runs still show mismatched plugin loadout in some environments. |
| Stale/zombie active card (`active sdd-apply 898m58`) | Open follow-up | Included in verification/docs as known smoke follow-up; no confirmed live delegation/process during observation window. |

Once blockers are fixed, execute visual smoke:

1. Launch OpenCode with verified plugin loadout.
2. Spawn one FG and one BG delegated task.
3. Confirm transcript stays clean (user + final + compact refs only).
4. Confirm cards are expandable/focusable; Enter remains read-only navigation.
5. Confirm side-effect actions require gate + revalidation before execution.
