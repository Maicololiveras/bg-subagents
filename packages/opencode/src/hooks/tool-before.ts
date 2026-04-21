/**
 * `Hooks.tool.execute.before` interceptor for the core `task` tool.
 *
 * Algorithm (design §4.1):
 *   1. If the tool isn't `task` → passthrough.
 *   2. Resolve invocation policy (mode, timeout).
 *   3. If resolved mode is `foreground` → passthrough.
 *   4. If resolved mode is `background` or `ask` → prompt the picker.
 *   5. Map picker result:
 *      - picked + foreground → passthrough
 *      - picked + background → call invoker.invokeRewrite("background")
 *        - if `extra_input.tool_name === "task_bg"` → return a tool-swap
 *          replacement so the `task_bg` tool takes over.
 *        - otherwise (prompt-injection fallback) → return passthrough with
 *          `updatedInput` containing the rewritten prompt.
 *      - cancelled → return `{ continue: false, deny_reason }`.
 *      - timeout → treat as picked with `default` mode (Picker returns
 *        `kind: "picked"` with `viaTimeout: true` already).
 *   6. All paths log a decision line via the injected `Logger`.
 *
 * Adapter re-entry guard: if `tool_input._bg_subagents_already_routed === true`
 * we passthrough silently. The `task_bg` tool adds this marker when it calls
 * the core task under the hood (design D1 mitigation).
 */
import type {
  BackgroundInvoker,
  InvocationSpec,
  Logger,
  Picker,
  PickerOpts,
  PolicyResolver,
} from "@maicolextic/bg-subagents-core";
import type { Mode } from "@maicolextic/bg-subagents-protocol";

import type {
  HooksToolBeforeInput,
  HooksToolBeforeResult,
} from "../types.js";

const TASK_TOOL_NAME = "task";
const TASK_BG_TOOL_NAME = "task_bg";
const REENTRY_MARKER = "_bg_subagents_already_routed";

export interface InterceptTaskOpts {
  readonly picker: Picker;
  readonly resolver: PolicyResolver;
  readonly invoker: BackgroundInvoker;
  readonly logger?: Logger;
  /**
   * Build the opaque `host_context` handed to the invoker. The session_id is
   * supplied per invocation by the hook payload; returning a stable object
   * per session keeps the strategy-capability cache warm.
   */
  readonly buildHostContext: (sessionId: string) => Readonly<Record<string, unknown>>;
}

export type InterceptTaskFn = (
  input: HooksToolBeforeInput,
) => Promise<HooksToolBeforeResult>;

export function interceptTaskTool(opts: InterceptTaskOpts): InterceptTaskFn {
  const { picker, resolver, invoker, logger, buildHostContext } = opts;

  return async function interceptTask(
    input: HooksToolBeforeInput,
  ): Promise<HooksToolBeforeResult> {
    // 1. Only handle core `task`. Re-entry guard short-circuits on our own
    //    tool_bg-originated synthetic task calls.
    if (input.tool_name !== TASK_TOOL_NAME) {
      return { continue: true };
    }
    if (input.tool_input[REENTRY_MARKER] === true) {
      logger?.info("task-intercept:reentry-bypass", { tool: input.tool_name });
      return { continue: true };
    }

    const agent_name =
      typeof input.tool_input["subagent_type"] === "string"
        ? (input.tool_input["subagent_type"] as string)
        : "unknown";
    const prompt =
      typeof input.tool_input["prompt"] === "string"
        ? (input.tool_input["prompt"] as string)
        : "";

    // 2. Resolve policy.
    const resolved = resolver.resolve({
      agent_name,
      ...(input.tool_input["agent_type"] !== undefined
        ? { agent_type: String(input.tool_input["agent_type"]) }
        : {}),
    });

    // 3. Foreground resolved mode → passthrough.
    if (resolved.mode === "foreground") {
      logger?.info("task-intercept:passthrough-foreground", {
        agent_name,
        source: resolved.source,
      });
      return { continue: true };
    }

    // 4. Picker prompt.
    const pickerOpts: PickerOpts = {
      agentName: agent_name,
      defaultMode: resolved.mode,
      timeoutMs: resolved.timeout_ms,
    };
    const pick = await picker.prompt(pickerOpts);

    if (pick.kind === "cancelled") {
      logger?.info("task-intercept:cancelled", {
        agent_name,
        reason: pick.reason,
      });
      return {
        continue: false,
        deny_reason: `user_cancelled:${pick.reason}`,
      };
    }

    // 5. Picker returned `picked` (optionally via timeout default).
    const mode: Mode = pick.mode;
    if (mode === "foreground") {
      logger?.info("task-intercept:passthrough-after-pick", {
        agent_name,
        viaTimeout: pick.viaTimeout,
      });
      return { continue: true };
    }

    // Background route — ask the invoker chain for a rewrite.
    const spec: InvocationSpec = {
      agent_name,
      prompt,
      host_context: buildHostContext(input.session_id),
    };
    const rewrite = await invoker.invokeRewrite(spec, mode);

    // 5a. Tool swap → task_bg takes over.
    if (
      rewrite.extra_input !== undefined &&
      rewrite.extra_input["tool_name"] === TASK_BG_TOOL_NAME
    ) {
      const replacement_input: Record<string, unknown> = {
        ...input.tool_input,
        [REENTRY_MARKER]: true,
      };
      logger?.info("task-intercept:tool-swap", {
        agent_name,
        note: rewrite.note ?? null,
      });
      return {
        continue: false,
        replacement: {
          tool_name: TASK_BG_TOOL_NAME,
          input: replacement_input,
        },
      };
    }

    // 5b. Prompt injection / subagent swap fallback — keep original tool,
    //     apply the updatedInput diff.
    const updatedInput = mergeRewrite(input.tool_input, rewrite);
    logger?.info("task-intercept:rewrite-in-place", {
      agent_name,
      has_prompt_rewrite: rewrite.prompt !== undefined,
      has_agent_swap: rewrite.agent_name !== undefined,
      note: rewrite.note ?? null,
    });
    return { continue: true, updatedInput };
  };
}

function mergeRewrite(
  input: Readonly<Record<string, unknown>>,
  rewrite: {
    readonly agent_name?: string;
    readonly prompt?: string;
    readonly extra_input?: Readonly<Record<string, unknown>>;
  },
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...input };
  if (rewrite.prompt !== undefined) {
    out["prompt"] = rewrite.prompt;
  }
  if (rewrite.agent_name !== undefined) {
    out["subagent_type"] = rewrite.agent_name;
  }
  if (rewrite.extra_input !== undefined) {
    for (const [k, v] of Object.entries(rewrite.extra_input)) {
      if (k === "tool_name") continue; // handled by tool-swap branch
      out[k] = v;
    }
  }
  return out;
}

export { TASK_TOOL_NAME, TASK_BG_TOOL_NAME, REENTRY_MARKER };
