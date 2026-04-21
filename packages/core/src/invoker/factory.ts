/**
 * `createDefaultInvoker` — convenience factory assembling the canonical
 * strategy chain: native -> subagent-swap -> prompt-injection.
 *
 * Host adapters can override the chain order or substitute strategies by
 * passing their own list. The default covers the MVP: prompt injection
 * always succeeds, so the invoker never throws `NoViableStrategyError` out
 * of the box.
 */
import type { BackgroundInvoker, BackgroundStrategy } from "./BackgroundInvoker.js";
import { StrategyChain } from "./StrategyChain.js";
import { NativeBackgroundStrategy } from "./strategies/NativeBackgroundStrategy.js";
import { PromptInjectionStrategy } from "./strategies/PromptInjectionStrategy.js";
import { SubagentSwapStrategy } from "./strategies/SubagentSwapStrategy.js";

export interface CreateDefaultInvokerOpts {
  /**
   * Opaque host-specific context. Reserved for future factories that need to
   * pre-warm caches; the default chain does NOT use it at construction time.
   */
  readonly host_context?: Readonly<Record<string, unknown>>;
  /**
   * Override the default strategy list. When provided, the chain is built
   * verbatim from this array.
   */
  readonly strategies?: ReadonlyArray<BackgroundStrategy>;
}

export function createDefaultInvoker(opts?: CreateDefaultInvokerOpts): BackgroundInvoker {
  void opts?.host_context;
  const strategies: ReadonlyArray<BackgroundStrategy> = opts?.strategies ?? [
    new NativeBackgroundStrategy(),
    new SubagentSwapStrategy(),
    new PromptInjectionStrategy(),
  ];
  return new StrategyChain(strategies);
}
