/**
 * Tests for NativeBackgroundStrategy — the placeholder strategy selected when
 * a host adapter advertises `host_context.native_bg_supported === true`
 * (future-proof branch for when the host exposes a public `background: true`
 * flag on its subagent tool call).
 */
import { describe, expect, it } from "vitest";

import type { InvocationSpec } from "../BackgroundInvoker.js";
import { NativeBackgroundStrategy } from "../strategies/NativeBackgroundStrategy.js";

function specWithContext(ctx: Record<string, unknown>): InvocationSpec {
  return {
    agent_name: "code-researcher",
    prompt: "do the thing",
    host_context: ctx,
  };
}

describe("NativeBackgroundStrategy", () => {
  it("name is 'native'", () => {
    const s = new NativeBackgroundStrategy();
    expect(s.name).toBe("native");
  });

  it("capabilities advertises supports_native_bg only when host_context.native_bg_supported === true", async () => {
    const s = new NativeBackgroundStrategy();
    const caps = await s.capabilities({ native_bg_supported: true });
    expect(caps.supports_native_bg).toBe(true);
    expect(caps.supports_subagent_swap).toBe(false);
    expect(caps.supports_prompt_injection).toBe(false);
    expect(caps.name).toBe("native");
  });

  it("capabilities returns supports_native_bg:false when the host does not advertise native bg", async () => {
    const s = new NativeBackgroundStrategy();
    const caps = await s.capabilities({});
    expect(caps.supports_native_bg).toBe(false);
  });

  it("capabilities returns supports_native_bg:false when no host_context at all", async () => {
    const s = new NativeBackgroundStrategy();
    const caps = await s.capabilities();
    expect(caps.supports_native_bg).toBe(false);
  });

  it("canInvokeInBackground returns true when host_context.native_bg_supported === true", async () => {
    const s = new NativeBackgroundStrategy();
    const result = await s.canInvokeInBackground(specWithContext({ native_bg_supported: true }));
    expect(result).toBe(true);
  });

  it("canInvokeInBackground returns false when host_context.native_bg_supported is absent", async () => {
    const s = new NativeBackgroundStrategy();
    const result = await s.canInvokeInBackground(specWithContext({}));
    expect(result).toBe(false);
  });

  it("canInvokeInBackground returns false when host_context is undefined", async () => {
    const s = new NativeBackgroundStrategy();
    const spec: InvocationSpec = { agent_name: "x", prompt: "y" };
    expect(await s.canInvokeInBackground(spec)).toBe(false);
  });

  it("invokeRewrite in background mode sets extra_input.background=true", async () => {
    const s = new NativeBackgroundStrategy();
    const rewrite = await s.invokeRewrite(specWithContext({ native_bg_supported: true }), "background");
    expect(rewrite.extra_input).toEqual({ background: true });
    expect(rewrite.agent_name).toBeUndefined();
    expect(rewrite.prompt).toBeUndefined();
  });

  it("invokeRewrite in foreground mode returns an empty rewrite (NOOP)", async () => {
    const s = new NativeBackgroundStrategy();
    const rewrite = await s.invokeRewrite(specWithContext({ native_bg_supported: true }), "foreground");
    expect(rewrite).toEqual({});
  });

  it("invokeRewrite includes a human-readable note for logging", async () => {
    const s = new NativeBackgroundStrategy();
    const rewrite = await s.invokeRewrite(specWithContext({ native_bg_supported: true }), "background");
    expect(typeof rewrite.note).toBe("string");
    expect((rewrite.note ?? "").length).toBeGreaterThan(0);
  });

  it("capabilities memoizes on host_context identity (cache hit)", async () => {
    const s = new NativeBackgroundStrategy();
    const ctx = { native_bg_supported: true };
    const first = await s.capabilities(ctx);
    const second = await s.capabilities(ctx);
    // same reference for identity-based cache
    expect(first).toBe(second);
    expect(s.cacheHits).toBe(1);
  });
});
