---
"@maicolextic/bg-subagents-protocol": major
"@maicolextic/bg-subagents-core": minor
"@maicolextic/bg-subagents-opencode": minor
---

Initial release — v0.1.0.

- **protocol**: First stable version of the zero-dep contract package (PROTOCOL_VERSION = 1.0.0). Exports TypeScript types, zod schemas, and the PolicyV1 shape.
- **core**: Runtime package with policy loader + resolver, TaskRegistry, HistoryStore (JSONL + gzip rotation), Picker interface + ClackPicker, BackgroundInvoker + strategy chain, and structured `/task` CLI commands.
- **opencode**: OpenCode adapter that registers `task_bg` tool, intercepts `task` via the before-hook, steers model output via chat.params, delivers completion via Bus event (primary) + synthetic chat.message fallback (2000ms ack timeout).
