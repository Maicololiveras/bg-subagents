# OpenCode 1.14 Verification Report

Phase 1 of the `opencode-plan-review-live-control` change. Resolves the 6 open
questions from `openspec/changes/opencode-plan-review-live-control/design.md`
by running targeted spike scripts against a real OpenCode 1.14.22 install.

Runtime under test: `opencode-ai@1.14.22` on Windows 11, Bun host.
Plugin + SDK packages: `@opencode-ai/plugin@1.14.20`, `@opencode-ai/sdk@1.14.20`.

## Execution model

OpenCode 1.14.22 auto-discovers plugins from `~/.config/opencode/plugins/*.{ts,mjs,js}`
— no need to edit `opencode.json`. Plugins coexist: your existing
`@maicolextic/bg-subagents-opencode` keeps loading alongside any spike.

Required export shape: the plugin module's default export MUST be a
`Plugin` function `(input, options?) => Promise<Hooks>` (OR an equivalent
named export). Object defaults like `{id, server}` are rejected by the
loader with "Plugin export is not a function".

Workflow per spike:
1. `cp C:/SDK/bg-subagents/scripts/spike-XX.mjs ~/.config/opencode/plugins/`
2. Start `opencode`, run the scenario.
3. `cat C:/SDK/bg-subagents/docs/spikes/XX-output.log`.
4. `rm ~/.config/opencode/plugins/spike-XX.mjs`.

## Summary matrix

| ID | Question | Design ADR | Status | Plan B needed? |
|----|----------|------------|--------|----------------|
| ZQ-1 | Does OpenCode accept Zod 3 schemas in `ToolDefinition.args`? | ADR-5 | RESOLVED (no spike) — type-level inspection: plugin SDK bundles `zod@4.1.8`. Use `z` re-exported from `@opencode-ai/plugin/tool` instead of our Zod 3. | ADR-5 amended: swap "preserve Zod 3 + shim" for "use plugin's re-exported Zod 4 in packages/opencode". Protocol keeps Zod 3 internally. |
| EQ-1 | Does `experimental.chat.messages.transform` fire pre-execution with mutable parts? | ADR-2 | ✅ GO (2026-04-23) — fires per turn, mutation reaches LLM payload, UI shows original user text unchanged. | No — ADR-2 primary path confirmed. |
| SQ-1 | Does `client.session.abort` cancel in-flight tools (propagate AbortSignal)? | ADR-4 | ✅ GO (2026-04-23) — `ctx.abort.aborted` propagates ~300ms after abort resolves. Uses v1 shape `{path:{id}}`. | No — ADR-4 confirmed for move-bg. |
| DQ-1 | Does `client.session.prompt({noReply:true})` deliver parts without LLM turn? | Phase 6 | ✅ GO (2026-04-23) — creates user turn in transcript, no auto LLM reply. Requires v1 SDK shape `{path:{id},body:{...}}`. | No — Phase 6 delivery mechanism confirmed. |
| TQ-1 | Does module-level state share between `server` plugin and `tui` plugin? | ADR-3 | ⏳ pending spike run | — |
| MQ-1 | Is `messages.transform` consistent across 1.14.x minor versions? | ADR-2 | DEFERRED to Phase 16 manual E2E (covered once plugin is functional in one version). | — |

Legend: ✅ GO = runtime matches design assumption. ❌ NO-GO = Plan B required.
⏳ pending = spike not yet executed.

---

## ZQ-1 — Zod version clash (resolved at type level)

**Question**: Will `ToolDefinition.args = <Zod 3 schema>` be accepted by
OpenCode 1.14.22 at tool-registration time?

**Finding** (from type inspection, no spike needed):
`~/.opencode/node_modules/@opencode-ai/plugin/package.json` declares
`zod: 4.1.8` as a direct dependency. `plugin/dist/tool.d.ts` exports
`tool<Args extends z.ZodRawShape>(...)` and re-exports `z` via `tool.schema`.
Zod 3 and Zod 4 are not binary-compatible — a Zod 3 schema instance will not
be recognized by the runtime's Zod 4 parser.

**Decision**:
- `packages/protocol` keeps Zod 3 for its own internal validators.
- `packages/opencode` imports `z` from `@opencode-ai/plugin/tool` and builds
  tool schemas with that. No shim package needed.
- Amend `design.md` ADR-5 accordingly during the post-spike consolidation step.

**Status**: ✅ RESOLVED.

---

## EQ-1 — experimental.chat.messages.transform

**Script**: `scripts/spike-messages-transform.mjs`

**How to run**:
1. `cp C:/SDK/bg-subagents/scripts/spike-messages-transform.mjs ~/.config/opencode/plugins/`
2. Start `opencode`, open a session, send 3 different short prompts.
3. Observe the transcript. Read `docs/spikes/eq-1-output.log`.
4. `rm ~/.config/opencode/plugins/spike-messages-transform.mjs`

### Observations (fill in)

```
# paste docs/spikes/eq-1-output.log content here
```

- Did BOOT line appear? (plugin loaded) — [ ]
- Did CANARY `chat.params` fire? — [ ]
- Did `experimental.chat.messages.transform` fire per turn? — [ ]
- Did the `[SPIKE-EQ1]` marker text appear in the USER message in the UI
  transcript? (mutation persisted) — [ ]
- Did the LLM react to the injected text? (cross-check behaviour) — [ ]

### Verdict — ✅ GO (2026-04-23)

**Evidence**:
- Log file `docs/spikes/eq-1-output.log` (17 lines after one "hola" prompt).
  - `MODULE-LOAD` + `BOOT plugin called` — plugin loaded via auto-discovery of
    `~/.config/opencode/plugins/spike-messages-transform.ts` (renamed from
    `.mjs` — auto-discovery matches `.ts` only).
  - `fire#1 FIRED` → `output.messages.length=1`, user turn with 1 text part,
    `MUTATION appended text part to msg[0] parts.length before=1 after=2`.
  - `fire#2` fired a second time after the assistant reply started,
    with `output.messages.length=2` and assistant parts [step-start, reasoning,
    tool×3, step-finish].
  - `CANARY chat.params` fired 3 times — confirms hook system + plugin wiring
    work end-to-end.
- UI screenshot: LLM's Thinking says *"user is saying hello, but with some
  unusual text"* — confirms the mutated text part reached the LLM payload.
- Bonus finding: `messages.transform` fires MULTIPLE times per turn (pre-LLM
  + during assistant stream). Each fire sees a fresh `output.messages` —
  mutations do NOT persist in the session store. This is IDEAL for Plan
  Review: we inject per-invocation LLM context without corrupting history.
- UI shows the USER's original text (no mutation leakage to transcript) —
  consistent UX.

**Implications for ADR-2**:
- Primary path (`experimental.chat.messages.transform`) is viable.
- Add a discovery note: the hook fires more than once per turn, so idempotent
  Plan Review mutation logic is needed (checking markers or using fresh state
  per fire).

### Plan B reference (kept in case future regression)

If the hook stops firing or mutations stop reaching the LLM: per-call
batching via `tool.execute.before` + delayed release.

---

## DQ-1 — client.session.prompt({ noReply: true })

**Script**: `scripts/spike-noreply-prompt.mjs`

**How to run**:
1. `cp C:/SDK/bg-subagents/scripts/spike-noreply-prompt.mjs ~/.config/opencode/plugins/`
2. Start `opencode`, send ANY prompt (creates sessionID).
3. After the reply, ask the agent: _"invoke the spike_dq1 tool"_. Repeat 2-3x.
4. Read `docs/spikes/dq-1-output.log`.
5. `rm ~/.config/opencode/plugins/spike-noreply-prompt.mjs`

### Observations (fill in)

```
# paste docs/spikes/dq-1-output.log content here
```

- Did BOOT log include a resolved `z` via `@opencode-ai/plugin/tool`? — [ ]
- Did the `spike_dq1` tool get listed / invoked? — [ ]
- Did the prompt call resolve or throw? resolution body shape? — [ ]
- Did a new user turn appear in the UI with the synthetic marker text? — [ ]
- Did the assistant start streaming a reply after the noReply call? (should
  NOT) — [ ]
- Subsequent prompts still work? — [ ]

### Verdict — ✅ GO (2026-04-23)

**Evidence**:
- First run FAILED with v2 shape `{sessionID, noReply, parts}`. Server
  received literal `"{id}"` as sessionID because v1 URL template uses
  `{id}` placeholder, not `{sessionID}`.
- Fixed payload to v1 shape:
  `{ path: { id: ctx.sessionID }, body: { noReply: true, parts: [...] } }`.
  Second run succeeded.
- Log `docs/spikes/dq-1-output.log` per invocation:
  - `prompt resolved dt=6ms result.type=object keys=[data,request,response]`
  - `result.data.info = { id, role: "user", sessionID, time, agent, model }`
  - `result.data.parts = [{type:"text", text:"[SPIKE-DQ1] synthetic delivery inv#N"}]`
- UI screenshot: the synthetic payload appears as a **new USER turn** in the
  transcript. The assistant does NOT auto-reply to the synthetic turn
  (noReply works). The assistant gave its final reply only after finishing
  its tool loop.

**Critical finding (amends design)**:
- `PluginInput.client` is the **v1 SDK client** (imported from
  `@opencode-ai/sdk` default entry in `@opencode-ai/plugin/index.d.ts`),
  NOT the v2 client. All plugin-side SDK calls must use v1 shape.
- If v2 features are needed, construct a v2 client from `input.serverUrl`
  using `createOpencodeClient` from `@opencode-ai/sdk/v2/client`.

**Implications for design**:
- Phase 6 (v14 completion delivery) can use v1 `session.prompt` with
  `noReply:true` — no need for a custom bus workaround.
- All ADRs referencing `client.session.*` need v1-shape calls OR explicit
  v2-client construction. Design amendment pending in consolidation.

### Plan B reference (kept for regression)

If noReply behavior changes or synthetic turns cause UX issues: use
`tool.execute.after` + synthetic `chat.message` write via bus
(legacy delivery fallback from v0.1.x).

---

## SQ-1 — client.session.abort cancels in-flight tool

**Script**: `scripts/spike-session-abort.mjs`

**How to run**:
1. `cp C:/SDK/bg-subagents/scripts/spike-session-abort.mjs ~/.config/opencode/plugins/`
2. Start `opencode`, ask the agent: _"invoke the spike_slow tool"_.
3. Expect it to finish in ~3-4s via self-abort. Read
   `docs/spikes/sq-1-output.log`.
4. Try a follow-up prompt to confirm session still works.
5. `rm ~/.config/opencode/plugins/spike-session-abort.mjs`

### Observations (fill in)

```
# paste docs/spikes/sq-1-output.log content here
```

- Did BOOT log appear? — [ ]
- Did SELF-ABORT call resolve or throw? — [ ]
- Did `ctx.abort.aborted` flip to true? how many ticks later? — [ ]
- Tool exit reason (ctx.abort.aborted=true vs max ticks)? — [ ]
- Session responsive after abort? — [ ]

### Verdict — ✅ GO (2026-04-23)

**Evidence** (`docs/spikes/sq-1-output.log`):
```
19:40:40.924  START sessionID=ses_... external=false abort.aborted=false
19:40:40.926  TICK 1  elapsed=0ms     aborted=false
19:40:41.944  TICK 2  elapsed=1018ms  aborted=false
19:40:42.952  TICK 3  elapsed=2026ms  aborted=false
19:40:42.955  SELF-ABORT firing client.session.abort...
19:40:43.243  SELF-ABORT resolved res={"data":true,"request":{},"response":{}}
19:40:44.246  EXIT reason=ctx.abort.aborted=true totalElapsed=3319ms ticks=3
```

- `client.session.abort({path:{id:sessionID}})` HTTP round-trip = 288ms to
  resolve; server responds `{data:true}`.
- `ctx.abort.aborted` flipped to true BETWEEN tick 3 (19:40:42.952) and the
  loop's next sleep completion (19:40:44.246). So propagation happened
  within ~1s after the abort resolved.
- UI showed the tool result as `Tool execution aborted`; agent turn
  marked `interrupted`. Session recovered cleanly for follow-up prompts.
- v1 shape `{path:{id}}` is REQUIRED (pre-fix applied after DQ-1 finding).

**Implications for ADR-4 (live-control move-bg)**:
- `session.abort` can be used to interrupt an in-flight tool, and the tool
  receives the cancellation signal via its own `ctx.abort: AbortSignal`.
- Plan: when user presses Ctrl+B to move-to-bg, plugin calls
  `client.session.abort({path:{id:ctx.sessionID}})`, tool unwinds via its
  AbortSignal, re-spawns the work via `task_bg` in background.

### Plan B reference (kept for regression)

If abort stops propagating: live-control re-spawns via `task_bg` WITHOUT
cancelling the running tool; accept the prior tool keeps running until it
naturally finishes. Suboptimal but functional.

---

## TQ-1 — shared singleton between server and tui exports

**Scripts**: `scripts/spike-tq1/server.mjs`, `scripts/spike-tq1/tui.mjs`,
`scripts/spike-tq1/shared-state.mjs`

**How to run**:
1. `cp -r C:/SDK/bg-subagents/scripts/spike-tq1 ~/.config/opencode/plugins/`
2. Start `opencode`, open a session, send 3-4 prompts (each fires
   `chat.params` → server increments counter).
3. Read `docs/spikes/tq-1-output.log`.
4. `rm -rf ~/.config/opencode/plugins/spike-tq1`

### Observations (fill in)

```
# paste docs/spikes/tq-1-output.log content here
```

- MODULE-LOAD lines from BOTH server and tui appeared? — [ ]
- PIDs match between server and tui lines? — [ ]
- INIT_TOKEN matches between server and tui lines? (same module instance) — [ ]
- TUI POLL counter grew after server chat.params fires? — [ ]

Outcome taxonomy:
- Same PID + same INIT_TOKEN → single process, shared module graph → ✅ GO,
  singleton works natively.
- Same PID + different INIT_TOKEN → single process but separate module
  loaders (Bun isolated graphs) → ❌ need explicit globalThis pattern.
- Different PIDs → separate processes → ❌ need IPC (file, socket, or HTTP
  via `serverUrl`).

### Verdict

- Status: ⏳ pending / ✅ GO / ❌ NO-GO (which flavor above)
- If NO-GO → Plan B: introduce `SharedPluginState` as an HTTP-backed service
  co-hosted with the server plugin; TUI polls via the `api.client` URL.
- Notes:

---

## Post-spike consolidation checklist

When all 4 spikes report ✅ GO:
- [ ] Amend `design.md` ADR-5 with the Zod 4 finding.
- [ ] Remove ZQ-1 from open questions (replaced with migration task).
- [ ] Add Phase 5 task: "Import `z` from `@opencode-ai/plugin/tool` in
      packages/opencode; remove direct Zod 3 dep from opencode package".
- [ ] Commit this file + `scripts/spike-*.mjs` on branch
      `sdd/opencode-plan-review-live-control`.
- [ ] Clean up: delete spike scripts after Phase 16 manual E2E passes.

When any spike reports ❌ NO-GO:
- [ ] Amend `design.md` with the failing ADR's Plan B as primary path.
- [ ] Re-run the spike to confirm Plan B works.
- [ ] Update `tasks.md` Phase numbers affected by the ADR swap.
