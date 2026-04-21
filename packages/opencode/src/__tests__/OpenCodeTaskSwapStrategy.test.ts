/**
 * OpenCodeTaskSwapStrategy tests — capabilities, advertised gating, rewrite
 * contents, integration with StrategyChain default order.
 */
import { describe, expect, it } from "vitest";

import {
  NativeBackgroundStrategy,
  PromptInjectionStrategy,
  StrategyChain,
  SubagentSwapStrategy,
  type InvocationSpec,
} from "@maicolextic/bg-subagents-core";

import { OpenCodeTaskSwapStrategy } from "../strategies/OpenCodeTaskSwapStrategy.js";

function mkSpec(overrides: Partial<InvocationSpec> = {}): InvocationSpec {
  return {
    agent_name: "code-researcher",
    prompt: "audit imports",
    ...overrides,
  };
}

describe("OpenCodeTaskSwapStrategy", () => {
  it("has the expected name", () => {
    const s = new OpenCodeTaskSwapStrategy();
    expect(s.name).toBe("opencode-task-swap");
  });

  it("capabilities advertise no generic support flags", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const caps = await s.capabilities();
    expect(caps.supports_native_bg).toBe(false);
    expect(caps.supports_subagent_swap).toBe(false);
    expect(caps.supports_prompt_injection).toBe(false);
    expect(caps.name).toBe("opencode-task-swap");
  });

  it("canInvokeInBackground returns false when no host_context", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    expect(await s.canInvokeInBackground(mkSpec())).toBe(false);
  });

  it("canInvokeInBackground returns false when task_bg NOT registered", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const spec = mkSpec({
      host_context: { opencode_task_bg_registered: false },
    });
    expect(await s.canInvokeInBackground(spec)).toBe(false);
  });

  it("canInvokeInBackground returns true when task_bg IS registered", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const spec = mkSpec({
      host_context: { opencode_task_bg_registered: true },
    });
    expect(await s.canInvokeInBackground(spec)).toBe(true);
  });

  it("invokeRewrite for mode=background emits extra_input.tool_name=task_bg", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const out = await s.invokeRewrite(
      mkSpec({ host_context: { opencode_task_bg_registered: true } }),
      "background",
    );
    expect(out.extra_input).toBeDefined();
    expect(out.extra_input!["tool_name"]).toBe("task_bg");
    expect(out.agent_name).toBeUndefined();
    expect(out.prompt).toBeUndefined();
  });

  it("invokeRewrite for mode=foreground returns an empty rewrite (passthrough)", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const out = await s.invokeRewrite(mkSpec(), "foreground");
    expect(out).toEqual({});
  });

  it("invokeRewrite for mode=ask returns an empty rewrite", async () => {
    const s = new OpenCodeTaskSwapStrategy();
    const out = await s.invokeRewrite(mkSpec(), "ask");
    expect(out).toEqual({});
  });

  it("placed FIRST in a default chain, it short-circuits when task_bg registered", async () => {
    const chain = new StrategyChain([
      new OpenCodeTaskSwapStrategy(),
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const spec = mkSpec({
      host_context: { opencode_task_bg_registered: true, native_bg_supported: false },
    });
    const out = await chain.invokeRewrite(spec, "background");
    // OpenCodeTaskSwap wins → tool_name rewrite emitted
    expect(out.extra_input?.["tool_name"]).toBe("task_bg");
    // Falls through would have given prompt/agent rewrite instead — confirm it did not.
    expect(out.agent_name).toBeUndefined();
    expect(out.prompt).toBeUndefined();
  });

  it("placed FIRST in a default chain, falls through when task_bg NOT registered", async () => {
    const chain = new StrategyChain([
      new OpenCodeTaskSwapStrategy(),
      new NativeBackgroundStrategy(),
      new SubagentSwapStrategy(),
      new PromptInjectionStrategy(),
    ]);
    const spec = mkSpec({
      // no registration advertised => PromptInjection catches (last resort)
      host_context: {},
    });
    const out = await chain.invokeRewrite(spec, "background");
    // PromptInjection always rewrites the prompt
    expect(typeof out.prompt).toBe("string");
    expect(out.extra_input?.["tool_name"]).toBeUndefined();
  });
});
