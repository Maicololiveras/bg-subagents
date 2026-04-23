/**
 * Legacy compat builder — OpenCode pre-1.14 path.
 *
 * Builds the `Hooks` object for hosts where the plugin ctx exposes
 * `session_id`, `bus: {emit}`, and `session: SessionApi`. Preserves the
 * v0.1.x behavior exactly: per-call picker via `tool.execute.before`,
 * `chat.params` addendum, bus-primary + session.writeAssistantMessage
 * fallback completion delivery.
 *
 * Source of truth was `plugin.ts::buildServer`. This file migrates the
 * implementation verbatim; `plugin.ts` now delegates here.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/compat-legacy/spec.md
 */

import {
  HARDCODED_DEFAULT_POLICY,
  HistoryStore,
  NativeBackgroundStrategy,
  PolicyResolver,
  PromptInjectionStrategy,
  StrategyChain,
  SubagentSwapStrategy,
  TaskRegistry,
  createDefaultPicker,
  createLogger,
  resolveHistoryPath,
  type BackgroundInvoker,
  type LoadedPolicy,
  type Logger,
  type Picker,
} from "@maicolextic/bg-subagents-core";

import { buildHostContext, clearHostContext } from "../../host-context.js";
import { OpenCodeTaskSwapStrategy } from "../../strategies/OpenCodeTaskSwapStrategy.js";
import { runOpenCodeSubagent } from "../../runtime.js";
import type { Hooks, PluginServerContext } from "../../types.js";
import { chatMessageFallback } from "./chat-message-fallback.js";
import { steerChatParams } from "./chat-params.js";
import { wireBusEvents } from "./event.js";
import { interceptTaskTool } from "./tool-before.js";
import { registerTaskBgTool } from "./tool-register.js";

// -----------------------------------------------------------------------------
// Overrides for dependency-injected construction (test seam)
// -----------------------------------------------------------------------------

export interface BuildLegacyHooksOverrides {
  readonly logger?: Logger;
  readonly picker?: Picker;
  readonly invoker?: BackgroundInvoker;
  readonly resolver?: PolicyResolver;
  readonly registry?: TaskRegistry;
  readonly history?: HistoryStore;
  readonly ackTimeoutMs?: number;
}

// -----------------------------------------------------------------------------
// buildLegacyHooks — the real work
// -----------------------------------------------------------------------------

export async function buildLegacyHooks(
  ctx: PluginServerContext,
  overrides: BuildLegacyHooksOverrides = {},
): Promise<Hooks> {
  const logger: Logger = overrides.logger ?? createLogger({});
  const sessionId = ctx.session_id ?? "session_unknown";

  const history =
    overrides.history ??
    new HistoryStore({
      path: resolveHistoryPath(),
    });

  const registry = overrides.registry ?? new TaskRegistry({ history });

  const picker: Picker = overrides.picker ?? createDefaultPicker({}, {});

  // Strategy chain: OpenCode swap is FIRST so it short-circuits on our host;
  // the rest are the canonical defaults from core. We construct inline rather
  // than calling `createDefaultInvoker({ strategies })` because we want the
  // exact order + zero magic.
  const invoker: BackgroundInvoker =
    overrides.invoker ??
    new StrategyChain([
      new OpenCodeTaskSwapStrategy(),
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);

  const resolver = overrides.resolver ?? buildDefaultResolver();
  await resolver.reload();

  // Mark this session as having `task_bg` available — strategies consult
  // host_context to decide. The host_context is passed as an opaque record
  // into the core strategy surface — downcast at the boundary.
  const hostCtxTyped = buildHostContext(sessionId, {
    opencode_task_bg_registered: true,
  });
  // OpenCode host-types boundary — see docs/opencode-notes.md
  const hostCtx = hostCtxTyped as unknown as Readonly<Record<string, unknown>>;

  // ---------------------------------------------------------------------------
  // Hook wiring
  // ---------------------------------------------------------------------------

  const taskBgTool = registerTaskBgTool({
    registry,
    run: (toolCtx, input, signal) => runOpenCodeSubagent(toolCtx, input, signal),
    logger,
  });

  const interceptor = interceptTaskTool({
    picker,
    resolver,
    invoker,
    logger,
    buildHostContext: () => hostCtx,
  });

  const chatParams = steerChatParams({
    isTaskBgRegistered: (sid) => sid === sessionId,
  });

  // Completion delivery primary + fallback.
  const fallback = chatMessageFallback({
    registry,
    session: ctx.session,
    sessionId,
    logger,
    ...(overrides.ackTimeoutMs !== undefined
      ? { ackTimeoutMs: overrides.ackTimeoutMs }
      : {}),
  });

  wireBusEvents({
    registry,
    ...(ctx.bus !== undefined ? { bus: ctx.bus } : {}),
    logger,
    onDelivered: (taskId) => fallback.markDelivered(taskId),
  });

  logger.info("plugin:booted", {
    session_id: sessionId,
    task_bg_registered: true,
    invoker: invoker.name,
  });

  // Session teardown: drop host_context cache when the session dies. We
  // don't have a formal "shutdown" hook surface in v0.1; this call is
  // invoked by `chat.message` fallback unsubscribe OR by consumers that
  // manage their own lifecycle.
  void clearHostContext; // referenced to avoid unused-import; real cleanup
  // will land in Batch 7 where the integration test exercises session end.

  const hooks: Hooks = {
    tool: [taskBgTool],
    "tool.execute.before": interceptor,
    "chat.params": chatParams,
  };

  return hooks;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildDefaultResolver(): PolicyResolver {
  // Wrap HARDCODED_DEFAULT_POLICY in the `LoadedPolicy` shape so the
  // resolver's contract is satisfied (policy + source + warnings).
  const loaded: LoadedPolicy = {
    policy: HARDCODED_DEFAULT_POLICY,
    source: "default",
    warnings: [],
  };
  return new PolicyResolver(async () => loaded);
}
