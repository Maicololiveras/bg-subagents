/**
 * Barrel for concrete strategy implementations.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export { NativeBackgroundStrategy } from "./NativeBackgroundStrategy.js";
export { SubagentSwapStrategy } from "./SubagentSwapStrategy.js";
export {
  CANONICAL_BG_PROMPT_PREFIX,
  PromptInjectionStrategy,
} from "./PromptInjectionStrategy.js";
