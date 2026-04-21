/**
 * Tests for PromptInjectionStrategy — last-resort strategy that always advertises
 * support and simply prepends a canonical sentence to the prompt.
 */
import { describe, expect, it } from "vitest";

import type { InvocationSpec } from "../BackgroundInvoker.js";
import {
  CANONICAL_BG_PROMPT_PREFIX,
  PromptInjectionStrategy,
} from "../strategies/PromptInjectionStrategy.js";

function spec(prompt: string = "do the thing"): InvocationSpec {
  return {
    agent_name: "code-researcher",
    prompt,
    host_context: {},
  };
}

describe("PromptInjectionStrategy", () => {
  it("name is 'prompt-injection'", () => {
    const s = new PromptInjectionStrategy();
    expect(s.name).toBe("prompt-injection");
  });

  it("capabilities always advertises supports_prompt_injection=true", async () => {
    const s = new PromptInjectionStrategy();
    const caps = await s.capabilities({});
    expect(caps.supports_prompt_injection).toBe(true);
    expect(caps.supports_native_bg).toBe(false);
    expect(caps.supports_subagent_swap).toBe(false);
    expect(caps.name).toBe("prompt-injection");
  });

  it("canInvokeInBackground always returns true (last-resort)", async () => {
    const s = new PromptInjectionStrategy();
    expect(await s.canInvokeInBackground(spec())).toBe(true);
    expect(
      await s.canInvokeInBackground({ agent_name: "x", prompt: "y" }),
    ).toBe(true);
  });

  it("invokeRewrite in background mode prepends the canonical sentence", async () => {
    const s = new PromptInjectionStrategy();
    const r = await s.invokeRewrite(spec("investigate the failing test"), "background");
    expect(r.prompt).toBe(`${CANONICAL_BG_PROMPT_PREFIX}investigate the failing test`);
  });

  it("canonical prefix matches the documented sentence", () => {
    expect(CANONICAL_BG_PROMPT_PREFIX).toBe(
      "Please run this in the background and return a compact handle so the main conversation can continue.\n\n",
    );
  });

  it("invokeRewrite in foreground mode returns an empty rewrite (NOOP)", async () => {
    const s = new PromptInjectionStrategy();
    const r = await s.invokeRewrite(spec("leave me alone"), "foreground");
    expect(r).toEqual({});
  });

  it("invokeRewrite sets a human-readable note", async () => {
    const s = new PromptInjectionStrategy();
    const r = await s.invokeRewrite(spec(), "background");
    expect(typeof r.note).toBe("string");
    expect((r.note ?? "").length).toBeGreaterThan(0);
  });
});
