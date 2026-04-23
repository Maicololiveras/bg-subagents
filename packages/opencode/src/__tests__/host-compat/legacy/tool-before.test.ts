/**
 * Tool-before interceptor tests. Uses fake Picker + fake Invoker.
 */
import { describe, expect, it, vi } from "vitest";

import {
  PolicyResolver,
  type BackgroundInvoker,
  type InvocationRewrite,
  type InvocationSpec,
  type LoadedPolicy,
  type Picker,
  type PickerOpts,
  type PickerResult,
  HARDCODED_DEFAULT_POLICY,
} from "@maicolextic/bg-subagents-core";
import type { Mode } from "@maicolextic/bg-subagents-protocol";

import { interceptTaskTool, REENTRY_MARKER } from "../../../host-compat/legacy/tool-before.js";
import type { HooksToolBeforeInput } from "../../../types.js";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function mkResolver(mode: Mode, timeout_ms = 2000): PolicyResolver {
  const loaded: LoadedPolicy = {
    policy: {
      ...HARDCODED_DEFAULT_POLICY,
      timeout_ms,
    },
    source: "default",
    warnings: [],
  };
  const r = new PolicyResolver(async () => loaded);
  // Pre-seed the active snapshot by monkey-patching resolve — the real
  // resolver ignores the policy's "default_mode_by_agent_name" unless a
  // match occurs; we want a controllable mode for every call.
  const spy = vi.spyOn(r, "resolve").mockReturnValue({
    mode,
    timeout_ms,
    reason: "test-forced",
    source: "fallback",
  });
  void spy;
  return r;
}

function mkPicker(result: PickerResult): Picker {
  return {
    async prompt(_opts: PickerOpts): Promise<PickerResult> {
      return result;
    },
  };
}

function mkInvoker(rewrite: InvocationRewrite): BackgroundInvoker {
  return {
    name: "fake",
    async capabilities() {
      return {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: true,
        name: "fake",
      };
    },
    async canInvokeInBackground(_s: InvocationSpec) {
      return true;
    },
    async invokeRewrite(_s: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
      if (mode !== "background") return {};
      return rewrite;
    },
  };
}

function mkInput(
  overrides: Partial<HooksToolBeforeInput> = {},
): HooksToolBeforeInput {
  return {
    tool_name: "task",
    tool_input: {
      subagent_type: "code-researcher",
      prompt: "audit imports",
    },
    session_id: "sess_test",
    ...overrides,
  };
}

function buildHostContext(): Readonly<Record<string, unknown>> {
  return { opencode_task_bg_registered: true };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("interceptTaskTool", () => {
  it("passes through non-`task` tools untouched", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput({ tool_name: "bash" }));
    expect(res).toEqual({ continue: true });
  });

  it("passthrough when re-entry marker is set", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(
      mkInput({
        tool_input: {
          subagent_type: "code-researcher",
          prompt: "x",
          [REENTRY_MARKER]: true,
        },
      }),
    );
    expect(res).toEqual({ continue: true });
  });

  it("passthrough when resolved mode is foreground (no picker shown)", async () => {
    const picker = {
      prompt: vi.fn<[PickerOpts], Promise<PickerResult>>(async () => ({
        kind: "picked",
        mode: "foreground",
        viaTimeout: false,
      })),
    } satisfies Picker;
    const fn = interceptTaskTool({
      picker,
      resolver: mkResolver("foreground"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    expect(res).toEqual({ continue: true });
    expect(picker.prompt).not.toHaveBeenCalled();
  });

  it("picker picks foreground → passthrough (even when policy says background)", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "foreground", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    expect(res).toEqual({ continue: true });
  });

  it("picker picks background + tool_name rewrite → replacement to task_bg", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== false) throw new Error("expected replacement");
    expect(res.replacement).toBeDefined();
    expect(res.replacement!.tool_name).toBe("task_bg");
    // re-entry marker set on the replacement input to prevent loop
    expect((res.replacement!.input as Record<string, unknown>)[REENTRY_MARKER]).toBe(true);
  });

  it("picker picks background + prompt rewrite (no tool swap) → updatedInput applied", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({
        prompt: "Run this in the background. audit imports",
        note: "prompt injection fallback",
      }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== true) throw new Error("expected passthrough with updatedInput");
    expect(res.updatedInput).toBeDefined();
    expect(res.updatedInput!["prompt"]).toBe("Run this in the background. audit imports");
    // original field preserved
    expect(res.updatedInput!["subagent_type"]).toBe("code-researcher");
  });

  it("picker picks background + agent_name rewrite → subagent_type swapped", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({
        agent_name: "code-researcher-bg",
        note: "subagent swap fallback",
      }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== true) throw new Error("expected passthrough");
    expect(res.updatedInput!["subagent_type"]).toBe("code-researcher-bg");
  });

  it("picker cancels (user) → returns continue:false with deny_reason", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "cancelled", reason: "user" }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    expect(res.continue).toBe(false);
    if (res.continue === false) {
      expect(res.deny_reason).toMatch(/user_cancelled:user/);
    }
  });

  it("picker cancels (io-unavailable) → deny_reason carries the reason", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "cancelled", reason: "io-unavailable" }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== false) throw new Error("expected deny");
    expect(res.deny_reason).toMatch(/user_cancelled:io-unavailable/);
  });

  it("picker returns via timeout as `picked` → same routing as explicit pick", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: true }),
      resolver: mkResolver("background"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== false) throw new Error("expected replacement");
    expect(res.replacement!.tool_name).toBe("task_bg");
  });

  it("policy-resolved `ask` mode still prompts picker → tool swap happens", async () => {
    const fn = interceptTaskTool({
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      resolver: mkResolver("ask"),
      invoker: mkInvoker({ extra_input: { tool_name: "task_bg" } }),
      buildHostContext,
    });
    const res = await fn(mkInput());
    if (res.continue !== false) throw new Error("expected replacement");
    expect(res.replacement!.tool_name).toBe("task_bg");
  });
});
