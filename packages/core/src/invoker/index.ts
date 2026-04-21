/**
 * Public barrel for the core invoker module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export {
  NoViableStrategyError,
  type BackgroundInvoker,
  type BackgroundStrategy,
  type InvocationRewrite,
  type InvocationSpec,
  type StrategyCapabilities,
} from "./BackgroundInvoker.js";

export { StrategyChain } from "./StrategyChain.js";

export {
  CANONICAL_BG_PROMPT_PREFIX,
  NativeBackgroundStrategy,
  PromptInjectionStrategy,
  SubagentSwapStrategy,
} from "./strategies/index.js";

export { createDefaultInvoker, type CreateDefaultInvokerOpts } from "./factory.js";
