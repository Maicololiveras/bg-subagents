/**
 * OpenCodeTaskSwapStrategy — adapter-local fourth strategy for the
 * background invoker chain.
 *
 * WHY: OpenCode doesn't expose a native per-call `background` flag, nor does
 * it ship *-bg sibling agents. The pattern that DOES work in OpenCode is to
 * register a sibling tool (`task_bg`) via `Hooks.tool`. When the adapter has
 * registered this tool (signalled via
 * `host_context.opencode_task_bg_registered === true`), we rewrite outgoing
 * `task` calls to `task_bg` via `extra_input.tool_name`. The
 * `Hooks.tool.execute.before` interceptor consumes that rewrite and swaps the
 * tool invocation.
 *
 * This strategy sits BEFORE the generic defaults in the chain (native →
 * swap → injection): on OpenCode it short-circuits to tool-swap; on other
 * hosts it declines and falls through untouched.
 */
import type {
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  StrategyCapabilities,
} from "@maicolextic/bg-subagents-core";
import type { Mode } from "@maicolextic/bg-subagents-protocol";

const STRATEGY_NAME = "opencode-task-swap";
const TASK_BG_TOOL_NAME = "task_bg";

export class OpenCodeTaskSwapStrategy implements BackgroundStrategy {
  public readonly name = STRATEGY_NAME;

  public async capabilities(
    _host_context?: Readonly<Record<string, unknown>>,
  ): Promise<StrategyCapabilities> {
    void _host_context;
    // We don't advertise ourselves on the generic capability flags — this is
    // an adapter-local trick that doesn't correspond to any of the three
    // generic categories. The chain's boolean-OR still picks up capabilities
    // from the other strategies.
    return {
      supports_native_bg: false,
      supports_subagent_swap: false,
      supports_prompt_injection: false,
      name: STRATEGY_NAME,
    };
  }

  public async canInvokeInBackground(spec: InvocationSpec): Promise<boolean> {
    return spec.host_context?.["opencode_task_bg_registered"] === true;
  }

  public async invokeRewrite(
    spec: InvocationSpec,
    mode: Mode,
  ): Promise<InvocationRewrite> {
    if (mode !== "background") {
      return {};
    }
    void spec;
    return {
      extra_input: { tool_name: TASK_BG_TOOL_NAME },
      note: `swapped tool -> ${TASK_BG_TOOL_NAME}`,
    };
  }
}

export { TASK_BG_TOOL_NAME };
