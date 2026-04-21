# @maicolextic/bg-subagents-protocol

Zero-dependency contract package for the bg-subagents plugin ecosystem.

This package is the single source of truth for the wire contract shared between all bg-subagents adapters (OpenCode, Claude Code, MCP). It exports TypeScript types, zod schemas, and the `PROTOCOL_VERSION` constant. It has no host dependencies — only `zod`.

**Audience:** plugin authors building their own adapter or consuming the protocol surface programmatically.

## Install

```bash
pnpm add @maicolextic/bg-subagents-protocol
```

## Protocol version

```ts
import { PROTOCOL_VERSION, isCompatibleProtocol } from "@maicolextic/bg-subagents-protocol";

console.log(PROTOCOL_VERSION); // "1.0.0"

const result = isCompatibleProtocol("1.1.0");
// { ok: true, mismatch: "minor" }  → compatible, warn
```

Version discipline:
- **MAJOR** bump = breaking contract change; adapters refuse to load.
- **MINOR** bump = additive fields or activation of reserved semantics; adapters warn.
- **PATCH** bump = transparent bugfix.

## Exports

### Zod schemas

| Export | Description |
|--------|-------------|
| `PolicySchema` | Full policy file shape (all fields optional with defaults). |
| `SecurityLimitsSchema` | `security.*` sub-object. |
| `HistoryConfigSchema` | `history.*` sub-object. |
| `TelemetryConfigSchema` | `telemetry.*` sub-object. |
| `TaskEnvelopeSchema` | Persisted task record (history JSONL line). |
| `TaskStatusSchema` | Enum of all valid task statuses. |
| `ModeSchema` | Enum: `"background" \| "foreground" \| "ask"`. |
| `PickerEventSchema` | Discriminated union of picker outcomes. |
| `CompletionEventSchema` | Terminal-status completion event. |

### TypeScript types (inferred from schemas)

`Policy`, `Mode`, `TaskStatus`, `TaskEnvelope`, `CompletionEvent`, `PickerEvent`, `PickerOpts`, `PickerResult`, `SecurityLimits`, `HistoryConfig`, `TelemetryConfig`, `TaskId`, `TerminalTaskStatus`.

### Errors

`IncompatibleProtocolError`, `BgLimitError`, `PolicyValidationError`.

## JSON Schema

The canonical JSON Schema for the policy file is published to GitHub Pages on every release:

```
https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json
```

Reference it in your `policy.jsonc` for editor autocompletion:

```jsonc
{
  "$schema": "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json"
}
```

See [docs/policy-schema.md](../../docs/policy-schema.md) for the full human-readable field reference.

## Full documentation

See the [root README](../../README.md) for install, quickstart, and the complete reference.

## License

MIT.
