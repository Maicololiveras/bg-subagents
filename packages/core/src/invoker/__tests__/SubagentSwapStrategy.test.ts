/**
 * Tests for SubagentSwapStrategy — placeholder strategy for Claude-Code-style
 * `<name>-bg` / `<name>-fg` agent swap. Host advertises which agents have a
 * `-bg` variant via `host_context.agent_variants: Record<string, true>`.
 */
import { describe, expect, it } from "vitest";

import type { InvocationSpec } from "../BackgroundInvoker.js";
import { SubagentSwapStrategy } from "../strategies/SubagentSwapStrategy.js";

function spec(
  agent_name: string,
  variants?: Record<string, true>,
): InvocationSpec {
  const host_context: Record<string, unknown> = variants === undefined ? {} : { agent_variants: variants };
  return {
    agent_name,
    prompt: "p",
    host_context,
  };
}

describe("SubagentSwapStrategy", () => {
  it("name is 'subagent-swap'", () => {
    const s = new SubagentSwapStrategy();
    expect(s.name).toBe("subagent-swap");
  });

  it("capabilities.supports_subagent_swap=true regardless of host_context (static capability)", async () => {
    const s = new SubagentSwapStrategy();
    const caps = await s.capabilities({});
    expect(caps.supports_subagent_swap).toBe(true);
    expect(caps.supports_native_bg).toBe(false);
    expect(caps.supports_prompt_injection).toBe(false);
    expect(caps.name).toBe("subagent-swap");
  });

  it("canInvokeInBackground returns true when the host lists a variant for the agent", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.canInvokeInBackground(spec("code-researcher", { "code-researcher": true }));
    expect(r).toBe(true);
  });

  it("canInvokeInBackground returns false when the variant is missing", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.canInvokeInBackground(spec("code-researcher", { "other-agent": true }));
    expect(r).toBe(false);
  });

  it("canInvokeInBackground returns false when host_context has no agent_variants map", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.canInvokeInBackground(spec("code-researcher"));
    expect(r).toBe(false);
  });

  it("invokeRewrite in background mode renames agent_name to <name>-bg", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.invokeRewrite(
      spec("code-researcher", { "code-researcher": true }),
      "background",
    );
    expect(r.agent_name).toBe("code-researcher-bg");
  });

  it("invokeRewrite is idempotent — does not double-append -bg on an already-swapped name", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.invokeRewrite(
      spec("code-researcher-bg", { "code-researcher-bg": true }),
      "background",
    );
    expect(r.agent_name).toBe("code-researcher-bg");
  });

  it("invokeRewrite in foreground mode returns an empty rewrite (NOOP)", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.invokeRewrite(
      spec("code-researcher", { "code-researcher": true }),
      "foreground",
    );
    expect(r).toEqual({});
  });

  it("invokeRewrite sets a human-readable note", async () => {
    const s = new SubagentSwapStrategy();
    const r = await s.invokeRewrite(
      spec("code-researcher", { "code-researcher": true }),
      "background",
    );
    expect(typeof r.note).toBe("string");
    expect((r.note ?? "").length).toBeGreaterThan(0);
  });
});
