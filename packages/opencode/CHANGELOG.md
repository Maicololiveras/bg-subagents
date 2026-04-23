# @maicolextic/bg-subagents-opencode

## 0.1.2

### Patch Changes

- 83c3479: Fix publish: `workspace:*` deps were being uploaded to npm literally (via `npm publish` under `changeset publish`), causing `npm install` to fail with `EUNSUPPORTEDPROTOCOL`. Switch release workflow to `pnpm publish` (pnpm >= 10.8), which transforms `workspace:*` to concrete versions AND supports OIDC Trusted Publishing.

  v0.1.1 on npm is broken (do not install) — this patch republishes as 0.1.2 with fixed dep resolution.

## 0.1.1

### Patch Changes

- 4023861: Add unified skill doc and upstream announcement drafts (docs only). Validates CI auto-publish flow with provenance.

## 0.1.0

### Minor Changes

- 763dbd5: Initial release — v0.1.0.

  - **protocol**: First stable version of the zero-dep contract package (PROTOCOL_VERSION = 1.0.0). Exports TypeScript types, zod schemas, and the PolicyV1 shape.
  - **core**: Runtime package with policy loader + resolver, TaskRegistry, HistoryStore (JSONL + gzip rotation), Picker interface + ClackPicker, BackgroundInvoker + strategy chain, and structured `/task` CLI commands.
  - **opencode**: OpenCode adapter that registers `task_bg` tool, intercepts `task` via the before-hook, steers model output via chat.params, delivers completion via Bus event (primary) + synthetic chat.message fallback (2000ms ack timeout).

### Patch Changes

- Updated dependencies [763dbd5]
  - @maicolextic/bg-subagents-protocol@1.0.0
  - @maicolextic/bg-subagents-core@0.1.0
