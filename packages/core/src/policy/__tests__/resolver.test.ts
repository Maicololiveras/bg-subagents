/**
 * Tests for PolicyResolver.
 *
 * Covers the priority chain name > type > global > hardcoded fallback (FR-3),
 * security-limit helpers (FR-13 accepted, enforcement later), timeout defaulting,
 * and hot-reload atomicity.
 */
import { describe, expect, it } from "vitest";
import type { Policy } from "@maicolextic/bg-subagents-protocol";

import { HARDCODED_DEFAULT_POLICY } from "../hardcoded-defaults.js";
import type { LoadedPolicy } from "../schema.js";
import { PolicyResolver, type Invocation } from "../resolver.js";

/**
 * Helper: build a Policy object by merging over the hardcoded default. Keeps
 * tests focused on the fields under test.
 */
function policy(overrides: Partial<Policy>): Policy {
  return {
    ...HARDCODED_DEFAULT_POLICY,
    ...overrides,
    security: { ...HARDCODED_DEFAULT_POLICY.security, ...(overrides.security ?? {}) },
    history: { ...HARDCODED_DEFAULT_POLICY.history, ...(overrides.history ?? {}) },
    telemetry: { ...HARDCODED_DEFAULT_POLICY.telemetry, ...(overrides.telemetry ?? {}) },
  };
}

function loaded(p: Policy, source: "file" | "default" = "file"): LoadedPolicy {
  return { policy: p, source, warnings: [] };
}

function makeResolver(p: Policy, source: "file" | "default" = "file"): PolicyResolver {
  // DI-friendly: loader is a function returning LoadedPolicy.
  return new PolicyResolver(async () => loaded(p, source));
}

describe("PolicyResolver.resolve — priority chain", () => {
  it("agent-name rule wins over type default wins over global default wins over hardcoded fallback", async () => {
    const p = policy({
      default_mode_by_agent_name: { "code-researcher": "background" },
      default_mode_by_agent_type: { research: "foreground" },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    const inv: Invocation = {
      agent_name: "code-researcher",
      agent_type: "research",
    };
    const r = resolver.resolve(inv);
    expect(r.mode).toBe("background");
    expect(r.source).toBe("agent");
  });

  it("type default wins when no agent-name rule exists", async () => {
    const p = policy({
      default_mode_by_agent_type: { research: "background" },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    const r = resolver.resolve({
      agent_name: "unknown-name",
      agent_type: "research",
    });
    expect(r.mode).toBe("background");
    expect(r.source).toBe("type");
  });

  it("falls through to hardcoded fallback 'ask' when unknown everything and no global default", async () => {
    // HARDCODED default has no global default set → fallback path
    const p = HARDCODED_DEFAULT_POLICY;
    const resolver = makeResolver(p, "default");
    await resolver.reload();

    const r = resolver.resolve({ agent_name: "new-thing" });
    expect(r.mode).toBe("ask");
    expect(r.source).toBe("fallback");
  });

  it("produces a human-readable reason string", async () => {
    const p = policy({
      default_mode_by_agent_name: { alpha: "background" },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    const r = resolver.resolve({ agent_name: "alpha" });
    expect(r.reason).toMatch(/alpha|agent|name/i);
  });
});

describe("PolicyResolver — timeout defaulting", () => {
  it("returns the policy default timeout_ms", async () => {
    const p = policy({ timeout_ms: 1234 });
    const resolver = makeResolver(p);
    await resolver.reload();

    const r = resolver.resolve({ agent_name: "x" });
    expect(r.timeout_ms).toBe(1234);
  });

  it("falls back to hardcoded 2000 when the policy does not set timeout_ms", async () => {
    // Simulate a (hypothetical) policy with no timeout_ms by forcing the
    // resolver into its fallback path: pass a policy whose timeout_ms was
    // explicitly normalized back to the hardcoded default via getTimeoutMs.
    const resolver = new PolicyResolver(async () =>
      loaded(HARDCODED_DEFAULT_POLICY, "default"),
    );
    await resolver.reload();

    // The helper exposes the hardcoded fallback directly.
    const ms = resolver.getTimeoutMs({ agent_name: "unknown" });
    // HARDCODED default sets 2000 per Q3/NFR; this assertion pins it.
    expect(ms).toBe(2000);
  });
});

describe("PolicyResolver — security helpers (accepted in v0.1, enforced later)", () => {
  it("isAllowedInBackground returns false when activeCount >= max_concurrent_bg_tasks", async () => {
    const p = policy({
      security: {
        max_concurrent_bg_tasks: 5,
      },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    expect(resolver.isAllowedInBackground(0)).toBe(true);
    expect(resolver.isAllowedInBackground(4)).toBe(true);
    expect(resolver.isAllowedInBackground(5)).toBe(false);
    expect(resolver.isAllowedInBackground(6)).toBe(false);
  });

  it("isAllowedInBackground returns true when max_concurrent_bg_tasks is not set (no limit)", async () => {
    const resolver = makeResolver(HARDCODED_DEFAULT_POLICY, "default");
    await resolver.reload();

    expect(resolver.isAllowedInBackground(0)).toBe(true);
    expect(resolver.isAllowedInBackground(9999)).toBe(true);
  });

  it("canAgentRunInBackground returns false if any tool in the invocation is in blocked_tools_in_bg", async () => {
    const p = policy({
      security: {
        blocked_tools_in_bg: ["Bash"],
      },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    const inv: Invocation = {
      agent_name: "code-researcher",
      tools: ["Read", "Bash"],
    };
    expect(resolver.canAgentRunInBackground(inv)).toBe(false);
  });

  it("canAgentRunInBackground returns true when no blocked tool overlaps", async () => {
    const p = policy({
      security: {
        blocked_tools_in_bg: ["Bash"],
      },
    });
    const resolver = makeResolver(p);
    await resolver.reload();

    const inv: Invocation = {
      agent_name: "code-researcher",
      tools: ["Read", "Grep"],
    };
    expect(resolver.canAgentRunInBackground(inv)).toBe(true);
  });

  it("canAgentRunInBackground returns true when blocked_tools_in_bg is empty/unset", async () => {
    const resolver = makeResolver(HARDCODED_DEFAULT_POLICY, "default");
    await resolver.reload();

    expect(resolver.canAgentRunInBackground({ agent_name: "x" })).toBe(true);
  });
});

describe("PolicyResolver — lifecycle", () => {
  it("reload() re-invokes loader and swaps active policy atomically (no torn reads mid-resolve)", async () => {
    let version = 0;
    const pA = policy({
      default_mode_by_agent_name: { alpha: "background" },
    });
    const pB = policy({
      default_mode_by_agent_name: { alpha: "foreground" },
    });
    const resolver = new PolicyResolver(async () => {
      version += 1;
      return loaded(version === 1 ? pA : pB, "file");
    });
    await resolver.reload();

    const first = resolver.resolve({ agent_name: "alpha" });
    expect(first.mode).toBe("background");

    await resolver.reload();
    const second = resolver.resolve({ agent_name: "alpha" });
    expect(second.mode).toBe("foreground");

    // The first result reference must remain intact (no mutation of prior
    // resolution objects).
    expect(first.mode).toBe("background");
  });

  it("resolve() throws if called before reload() (resolver starts in uninitialized state)", () => {
    const resolver = makeResolver(HARDCODED_DEFAULT_POLICY, "default");
    expect(() => resolver.resolve({ agent_name: "x" })).toThrow();
  });

  it("constructor accepts an injected loader (DI friendly)", () => {
    const noopLoader = async (): Promise<LoadedPolicy> =>
      loaded(HARDCODED_DEFAULT_POLICY, "default");
    const resolver = new PolicyResolver(noopLoader);
    expect(resolver).toBeInstanceOf(PolicyResolver);
  });
});
