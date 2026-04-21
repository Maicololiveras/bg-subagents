# @maicolextic/bg-subagents-core

Pure domain runtime for the bg-subagents plugin ecosystem.

Contains the policy loader + resolver, TaskRegistry, HistoryStore, Picker, and BackgroundInvoker. No host dependencies — only `@maicolextic/bg-subagents-protocol`, `zod`, `@clack/prompts`, and `jsonc-parser`.

**Audience:** adapter authors building a new host integration (OpenCode, Claude Code, MCP, or custom). End-user OpenCode consumers should install `@maicolextic/bg-subagents-opencode` instead.

## Install

```bash
pnpm add @maicolextic/bg-subagents-core
```

## Public API surface

### Policy

```ts
import { PolicyResolver, loadPolicy } from "@maicolextic/bg-subagents-core";

const resolver = new PolicyResolver(async () => loadPolicy());
await resolver.reload();

const resolved = resolver.resolve({ agent_name: "researcher" });
// { mode: "background", timeout_ms: 2000, source: "name" }
```

**`PolicyResolver`** — resolves per-invocation mode + timeout using the precedence chain:
1. `default_mode_by_agent_name` (highest)
2. `default_mode_by_agent_type`
3. Global default (`"ask"`)

### TaskRegistry

```ts
import { TaskRegistry } from "@maicolextic/bg-subagents-core";

const registry = new TaskRegistry({ history });
const handle = registry.spawn({ meta: { subagent_type: "researcher" }, run: async (signal) => { ... } });
// handle.id  → "tsk_a1b2c3d4"
// handle.done → Promise<unknown>

registry.list();           // TaskState[]
registry.get("tsk_...");   // TaskState | undefined
registry.abort("tsk_..."); // sends AbortSignal
registry.onComplete((event) => { /* CompletionEvent */ });
```

### HistoryStore

```ts
import { HistoryStore, resolveHistoryPath } from "@maicolextic/bg-subagents-core";

const history = new HistoryStore({ path: resolveHistoryPath() });
await history.append(envelope);       // writes JSONL line
const lines = await history.read(id); // all log lines for task
```

JSONL files rotate at `rotation_size_mb` (default 10 MB) with gzip compression. Old files beyond `retention_days` (default 30) are pruned on rotation.

### Picker

```ts
import { createDefaultPicker } from "@maicolextic/bg-subagents-core";

const picker = createDefaultPicker({}, {});
const result = await picker.prompt({
  agentName: "researcher",
  defaultMode: "ask",
  timeoutMs: 2000,
});
// result.kind === "picked" | "cancelled"
```

`createDefaultPicker` returns a `ClackPicker` when a TTY is available, a `BarePicker` otherwise. `BarePicker` applies the `defaultMode` immediately (used in headless/CI environments).

### BackgroundInvoker

```ts
import {
  StrategyChain,
  NativeBackgroundStrategy,
  SubagentSwapStrategy,
  PromptInjectionStrategy,
} from "@maicolextic/bg-subagents-core";

const invoker = new StrategyChain([
  new NativeBackgroundStrategy(),
  new SubagentSwapStrategy(),
  new PromptInjectionStrategy(),
]);

const rewrite = await invoker.invokeRewrite(spec, "background");
```

The strategy chain tries each strategy in order, stopping at the first that can handle the host context.

### CLI commands (`/task`)

```ts
import { listCommand, showCommand, killCommand, logsCommand } from "@maicolextic/bg-subagents-core";
```

Pure command impls consumed by the OpenCode adapter's `/task` slash-command dispatcher. Accept `registry`, `history`, and a `stdout` writer; return `{ exit_code: number }`.

## Full documentation

See the [root README](../../README.md) for the end-user quickstart, policy reference, and troubleshooting guide.

## License

MIT.
