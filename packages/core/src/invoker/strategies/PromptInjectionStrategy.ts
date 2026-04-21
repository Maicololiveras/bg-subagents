/**
 * PromptInjectionStrategy — last-resort strategy that ALWAYS reports support
 * and prepends a canonical sentence to the outgoing prompt. This is the
 * fallback in the default chain: when no native flag and no agent-variant
 * pair is available, we still nudge the model via system-level instruction.
 *
 * Canonical prefix is exported so integration tests can assert the exact
 * string that lands on the wire.
 */
import type {
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  Mode,
  StrategyCapabilities,
} from "../BackgroundInvoker.js";

export const CANONICAL_BG_PROMPT_PREFIX =
  "Please run this in the background and return a compact handle so the main conversation can continue.\n\n";

export class PromptInjectionStrategy implements BackgroundStrategy {
  public readonly name = "prompt-injection";

  public async capabilities(
    _host_context?: Readonly<Record<string, unknown>>,
  ): Promise<StrategyCapabilities> {
    void _host_context;
    return {
      supports_native_bg: false,
      supports_subagent_swap: false,
      supports_prompt_injection: true,
      name: this.name,
    };
  }

  public async canInvokeInBackground(_spec: InvocationSpec): Promise<boolean> {
    void _spec;
    // Last-resort: there's always a way to prepend text to the prompt.
    return true;
  }

  public async invokeRewrite(spec: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
    if (mode !== "background") {
      return {};
    }
    return {
      prompt: `${CANONICAL_BG_PROMPT_PREFIX}${spec.prompt}`,
      note: "prepended canonical background sentence to prompt",
    };
  }
}
