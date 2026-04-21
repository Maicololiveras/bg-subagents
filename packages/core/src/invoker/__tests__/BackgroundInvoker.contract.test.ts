/**
 * Abstract contract tests — every concrete `BackgroundStrategy` and the
 * aggregating `StrategyChain` must obey this surface. Parameterized so a single
 * suite exercises all implementations and future strategies inherit the
 * checks for free.
 *
 * Scope of this file:
 *   - Shape of `capabilities()` result (name: string + three bool flags)
 *   - `canInvokeInBackground(spec)` resolves (doesn't throw on valid spec)
 *   - `invokeRewrite(spec, mode)` resolves to an `InvocationRewrite` object
 *     even when the rewrite is a NOOP (returns `{}` rather than throwing)
 *
 * Strategy-specific semantics live in the per-strategy test files.
 */
import { describe, expect, it } from "vitest";

import type {
  BackgroundStrategy,
  InvocationSpec,
} from "../BackgroundInvoker.js";
import { NativeBackgroundStrategy } from "../strategies/NativeBackgroundStrategy.js";
import { PromptInjectionStrategy } from "../strategies/PromptInjectionStrategy.js";
import { SubagentSwapStrategy } from "../strategies/SubagentSwapStrategy.js";
import { StrategyChain } from "../StrategyChain.js";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function baseSpec(): InvocationSpec {
  return {
    agent_name: "code-researcher",
    agent_type: "research",
    prompt: "investigate the failing test",
    tools: ["read", "grep"],
    host_context: {},
  };
}

type StrategyFactory = () => BackgroundStrategy;

const factories: ReadonlyArray<readonly [string, StrategyFactory]> = [
  ["NativeBackgroundStrategy", (): BackgroundStrategy => new NativeBackgroundStrategy()],
  ["SubagentSwapStrategy", (): BackgroundStrategy => new SubagentSwapStrategy()],
  ["PromptInjectionStrategy", (): BackgroundStrategy => new PromptInjectionStrategy()],
  [
    "StrategyChain(native, swap, injection)",
    (): BackgroundStrategy =>
      new StrategyChain([
        new NativeBackgroundStrategy(),
        new SubagentSwapStrategy(),
        new PromptInjectionStrategy(),
      ]),
  ],
];

// -----------------------------------------------------------------------------
// Contract
// -----------------------------------------------------------------------------

describe.each(factories)("BackgroundStrategy contract (%s)", (label, makeStrategy) => {
  it(`${label}: exposes a stable non-empty name`, () => {
    const s = makeStrategy();
    expect(typeof s.name).toBe("string");
    expect(s.name.length).toBeGreaterThan(0);
  });

  it(`${label}: capabilities() returns shape {supports_*: boolean, name: string}`, async () => {
    const s = makeStrategy();
    const caps = await s.capabilities();
    expect(typeof caps.supports_native_bg).toBe("boolean");
    expect(typeof caps.supports_subagent_swap).toBe("boolean");
    expect(typeof caps.supports_prompt_injection).toBe("boolean");
    expect(typeof caps.name).toBe("string");
    expect(caps.name.length).toBeGreaterThan(0);
  });

  it(`${label}: canInvokeInBackground resolves Promise<boolean>`, async () => {
    const s = makeStrategy();
    const result = await s.canInvokeInBackground(baseSpec());
    expect(typeof result).toBe("boolean");
  });

  it(`${label}: invokeRewrite does not throw on a valid spec (background)`, async () => {
    const s = makeStrategy();
    await expect(s.invokeRewrite(baseSpec(), "background")).resolves.toBeDefined();
  });

  it(`${label}: invokeRewrite does not throw on a valid spec (foreground)`, async () => {
    const s = makeStrategy();
    await expect(s.invokeRewrite(baseSpec(), "foreground")).resolves.toBeDefined();
  });
});
