/**
 * host-context tests — shape + memoization.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetHostContextCacheForTests,
  buildHostContext,
  clearHostContext,
} from "../host-context.js";

describe("buildHostContext", () => {
  beforeEach(() => {
    __resetHostContextCacheForTests();
  });

  it("returns the documented default shape", () => {
    const ctx = buildHostContext("sess_a");
    expect(ctx).toEqual({
      opencode_task_bg_registered: false,
      native_bg_supported: false,
      agent_variants: {},
      session_id: "sess_a",
    });
  });

  it("honors caps overrides", () => {
    const ctx = buildHostContext("sess_b", {
      opencode_task_bg_registered: true,
      native_bg_supported: false,
      agent_variants: { "code-researcher": true },
    });
    expect(ctx.opencode_task_bg_registered).toBe(true);
    expect(ctx.agent_variants["code-researcher"]).toBe(true);
  });

  it("memoizes per session_id (same caps => identical reference)", () => {
    const a = buildHostContext("sess_m", { opencode_task_bg_registered: true });
    const b = buildHostContext("sess_m", { opencode_task_bg_registered: true });
    expect(a).toBe(b);
  });

  it("invalidates the cache when caps change for the same session", () => {
    const a = buildHostContext("sess_m", { opencode_task_bg_registered: false });
    const b = buildHostContext("sess_m", { opencode_task_bg_registered: true });
    expect(a).not.toBe(b);
    expect(a.opencode_task_bg_registered).toBe(false);
    expect(b.opencode_task_bg_registered).toBe(true);
  });

  it("isolates sessions (different session_id => different references)", () => {
    const a = buildHostContext("sess_a", { opencode_task_bg_registered: true });
    const b = buildHostContext("sess_b", { opencode_task_bg_registered: true });
    expect(a).not.toBe(b);
    expect(a.session_id).toBe("sess_a");
    expect(b.session_id).toBe("sess_b");
  });

  it("clearHostContext drops memoization for a specific session", () => {
    const a = buildHostContext("sess_x", { opencode_task_bg_registered: true });
    clearHostContext("sess_x");
    const b = buildHostContext("sess_x", { opencode_task_bg_registered: true });
    expect(a).not.toBe(b);
  });

  it("freezes the returned object (shallow)", () => {
    const ctx = buildHostContext("sess_f");
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.agent_variants)).toBe(true);
  });
});
