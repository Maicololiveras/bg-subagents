/**
 * BackgroundInvoker public contract.
 *
 * Design §3.2 + spec FR-9 / FR-15. The invoker owns the strategy-pattern chain
 * that decides HOW a subagent call is rerouted when the picker (or a policy
 * default) selects `background` mode. Concrete strategies live in
 * `./strategies/`; the `StrategyChain` aggregates them and picks the first
 * viable one in declared order.
 *
 * Host adapters (OpenCode / Claude-Code / MCP) pass their own opaque
 * `host_context: Record<string, unknown>` so that feature-detection probes
 * remain host-specific without leaking adapter concerns into this surface.
 * The core types here MUST NOT grow adapter-specific fields.
 */
import type { Mode } from "@maicolextic/bg-subagents-protocol";

/**
 * The original subagent invocation we're about to route. All strategies see
 * the same shape; `host_context` is the only escape hatch for adapter quirks.
 */
export interface InvocationSpec {
  /** Agent identifier (e.g. "code-researcher"). */
  readonly agent_name: string;
  /** Optional policy-level classification (e.g. "research"). */
  readonly agent_type?: string;
  /** The prompt payload that would otherwise be sent unchanged. */
  readonly prompt: string;
  /** Optional tool allowlist forwarded by the host. */
  readonly tools?: ReadonlyArray<string>;
  /**
   * Opaque, host-specific context. Adapters CAST internally — core MUST NOT
   * interpret fields here beyond identity-based memoization.
   */
  readonly host_context?: Readonly<Record<string, unknown>>;
}

/**
 * The diff a strategy wants the host to apply to the outgoing call. All fields
 * are OPTIONAL — a NOOP rewrite (foreground passthrough) is a legal return
 * value and is spelled as the empty object `{}`.
 */
export interface InvocationRewrite {
  /** New agent identifier — set by subagent-type-swap strategies. */
  readonly agent_name?: string;
  /** Rewritten prompt — set by prompt-injection strategies. */
  readonly prompt?: string;
  /**
   * Extra fields the host should merge into the downstream `tool_input` (e.g.
   * `background: true` when the host exposes a public per-call flag). Opaque
   * because adapter contracts vary.
   */
  readonly extra_input?: Readonly<Record<string, unknown>>;
  /** Human-readable summary for structured logging. */
  readonly note?: string;
}

/**
 * What a strategy says it CAN do, in the context of a host that advertised a
 * given `host_context`. Flags are boolean-OR-merged by the `StrategyChain`.
 */
export interface StrategyCapabilities {
  readonly supports_native_bg: boolean;
  readonly supports_subagent_swap: boolean;
  readonly supports_prompt_injection: boolean;
  /** Strategy identifier — stable, short, kebab-case. */
  readonly name: string;
}

/**
 * A single routing strategy. Each strategy decides INDEPENDENTLY whether it
 * can background-invoke the given spec; the chain picks the first "yes".
 */
export interface BackgroundStrategy {
  readonly name: string;
  capabilities(host_context?: Readonly<Record<string, unknown>>): Promise<StrategyCapabilities>;
  canInvokeInBackground(spec: InvocationSpec): Promise<boolean>;
  invokeRewrite(spec: InvocationSpec, mode: Mode): Promise<InvocationRewrite>;
}

/**
 * The public invoker handle. Structurally identical to {@link BackgroundStrategy}
 * because the chain IS a strategy — callers can depend on this alias when they
 * want to stress "I'm talking to the aggregate, not an individual leaf".
 */
export interface BackgroundInvoker extends BackgroundStrategy {}

/**
 * Thrown by `StrategyChain.invokeRewrite(spec, "background")` when every
 * child strategy declines. In the default chain (native + swap + injection)
 * this is unreachable because `PromptInjectionStrategy` always returns true;
 * chains that omit prompt-injection may legitimately hit it.
 */
export class NoViableStrategyError extends Error {
  public readonly code = "INVOKER_NO_STRATEGY" as const;
  public readonly spec: InvocationSpec;
  public readonly reason: string;

  constructor(spec: InvocationSpec, reason: string) {
    super(`No viable background strategy for ${spec.agent_name}: ${reason}`);
    this.name = "NoViableStrategyError";
    this.spec = spec;
    this.reason = reason;
    Object.setPrototypeOf(this, NoViableStrategyError.prototype);
  }
}

export type { Mode } from "@maicolextic/bg-subagents-protocol";
