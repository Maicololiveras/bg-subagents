## Exploration: opencode-agent-activity-ui

### Current State

`[TASK NOTIFICATION] ... Use delegation_read(id)` was not found in `C:\SDK\opencode-fork`, `C:\SDK\bg-subagents`, `~/.config/opencode`, or installed plugin packages. The visible evidence points to the OpenCode host/delegation layer exposed to this API session, not OpenCode core, Gentle-AI prompts, or `bg-subagents` itself. In this environment, `delegation_read` and `delegation_list` are explicit host/API tools enabled for the `gentle-orchestrator` agent in `~/.config/opencode/opencode.json`, and the notification contract matches that host-native async delegation model: compact completion notice, full payload read on demand.

OpenCode core already has a native synchronous `task` tool. `packages/opencode/src/tool/task.ts` creates a child session, stores `metadata.sessionId`, and returns a full `<task_result>` into the parent tool output. The UI already renders `task` as an agent card in `packages/ui/src/components/message-part.tsx`: it shows agent name, spinner while running, description/session id, and click-through to the child session. That is a strong existing pattern for FG agent cards, but it still lives in the main transcript as a tool part and foreground execution blocks.

`bg-subagents` adds external background execution through an OpenCode server plugin (`task_bg`) plus a separate TUI plugin. The repository has a clean package split (`protocol` → `core` → `opencode`) and a `TaskRegistry` shared from server plugin to TUI plugin through `globalThis[Symbol.for("@maicolextic/bg-subagents/shared")]`. Completion delivery currently posts compact assistant text through `client.session.prompt({ noReply: true })`; full detail is available via registry/history and `/task show|logs`. The current local `~/.config/opencode/tui.json` does not load `@maicolextic/bg-subagents-opencode/tui`; it loads `opencode-subagent-statusline` and `opencode-sdd-engram-manage` (the latter was not present under `~/.opencode/node_modules`).

An installed external plugin, `opencode-subagent-statusline`, already proves that a TUI-only plugin can observe OpenCode events (`session.created`, `session.updated`, `session.idle`, `session.error`, `message.updated`, `message.part.updated`) and render a sidebar section with subagent status. It tracks core `task` and a host/API `delegate` tool, but not `task_bg` unless extended. This is the closest existing external pattern for agent cards/status without touching core.

### Affected Areas

- `C:\SDK\bg-subagents\packages\core\src\delivery-format.ts` — current compact human delivery formatter; already supports non-log summaries and references.
- `C:\SDK\bg-subagents\packages\opencode\src\host-compat\v14\tool-register.ts` — `task_bg` spawn metadata and immediate compact output; can add richer metadata for cards/detail.
- `C:\SDK\bg-subagents\packages\opencode\src\host-compat\v14\delivery.ts` — posts completion into parent chat; candidate to make completion cleaner and detail-on-demand oriented.
- `C:\SDK\bg-subagents\packages\opencode\src\host-compat\v14\slash-commands.ts` — existing `/task list|show|logs|move-bg|kill|policy`; can back a detail panel or remain fallback UX.
- `C:\SDK\bg-subagents\packages\opencode\src\tui-plugin\sidebar.ts` and `keybinds.ts` — current read-only/sidebar/dialog surface; can become real agent cards/detail panel if OpenCode TUI slots are enough.
- `C:\SDK\opencode-fork\packages\plugin\src\tui.ts` — current TUI plugin seam exposes sidebar/home/prompt slots, command API, event bus, route navigation, client, KV, and dialogs.
- `C:\SDK\opencode-fork\packages\ui\src\components\message-part.tsx` — core UI transcript rendering; already has the `task` card pattern and would be touched for a true transcript-level mini-console or custom `task_bg` card.
- `C:\SDK\opencode-fork\packages\opencode\src\session\prompt.ts` and `tool/task.ts` — native FG task lifecycle and child-session creation; any first-class BG/FG agent activity model would likely hook here.

### What can be external today vs OpenCode-fork required

External plugin today:
- Compact completion notice for BG tasks via `bg-subagents` delivery formatter and `noReply` parent message.
- On-demand details via `/task show`, `/task logs`, registry/history, and TUI dialogs/sidebar.
- Sidebar/statusline/cards for observed `task`, `delegate`, and `task_bg` activity using TUI `api.event.on(...)` plus `sidebar_content`/`home_bottom` slots.
- Keybind/command UX for “open agent panel”, “focus BG”, “focus FG”, “show logs”, “move FG to BG”.
- Human answer hygiene by strengthening `task_bg` tool output and system steering so parent replies summarize, not dump raw JSON/logs.

Needs OpenCode fork or upstream seam:
- Keeping reasoning/thinking/tools/decisions in an orchestrator mini-console outside the main transcript. Existing TUI slots do not expose a replacement transcript renderer or per-message display policy.
- Hiding/suppressing selected tool output from the main transcript while keeping it addressable in a detail panel. Plugin hooks can mutate execution outputs, but not provide a first-class “tool result stored, transcript card only” semantic across UI/API.
- First-class clickable `task_bg` cards in the same transcript layer as core `task` unless represented as normal tool parts or OpenCode adds a custom activity/agent part type.
- FG blocking with live detail visible in the parent transcript/panel if native `task` blocks the turn and the current TUI can only observe events/slots, not own the transcript layout.

### Approaches

1. **Plugin-first, host-notification pattern** — improve `bg-subagents` around compact notification + on-demand detail, and use TUI sidebar/dialogs for cards.
   - Pros: lowest risk, follows the proven host `delegation_read` shape, no upstream dependency, testable in `bg-subagents` with Vitest.
   - Cons: cannot fully move transcript internals into a mini-console; main chat still receives tool/card artifacts allowed by current OpenCode UI.
   - Effort: Medium.

2. **External statusline convergence** — either extend or copy the event-driven pattern from `opencode-subagent-statusline` so `bg-subagents` cards cover `task`, `delegate`, and `task_bg` consistently.
   - Pros: proves feasibility of cards/sidebar as external TUI plugin; covers native FG `task` without needing server shared state only.
   - Cons: event payload compatibility risk; duplicate plugins may conflict visually unless consolidated.
   - Effort: Medium.

3. **OpenCode seam spike** — prototype a local upstream API for agent activity: compact transcript card + detail panel source + optional transcript suppression/grouping.
   - Pros: solves the real UX target cleanly: mini-console, cards, FG/BG activity, and detail-on-demand as first-class UI.
   - Cons: higher design/review burden; requires upstream acceptance and careful compatibility story.
   - Effort: High.

### Recommendation

Start plugin-first and deliberately mirror the host delegation pattern: every agent activity should emit a compact, human-readable parent-facing event/card with an opaque id/reference, while full logs/result live in a detail surface read on demand. Use `bg-subagents` as the implementation center for BG and current `/task`/TUI detail. In parallel, run a small spike in `C:\SDK\opencode-fork` only for the missing seam: a generic `agent_activity`/`tool_activity` UI extension that lets plugins provide card summary + detail renderer + transcript visibility policy.

### Suggested SDD slices

1. **Explore/proposal slice: current UX contract** — document compact notification + on-demand detail as the canonical pattern, including the finding that `[TASK NOTIFICATION]` is host/delegation-layer behavior.
2. **Spec/design slice: external plugin capability** — specify agent activity model in `bg-subagents`: task id, parent session, child session, mode, status, progress, summary, detail refs, logs refs.
3. **Implementation slice A: clean delivery and metadata** — TDD around `formatCompactAgentDelivery`, `task_bg` metadata, completion wording, and parent answer hygiene. No OpenCode fork required.
4. **Implementation slice B: TUI cards/detail** — TDD the mapping from registry/events to BG/FG cards and detail dialogs/panel. Consider folding in event observation from `opencode-subagent-statusline` so native `task` and host `delegate` are visible too.
5. **Spike slice C: OpenCode fork seam** — only if B cannot satisfy the UX, prototype a minimal plugin API in `C:\SDK\opencode-fork` for transcript-side activity cards and off-transcript detail panels.

### Risks

- The exact `[TASK NOTIFICATION]` producer is visible only indirectly here: source search found no implementation in repos/configs, but the active API tool surface exposes `delegation_read`, so attribution is high-confidence to the host/delegation layer, not proven by source ownership.
- Installed plugin/config drift: `~/.config/opencode/tui.json` lists `opencode-sdd-engram-manage`, but it was not found under `~/.opencode/node_modules`; runtime may resolve it elsewhere or fail to load it.
- Two TUI plugins may render overlapping subagent UI (`opencode-subagent-statusline` and `bg-subagents` TUI). Consolidation or clear ownership is needed.
- OpenCode TUI plugin APIs are useful but not currently enough for transcript replacement/suppression; pushing too much into external plugin code may create brittle UI hacks.
- Strict TDD and no-build constraint mean next phases should rely on targeted Vitest tests, not build verification.

### Ready for Proposal

Yes. The proposal should scope the first deliverable to plugin-first agent activity UX in `bg-subagents`, with an explicit upstream-spike gate only for transcript mini-console/custom activity seams that current TUI slots cannot support.
