# @maicolextic/bg-subagents-core

## 0.1.1

### Patch Changes

- 03e3d1a: Republish core with `workspace:*` deps transformed to concrete versions. v0.1.0 on npm was published manually before the release workflow fix (PR #14) and still ships `workspace:*` literal in its package.json, breaking every consumer's `npm install`. This patch (v0.1.1) fixes that.

## 0.1.0

### Minor Changes

- 763dbd5: Initial release — v0.1.0.

  - **protocol**: First stable version of the zero-dep contract package (PROTOCOL_VERSION = 1.0.0). Exports TypeScript types, zod schemas, and the PolicyV1 shape.
  - **core**: Runtime package with policy loader + resolver, TaskRegistry, HistoryStore (JSONL + gzip rotation), Picker interface + ClackPicker, BackgroundInvoker + strategy chain, and structured `/task` CLI commands.
  - **opencode**: OpenCode adapter that registers `task_bg` tool, intercepts `task` via the before-hook, steers model output via chat.params, delivers completion via Bus event (primary) + synthetic chat.message fallback (2000ms ack timeout).

### Patch Changes

- Updated dependencies [763dbd5]
  - @maicolextic/bg-subagents-protocol@1.0.0
