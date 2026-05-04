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
  loadPolicy,
  PolicyResolver,
  TaskRegistry,
  createLogger,
  resolveHistoryPath,
  type FlatPolicyConfig,
  type LoadedPolicy,
  type Logger,
} from "@maicolextic/bg-subagents-core";

import { createSubagentRunner } from "../../runtime.js";
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

  // v0.4: Build a subagent runner bound to the OpencodeClient for noReply
  // delivery on child process exit. This replaces the v1.0 session.prompt
  // path which blocked the parent in 1.14.28.
  const subagentRunner = createSubagentRunner({
    client: input.client,
    logger,
  });

  const taskBgTool = registerTaskBgToolV14({
    registry,
    run: (toolCtx, parsed, signal) =>
      subagentRunner(
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

  const planReviewPolicy: FlatPolicyConfig =
    overrides.planReviewPolicy ?? buildPlanReviewPolicy(await loadPolicySafe());
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

  // ---------------------------------------------------------------------------
  // tool.definition hook (v0.6) — steer model toward task_bg for BG-policy agents
  // ---------------------------------------------------------------------------
  //
  // Discovery 27/04 from sst/opencode source: tool.definition can mutate
  // descriptions/parameters BEFORE they are shown to the model. We use it to:
  //
  //   1. For the built-in `task` tool: append a steering hint listing which
  //      subagent_types the user has set to BG mode in policy.jsonc.
  //      The model still chooses, but the hint MAKES task_bg more attractive
  //      for those agents.
  //
  //   2. For our task_bg tool: emphasize that it is the PREFERRED option for
  //      the configured BG agents.
  //
  // This is plugin-only "soft steering" — it is NOT deterministic. The
  // deterministic seam (task.dispatch.before) requires upstream PR.
  // See engram topic: v2/opencode-plugin-api-full-surface
  const toolDefinitionLogger = createLogger("host-compat:v14:tool-def");
  const toolDefinition = async (
    input: { toolID: string },
    output: { description?: string; parameters?: unknown },
  ): Promise<void> => {
    // Log EVERY invocation so we can confirm the hook is wired by the host.
    toolDefinitionLogger.info("tool.definition fired", { toolID: input.toolID });
    if (input.toolID !== "task" && input.toolID !== "task_bg") return;
    try {
      const { policy } = await loadPolicySafe();
      const bgAgents = Object.entries(policy.default_mode_by_agent_name ?? {})
        .filter(([, mode]) => mode === "background")
        .map(([name]) => name);
      const fgAgents = Object.entries(policy.default_mode_by_agent_name ?? {})
        .filter(([, mode]) => mode === "foreground")
        .map(([name]) => name);
      toolDefinitionLogger.info("policy loaded", {
        toolID: input.toolID,
        bg_count: bgAgents.length,
        fg_count: fgAgents.length,
      });

      const baseDesc = output.description ?? "";
      if (input.toolID === "task" && bgAgents.length > 0) {
        output.description =
          baseDesc +
          "\n\n[bg-subagents policy] The following subagent_types are configured for BACKGROUND mode by user policy: " +
          bgAgents.join(", ") +
          ". For these agents, prefer the `task_bg` tool instead of `task` so the user's main session is not blocked while the subagent runs. The `task` tool blocks until completion; `task_bg` returns immediately and delivers results asynchronously.";
        toolDefinitionLogger.info("steering hint appended to task description", {
          original_len: baseDesc.length,
          new_len: output.description.length,
          bg_agents: bgAgents,
        });
      } else if (input.toolID === "task_bg") {
        const preferList =
          bgAgents.length > 0
            ? "PREFERRED for these subagent_types per user policy: " +
              bgAgents.join(", ") +
              "."
            : "";
        const fgList =
          fgAgents.length > 0
            ? "AVOID for these subagent_types (user wants foreground): " +
              fgAgents.join(", ") +
              "."
            : "";
        const hints = [preferList, fgList].filter((s) => s.length > 0).join(" ");
        if (hints.length > 0) {
          output.description = baseDesc + "\n\n[bg-subagents policy] " + hints;
          toolDefinitionLogger.info("steering hint appended to task_bg description", {
            new_len: output.description.length,
          });
        }
      }
    } catch (err) {
      toolDefinitionLogger.warn("tool.definition error", {
        toolID: input.toolID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // ---------------------------------------------------------------------------
  // tool.execute.before hook (v0.6) — FORCE-REDIRECT for BG-policy agents
  // ---------------------------------------------------------------------------
  //
  // When the orchestrator calls `task` with a subagent_type that the user has
  // marked as BG in policy.jsonc, throw a redirect error so the LLM is forced
  // to retry with `task_bg`. This is deterministic in the sense that the
  // user's BG-marked agents CANNOT be invoked synchronously — the call always
  // fails until the LLM picks the right tool.
  //
  // The error message is wired to nudge the LLM directly:
  //   "POLICY_VIOLATION: subagent '{type}' must use task_bg, not task. Retry."
  //
  // We do NOT block `task` for FG agents or for agents not in policy.
  const toolBeforeLogger = createLogger("host-compat:v14:tool-before");
  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ): Promise<void> => {
    if (input.tool !== "task") return;
    try {
      const { policy } = await loadPolicySafe();
      const args = output.args as { subagent_type?: string };
      const subagentType = args?.subagent_type;
      if (!subagentType) {
        toolBeforeLogger.info("task call has no subagent_type — pass through", {
          callID: input.callID,
        });
        return;
      }
      const mode = policy.default_mode_by_agent_name?.[subagentType];
      if (mode !== "background") {
        toolBeforeLogger.info("task call passes policy", {
          callID: input.callID,
          subagent_type: subagentType,
          mode: mode ?? "unset",
        });
        return;
      }
      // Force redirect: subagent is configured BG, throw to abort task call
      toolBeforeLogger.warn("BG-policy enforcement: blocking task → force task_bg", {
        callID: input.callID,
        subagent_type: subagentType,
      });
      throw new Error(
        `POLICY_VIOLATION: The subagent_type '${subagentType}' is configured for ` +
          `BACKGROUND mode in the user's policy. The 'task' tool blocks the orchestrator ` +
          `session, which the user does not want for this agent. ` +
          `Retry this delegation using the 'task_bg' tool with the same parameters ` +
          `(subagent_type, prompt, description). 'task_bg' returns immediately and ` +
          `the result is delivered asynchronously when the subagent completes.`,
      );
    } catch (err) {
      // Re-throw if it's our policy violation; swallow other errors (don't break
      // unrelated task calls because we couldn't read the policy file).
      if (err instanceof Error && err.message.startsWith("POLICY_VIOLATION:")) {
        throw err;
      }
      toolBeforeLogger.warn("tool.execute.before non-fatal error", {
        callID: input.callID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    tool: {
      task_bg: taskBgTool,
    },
    event: eventHandler,
    "experimental.chat.system.transform": systemTransform,
    "experimental.chat.messages.transform": messagesTransform as never,
    "tool.execute.before": toolExecuteBefore,
    // tool.definition added via cast — local types don't declare this hook yet
    // but OpenCode 1.14.28 SDK does (verified in investigation 27/04).
    ["tool.definition" as string]: toolDefinition,
  } as never;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Build the default resolver. Reads ~/.config/bg-subagents/policy.jsonc
 * if present (written by @maicolextic/bg-subagents-control-tui), and falls
 * back to HARDCODED_DEFAULT_POLICY otherwise.
 *
 * The control-tui plugin writes this file on every policy change. The server
 * re-reads it via PolicyResolver.reload() — the loader closure here re-reads
 * the file each call, so hot-reload works without explicit file watching.
 */
function buildDefaultResolver(): PolicyResolver {
  return new PolicyResolver(loadPolicySafe);
}

async function loadPolicySafe(): Promise<LoadedPolicy> {
  try {
    return await loadPolicy();
  } catch (err) {
    return {
      policy: HARDCODED_DEFAULT_POLICY,
      source: "default",
      warnings: [`failed to load policy: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

function buildPlanReviewPolicy(loaded: LoadedPolicy): FlatPolicyConfig {
  const policy: FlatPolicyConfig = {
    "sdd-apply": "foreground",
    "sdd-verify": "foreground",
  };

  for (const [agentName, mode] of Object.entries(
    loaded.policy.default_mode_by_agent_name ?? {},
  )) {
    if (mode === "background" || mode === "foreground") {
      policy[agentName] = mode;
    }
  }

  return policy;
}
