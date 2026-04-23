# OpenCode 1.14 Verification Report

Phase 1 of the `opencode-plan-review-live-control` change. Resolves the 6 open
questions from `openspec/changes/opencode-plan-review-live-control/design.md`
by running targeted spike scripts against a real OpenCode 1.14.22 install.

Runtime under test: `opencode-ai@1.14.22` on Windows 11, Bun host.
Plugin + SDK packages: `@opencode-ai/plugin@1.14.20`, `@opencode-ai/sdk@1.14.20`.

## Summary matrix

| ID | Question | Design ADR | Status | Plan B needed? |
|----|----------|------------|--------|----------------|
| ZQ-1 | Does OpenCode accept Zod 3 schemas in `ToolDefinition.args`? | ADR-5 | RESOLVED (no spike) — type-level inspection: plugin SDK bundles `zod@4.1.8`. Use `z` re-exported from `@opencode-ai/plugin/tool` instead of our Zod 3. | ADR-5 amended: swap "preserve Zod 3 + shim" for "use plugin's re-exported Zod 4 in packages/opencode". Protocol keeps Zod 3 internally. |
| EQ-1 | Does `experimental.chat.messages.transform` fire pre-execution with mutable parts? | ADR-2 | ⏳ pending spike run | — |
| SQ-1 | Does `client.session.abort` cancel in-flight tools (propagate AbortSignal)? | ADR-4 | ⏳ pending spike run | — |
| DQ-1 | Does `client.session.prompt({noReply:true})` deliver parts without LLM turn? | Phase 6 | ⏳ pending spike run | — |
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
1. Back up `~/.config/opencode/opencode.json`.
2. Temporarily replace the `"plugin"` array with a single entry:
   `"plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-messages-transform.mjs"]`
3. Launch `opencode`, open a session, send 2-3 short prompts.
4. Observe the transcript. Read `docs/spikes/eq-1-output.log`.
5. Restore the original `opencode.json`.

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

### Verdict

- Status: ⏳ pending / ✅ GO / ❌ NO-GO
- If NO-GO → Plan B: fall back to ADR-2's secondary strategy (per-call batching
  via `tool.execute.before` + delayed release).
- Notes:

---

## DQ-1 — client.session.prompt({ noReply: true })

**Script**: `scripts/spike-noreply-prompt.mjs`

**How to run**:
1. Back up `~/.config/opencode/opencode.json`.
2. Replace `"plugin"` with:
   `"plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-noreply-prompt.mjs"]`
3. Start `opencode`, open a session, send ANY prompt (creates sessionID).
4. After the reply, ask the agent: _"invoke the spike_dq1 tool"_. Repeat 2-3x.
5. Observe the UI and read `docs/spikes/dq-1-output.log`.
6. Restore `opencode.json`.

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

### Verdict

- Status: ⏳ pending / ✅ GO / ❌ NO-GO
- If NO-GO → Plan B: use `tool.execute.after` + synthetic `chat.message` write
  via bus (legacy delivery fallback).
- Notes:

---

## SQ-1 — client.session.abort cancels in-flight tool

**Script**: `scripts/spike-session-abort.mjs`

**How to run**:
1. Back up `~/.config/opencode/opencode.json`.
2. Replace `"plugin"` with:
   `"plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-session-abort.mjs"]`
3. Start `opencode`, ask the agent: _"invoke the spike_slow tool"_.
4. Expect it to finish in ~3-4s via self-abort. Read
   `docs/spikes/sq-1-output.log`.
5. Try a follow-up prompt to confirm session still works.
6. Restore `opencode.json`.

### Observations (fill in)

```
# paste docs/spikes/sq-1-output.log content here
```

- Did BOOT log appear? — [ ]
- Did SELF-ABORT call resolve or throw? — [ ]
- Did `ctx.abort.aborted` flip to true? how many ticks later? — [ ]
- Tool exit reason (ctx.abort.aborted=true vs max ticks)? — [ ]
- Session responsive after abort? — [ ]

### Verdict

- Status: ⏳ pending / ✅ GO / ❌ NO-GO
- If NO-GO → Plan B: live-control move-bg uses re-spawn via `task_bg` without
  attempting cancel of in-flight tool; accepts that the prior tool keeps
  running until it naturally finishes or session terminates.
- Notes:

---

## TQ-1 — shared singleton between server and tui exports

**Scripts**: `scripts/spike-tq1/server.mjs`, `scripts/spike-tq1/tui.mjs`,
`scripts/spike-tq1/shared-state.mjs`

**How to run**:
1. Back up `~/.config/opencode/opencode.json`.
2. Replace `"plugin"` with an array of BOTH entries:
   ```json
   "plugin": [
     "file:///C:/SDK/bg-subagents/scripts/spike-tq1/server.mjs",
     "file:///C:/SDK/bg-subagents/scripts/spike-tq1/tui.mjs"
   ]
   ```
3. Start `opencode`, open a session, send 3-4 prompts (each fires
   `chat.params` → server increments counter).
4. Read `docs/spikes/tq-1-output.log`.
5. Restore `opencode.json`.

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
