# @maicolextic/bg-subagents-opencode — Implementation Notes

## OpenCode host-types boundary

OpenCode injects the plugin runtime context at boot — it is NOT an npm peer dep
in v0.1. We therefore declare a MINIMAL local mirror of the host surface we
touch in `src/types.ts`. Two reasons:

1. **Zero peer deps** keeps `npm install @maicolextic/bg-subagents-opencode` instant and
   avoids coupling our release cadence to OpenCode's.
2. **Structural typing** — TypeScript only cares about the shape at call sites.
   If the host ever introduces an extra field we ignore, we still compile.

### Where `as unknown as ...` casts are allowed

Anywhere we receive an opaque host-provided object (e.g. `ToolContext`,
`Bus`) and need to hand it back to our typed wrapper. Each such site MUST
carry this sentinel comment exactly:

```ts
// OpenCode host-types boundary — see packages/opencode/NOTES.md
```

so a future grep pinpoints every cross-module cast.

## Delivery strategy (Q1 resolved)

| Layer                  | Primary                                   | Fallback                              |
|------------------------|-------------------------------------------|---------------------------------------|
| Completion signalling  | `bus.emit({ type: "bg-subagents/task-complete", ... })` | Synthetic assistant `chat.message` |
| Ack timeout            | n/a (fire-and-forget)                     | 2000 ms — if no `bus.emit` consumer is registered OR bus is absent, fallback fires |

The ack-timeout is implemented by `chatMessageFallback`: when a task settles
we race a 2-second timer against a caller-supplied "ackReceived" hook. If the
UI subscribes and acks within the window, fallback is suppressed. Otherwise
we inject a synthetic chat message.

## Subagent runtime

`runOpenCodeSubagent(ctx, spec, signal)` is a placeholder in Batch 6. It calls
`ctx.session.create(...)` + `ctx.session.prompt(...)` guarded by the abort
signal. Real session wiring + streaming gets exercised in Batch 7 integration
tests under a faked `ctx`.
