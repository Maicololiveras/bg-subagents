/**
 * Tests for StrategyChain — picks the first strategy whose
 * `canInvokeInBackground(spec)` returns true and delegates the rewrite to it.
 * OR-merges capability flags across children.
 */
import { describe, expect, it } from "vitest";

import type {
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  StrategyCapabilities,
} from "../BackgroundInvoker.js";
import { NoViableStrategyError } from "../BackgroundInvoker.js";
import { NativeBackgroundStrategy } from "../strategies/NativeBackgroundStrategy.js";
import { PromptInjectionStrategy } from "../strategies/PromptInjectionStrategy.js";
import { StrategyChain } from "../StrategyChain.js";
import { SubagentSwapStrategy } from "../strategies/SubagentSwapStrategy.js";

// -----------------------------------------------------------------------------
// Test doubles
// -----------------------------------------------------------------------------

type FakeOpts = {
  readonly name: string;
  readonly caps: StrategyCapabilities;
  readonly canReturn: boolean;
  readonly rewrite: InvocationRewrite;
};

function fakeStrategy(opts: FakeOpts): BackgroundStrategy & {
  rewriteCalls: number;
  canCalls: number;
} {
  const o = opts;
  let rewriteCalls = 0;
  let canCalls = 0;
  const s: BackgroundStrategy & { rewriteCalls: number; canCalls: number } = {
    name: o.name,
    get rewriteCalls(): number {
      return rewriteCalls;
    },
    get canCalls(): number {
      return canCalls;
    },
    capabilities: (): Promise<StrategyCapabilities> => Promise.resolve(o.caps),
    canInvokeInBackground: (_spec: InvocationSpec): Promise<boolean> => {
      void _spec;
      canCalls += 1;
      return Promise.resolve(o.canReturn);
    },
    invokeRewrite: (_spec: InvocationSpec, _mode: string): Promise<InvocationRewrite> => {
      void _spec;
      void _mode;
      rewriteCalls += 1;
      return Promise.resolve(o.rewrite);
    },
  };
  return s;
}

function defaultSpec(): InvocationSpec {
  return { agent_name: "code-researcher", prompt: "p", host_context: {} };
}

// -----------------------------------------------------------------------------
// Suites
// -----------------------------------------------------------------------------

describe("StrategyChain", () => {
  it("name composes from child names", () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    expect(chain.name).toBe("chain(native,subagent-swap,prompt-injection)");
  });

  it("picks the first viable strategy and delegates invokeRewrite to it", async () => {
    const first = fakeStrategy({
      name: "first",
      caps: {
        supports_native_bg: true,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "first",
      },
      canReturn: true,
      rewrite: { note: "first-rewrite" },
    });
    const second = fakeStrategy({
      name: "second",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: true,
        supports_prompt_injection: false,
        name: "second",
      },
      canReturn: true,
      rewrite: { note: "second-rewrite" },
    });
    const chain = new StrategyChain([first, second]);
    const rewrite = await chain.invokeRewrite(defaultSpec(), "background");
    expect(rewrite.note).toBe("first-rewrite");
    expect(first.rewriteCalls).toBe(1);
    expect(second.rewriteCalls).toBe(0);
  });

  it("skips strategies whose canInvokeInBackground returns false", async () => {
    const skipped = fakeStrategy({
      name: "skipped",
      caps: {
        supports_native_bg: true,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "skipped",
      },
      canReturn: false,
      rewrite: { note: "skipped-rewrite" },
    });
    const used = fakeStrategy({
      name: "used",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: true,
        supports_prompt_injection: false,
        name: "used",
      },
      canReturn: true,
      rewrite: { note: "used-rewrite" },
    });
    const chain = new StrategyChain([skipped, used]);
    const rewrite = await chain.invokeRewrite(defaultSpec(), "background");
    expect(rewrite.note).toBe("used-rewrite");
    expect(skipped.canCalls).toBe(1);
    expect(skipped.rewriteCalls).toBe(0);
    expect(used.rewriteCalls).toBe(1);
  });

  it("canInvokeInBackground returns true when ANY child strategy is viable", async () => {
    const first = fakeStrategy({
      name: "first",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "first",
      },
      canReturn: false,
      rewrite: {},
    });
    const second = fakeStrategy({
      name: "second",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: true,
        name: "second",
      },
      canReturn: true,
      rewrite: {},
    });
    const chain = new StrategyChain([first, second]);
    expect(await chain.canInvokeInBackground(defaultSpec())).toBe(true);
  });

  it("canInvokeInBackground returns false when NO child is viable", async () => {
    const first = fakeStrategy({
      name: "first",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "first",
      },
      canReturn: false,
      rewrite: {},
    });
    const chain = new StrategyChain([first]);
    expect(await chain.canInvokeInBackground(defaultSpec())).toBe(false);
  });

  it("throws NoViableStrategyError when invokeRewrite(background) cannot find a viable child", async () => {
    const first = fakeStrategy({
      name: "first",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "first",
      },
      canReturn: false,
      rewrite: {},
    });
    // Chain WITHOUT the last-resort prompt-injection strategy
    const chain = new StrategyChain([first]);
    await expect(chain.invokeRewrite(defaultSpec(), "background")).rejects.toBeInstanceOf(
      NoViableStrategyError,
    );
  });

  it("NoViableStrategyError has code INVOKER_NO_STRATEGY + spec + reason", async () => {
    const first = fakeStrategy({
      name: "first",
      caps: {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "first",
      },
      canReturn: false,
      rewrite: {},
    });
    const chain = new StrategyChain([first]);
    const spec = defaultSpec();
    try {
      await chain.invokeRewrite(spec, "background");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoViableStrategyError);
      const cast = err as NoViableStrategyError;
      expect(cast.code).toBe("INVOKER_NO_STRATEGY");
      expect(cast.spec).toBe(spec);
      expect(typeof cast.reason).toBe("string");
      expect(cast.reason.length).toBeGreaterThan(0);
    }
  });

  it("foreground mode is a NOOP passthrough for the whole chain — returns {}", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const result = await chain.invokeRewrite(defaultSpec(), "foreground");
    expect(result).toEqual({});
  });

  it("capabilities OR-merges across children", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const caps = await chain.capabilities({ native_bg_supported: true });
    expect(caps.supports_native_bg).toBe(true);
    expect(caps.supports_subagent_swap).toBe(true);
    expect(caps.supports_prompt_injection).toBe(true);
    expect(caps.name).toBe("chain(native,subagent-swap,prompt-injection)");
  });

  it("rejects construction with an empty strategy list", () => {
    expect(() => new StrategyChain([])).toThrow(/at least one strategy/i);
  });

  it("default chain + policy-resolved foreground returns {} across all real strategies", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const spec: InvocationSpec = {
      agent_name: "researcher",
      prompt: "do things",
      host_context: {
        native_bg_supported: true,
        agent_variants: { researcher: true },
      },
    };
    expect(await chain.invokeRewrite(spec, "foreground")).toEqual({});
  });

  it("default chain with native host_context picks NativeBackgroundStrategy", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const result = await chain.invokeRewrite(
      {
        agent_name: "code-researcher",
        prompt: "x",
        host_context: { native_bg_supported: true },
      },
      "background",
    );
    expect(result.extra_input).toEqual({ background: true });
    expect(result.agent_name).toBeUndefined();
    expect(result.prompt).toBeUndefined();
  });

  it("default chain with swap-only host_context picks SubagentSwapStrategy", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const result = await chain.invokeRewrite(
      {
        agent_name: "code-researcher",
        prompt: "x",
        host_context: { agent_variants: { "code-researcher": true } },
      },
      "background",
    );
    expect(result.agent_name).toBe("code-researcher-bg");
    expect(result.extra_input).toBeUndefined();
  });

  it("default chain with bare host_context falls through to PromptInjectionStrategy", async () => {
    const chain = new StrategyChain([
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const result = await chain.invokeRewrite(
      { agent_name: "code-researcher", prompt: "investigate", host_context: {} },
      "background",
    );
    expect(result.prompt).toContain("investigate");
    expect(result.prompt?.startsWith("Please run this in the background")).toBe(true);
  });
});
