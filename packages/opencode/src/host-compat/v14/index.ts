/**
 * v14 compat builder — OpenCode 1.14+ path.
 *
 * Minimum-viable composition for the v14 codepath: registers task_bg via
 * Phase 5's Zod 4 tool definition and wires the Phase 6 delivery
 * coordinator. Plan Review (messages.transform) and system transform
 * land in Phases 8-9 and will expand this file.
 *
 * The `Hooks` shape here uses the v14 conventions:
 *   - `tool` is an object keyed by tool name (NOT an array like legacy)
 *   - hooks mutate `output` arguments rather than returning new values
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import {
  HARDCODED_DEFAULT_POLICY,
  HistoryStore,
  PolicyResolver,
  TaskRegistry,
  createLogger,
  resolveHistoryPath,
  type FlatPolicyConfig,
  type LoadedPolicy,
  type Logger,
} from "@maicolextic/bg-subagents-core";

import { runOpenCodeSubagent } from "../../runtime.js";
import { registerTaskBgToolV14 } from "./tool-register.js";
import { createV14Delivery } from "./delivery.js";
import { buildSystemTransform } from "./system-transform.js";
import { buildV14EventHandler } from "./event-handler.js";
import { buildMessagesTransformHook } from "./messages-transform.js";
import { getSharedPolicyStore } from "./slash-commands.js";
import { registerFromServer } from "../../tui-plugin/shared-state.js";

// -----------------------------------------------------------------------------
// Overrides (test seam)
// -----------------------------------------------------------------------------

export interface BuildV14HooksOverrides {
  readonly logger?: Logger;
  readonly registry?: TaskRegistry;
  readonly history?: HistoryStore;
  readonly resolver?: PolicyResolver;
  readonly ackTimeoutMs?: number;
  readonly sessionID?: string;
  /**
   * Flat policy config for Plan Review (Phase 8-9).
   * Keys are agent names or "*" wildcard. Defaults to empty config (all agents → background).
   * Source: opencode.json bgSubagents.policy
   */
  readonly planReviewPolicy?: FlatPolicyConfig;
}

// -----------------------------------------------------------------------------
// Minimal PluginInput shape we consume. The full type from
// `@opencode-ai/plugin` carries heavy generics — we pick only what we need.
// -----------------------------------------------------------------------------

interface V14PluginInput {
  readonly client: {
    readonly session: {
      prompt(options: {
        path: { id: string };
        body: {
          noReply: boolean;
          parts: Array<{ type: "text"; text: string }>;
        };
      }): Promise<unknown>;
    };
  };
  readonly project: { readonly id?: string } | null | undefined;
  readonly directory?: string;
  readonly worktree?: string;
  readonly serverUrl?: URL | string;
}

// -----------------------------------------------------------------------------
// buildV14Hooks
// -----------------------------------------------------------------------------

export async function buildV14Hooks(
  input: V14PluginInput,
  overrides: BuildV14HooksOverrides = {},
): Promise<{
  tool: Record<string, unknown>;
  event?: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => Promise<void>;
  "experimental.chat.messages.transform"?: (
    input: { sessionID?: string; model: unknown },
    output: { messages: Array<{ parts: unknown[] }> },
  ) => Promise<void>;
}> {
  const logger: Logger = overrides.logger ?? createLogger("v14:boot");
  const sessionID = overrides.sessionID ?? "session_unknown";

  const history =
    overrides.history ?? new HistoryStore({ path: resolveHistoryPath() });
  const registry = overrides.registry ?? new TaskRegistry({ history });

  const resolver = overrides.resolver ?? buildDefaultResolver();
  await resolver.reload();

  // ---------------------------------------------------------------------------
  // Tool registration (Phase 5)
  // ---------------------------------------------------------------------------

  const taskBgTool = registerTaskBgToolV14({
    registry,
    run: (toolCtx, parsed, signal) =>
      runOpenCodeSubagent(
        toolCtx as never,
        {
          subagent_type: parsed.subagent_type,
          prompt: parsed.prompt,
          ...(parsed.description !== undefined
            ? { description: parsed.description }
            : {}),
          ...(parsed.policy_override !== undefined
            ? { policy_override: parsed.policy_override }
            : {}),
        },
        signal,
      ),
    logger,
  });

  // ---------------------------------------------------------------------------
  // Delivery coordinator (Phase 6)
  // ---------------------------------------------------------------------------

  const delivery = createV14Delivery({
    registry,
    client: input.client,
    sessionID,
    ...(overrides.ackTimeoutMs !== undefined
      ? { ackTimeoutMs: overrides.ackTimeoutMs }
      : {}),
    logger,
  });

  // Bridge TaskRegistry completion events to the delivery coordinator.
  // Subscription is best-effort — if core adds a different event surface,
  // update the wiring without changing the public interface.
  type CompletionListener = (ev: {
    task_id: string;
    status: "completed" | "error";
    result?: unknown;
    error_message?: string;
    ts: number;
  }) => void | Promise<void>;
  const onCompletion: CompletionListener = (ev) => {
    void delivery.onComplete(ev as never);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRegistry = registry as any;
  if (typeof anyRegistry.on === "function") {
    anyRegistry.on("complete", onCompletion);
  } else if (typeof anyRegistry.onComplete === "function") {
    anyRegistry.onComplete(onCompletion);
  }

  // ---------------------------------------------------------------------------
  // System transform + event hooks (Phase 7)
  // ---------------------------------------------------------------------------
  //
  // task_bg is registered the moment this builder returns, so the guard is
  // unconditionally true for every session this builder serves. Kept as a
  // lookup fn to preserve parity with the legacy `chat-params` shape and to
  // give future work (opt-out flags, per-session gating) a single seam.

  const systemTransform = buildSystemTransform({
    isTaskBgRegistered: () => true,
  });

  const eventHandler = buildV14EventHandler({ logger });

  // ---------------------------------------------------------------------------
  // Plan Review hook (Phase 8-9)
  // ---------------------------------------------------------------------------

  const planReviewPolicy: FlatPolicyConfig = overrides.planReviewPolicy ?? {};
  const policyStore = getSharedPolicyStore();
  const messagesTransform = buildMessagesTransformHook({
    policy: planReviewPolicy,
    policyStore,
    logger,
  });

  // ---------------------------------------------------------------------------
  // SharedPluginState (Phase 11.3) — wire server-side state for TUI plugin
  // ---------------------------------------------------------------------------
  //
  // Both registry and policyStore are now constructed. Register them in the
  // process-global singleton so the TUI plugin (loaded separately via tui.json)
  // can read them without HTTP round-trips. Safe to call every boot — the
  // last-write-wins semantics of registerFromServer handle re-boots correctly.

  registerFromServer({ registry, policyStore });

  logger.info("plugin:booted", {
    host: "v14",
    session_id: sessionID,
    task_bg_registered: true,
    delivery: "v14-prompt-noreply",
    system_transform: true,
    event_hook: true,
    plan_review: true,
  });

  return {
    tool: {
      task_bg: taskBgTool,
    },
    event: eventHandler,
    "experimental.chat.system.transform": systemTransform,
    "experimental.chat.messages.transform": messagesTransform as never,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildDefaultResolver(): PolicyResolver {
  const loaded: LoadedPolicy = {
    policy: HARDCODED_DEFAULT_POLICY,
    source: "default",
    warnings: [],
  };
  return new PolicyResolver(async () => loaded);
}
