/**
 * Integration tests for the @maicolextic/bg-subagents-opencode adapter.
 *
 * These tests exercise the full wiring as a black-box through buildServer():
 * a fake PluginServerContext is injected, and we drive the returned Hooks
 * as the real OpenCode host would — no knowledge of internals required.
 *
 * Scenarios covered:
 *   #1  — Happy path background: picker picks bg → task_bg fires → bus emits
 *   #2  — Happy path normal: picker picks foreground → core task passes through
 *   #3  — Policy default with timeout: resolver forces background, picker times out
 *   #4  — User cancels picker: no task spawned, no bus emit, deny_reason set
 *   #11 — Hook-order resilience: chat.params, tool.execute.before, task_bg all
 *          independent — wiring each one individually must not break the others
 *
 * Fake timers:
 *   Scenarios #1, #3 rely on the ack-timeout suppression path (2000ms default).
 *   We inject a small ackTimeoutMs (20ms) via overrides to avoid real waits.
 *   Scenario #3 uses vi.useFakeTimers() to advance the picker's internal
 *   timeout deterministically — see that describe block for the reasoning.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  HARDCODED_DEFAULT_POLICY,
  HistoryStore,
  PolicyResolver,
  StrategyChain,
  TaskRegistry,
  type BackgroundInvoker,
  type InvocationRewrite,
  type InvocationSpec,
  type LoadedPolicy,
  type Picker,
  type PickerOpts,
  type PickerResult,
} from "@maicolextic/bg-subagents-core";
import type { Mode } from "@maicolextic/bg-subagents-protocol";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServer } from "../../plugin.js";
import { REENTRY_MARKER } from "../../hooks/tool-before.js";
import type { HooksToolBeforeInput } from "../../types.js";
import { makeFakePluginContext } from "../fixtures/fakePluginContext.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-integration-"));
}

function mkRegistry(): TaskRegistry {
  const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
  return new TaskRegistry({ history });
}

/** Picker that immediately returns the provided result. */
function mkPicker(result: PickerResult): Picker {
  return {
    async prompt(_opts: PickerOpts): Promise<PickerResult> {
      return result;
    },
  };
}

/** Picker that returns viaTimeout: true (simulates a timeout default). */
function mkTimeoutPicker(mode: Mode): Picker {
  return {
    async prompt(_opts: PickerOpts): Promise<PickerResult> {
      return { kind: "picked", mode, viaTimeout: true };
    },
  };
}

/** Invoker that performs a tool-swap to task_bg. */
function mkSwapInvoker(): BackgroundInvoker {
  return {
    name: "fake-swap",
    async capabilities() {
      return {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "fake-swap",
      };
    },
    async canInvokeInBackground(_s: InvocationSpec): Promise<boolean> {
      return true;
    },
    async invokeRewrite(_s: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
      if (mode !== "background") return {};
      return { extra_input: { tool_name: "task_bg" } };
    },
  };
}

/** Invoker that passes through (foreground — no rewrite). */
function mkPassthroughInvoker(): BackgroundInvoker {
  return {
    name: "fake-passthrough",
    async capabilities() {
      return {
        supports_native_bg: false,
        supports_subagent_swap: false,
        supports_prompt_injection: false,
        name: "fake-passthrough",
      };
    },
    async canInvokeInBackground(_s: InvocationSpec): Promise<boolean> {
      return false;
    },
    async invokeRewrite(_s: InvocationSpec, _mode: Mode): Promise<InvocationRewrite> {
      return {};
    },
  };
}

/** PolicyResolver that forces a given mode for every resolution call. */
function mkResolver(mode: Mode, timeout_ms = 50): PolicyResolver {
  const loaded: LoadedPolicy = {
    policy: { ...HARDCODED_DEFAULT_POLICY, timeout_ms },
    source: "default",
    warnings: [],
  };
  const r = new PolicyResolver(async () => loaded);
  vi.spyOn(r, "resolve").mockReturnValue({
    mode,
    timeout_ms,
    reason: "test-forced",
    source: "fallback",
  });
  return r;
}

/** buildServer with shared test overrides (short ackTimeout, injected registry). */
async function buildTestServer(
  ctx: ReturnType<typeof makeFakePluginContext>["ctx"],
  extra: Parameters<typeof buildServer>[1] = {},
) {
  const registry = mkRegistry();
  return {
    hooks: await buildServer(ctx, {
      ackTimeoutMs: 20,
      registry,
      ...extra,
    }),
    registry,
  };
}

/** Drive tool.execute.before with a `task` call. */
function mkTaskInput(overrides: Partial<HooksToolBeforeInput> = {}): HooksToolBeforeInput {
  return {
    tool_name: "task",
    tool_input: {
      subagent_type: "code-researcher",
      prompt: "audit imports",
    },
    session_id: "sess_integration_1",
    ...overrides,
  };
}

/** Small async settle after a given ms (real timers). */
function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Scenario #1 — Happy path background on OpenCode
// ---------------------------------------------------------------------------

describe("Scenario #1 — happy path background", () => {
  it("task tool intercepted → replacement to task_bg, then task_bg spawns a task and bus emits task.completed", async () => {
    const { ctx, busEmits } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    // 1. Drive tool.execute.before — should return a replacement.
    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    expect(result.continue).toBe(false);
    if (result.continue !== false) throw new Error("unexpected continue:true");
    expect(result.replacement?.tool_name).toBe("task_bg");
    // Re-entry marker prevents infinite loop.
    expect((result.replacement!.input as Record<string, unknown>)[REENTRY_MARKER]).toBe(true);

    // 2. Execute task_bg tool directly (host would dispatch the replacement).
    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg");
    expect(taskBgTool).toBeDefined();

    const ctx_tool = { session: ctx.session! };
    const taskResult = await taskBgTool!.execute(
      {
        subagent_type: "code-researcher",
        prompt: "audit imports",
        [REENTRY_MARKER]: true,
      },
      ctx_tool,
    ) as { task_id: string; status: string };

    expect(taskResult.status).toBe("running");
    expect(taskResult.task_id).toMatch(/^tsk_/);

    // 3. Wait for the session.prompt to complete + bus event to fire.
    await settle(30);

    // Bus should have received the task-complete event.
    const completedEvent = busEmits.find(
      (e) => e.event["type"] === "bg-subagents/task-complete",
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.event["task_id"]).toBe(taskResult.task_id);
    expect(completedEvent!.event["status"]).toBe("completed");
  });

  it("parent session is not blocked — tool.execute.before returns replacement without awaiting subagent", async () => {
    const { ctx } = makeFakePluginContext();
    // Slow session.prompt to verify task_bg returns before it settles.
    const fakeCtx = makeFakePluginContext({
      sessionPromptResult: new Promise((resolve) => setTimeout(() => resolve("slow"), 200)),
    });
    const { hooks } = await buildTestServer(fakeCtx.ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;
    const start = Date.now();
    const taskResult = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      { session: fakeCtx.ctx.session! },
    ) as { status: string };

    const elapsed = Date.now() - start;
    // Returns immediately — not waiting the 200ms slow prompt.
    expect(taskResult.status).toBe("running");
    expect(elapsed).toBeLessThan(150);
    void ctx; // silence unused
  });

  it("fallback does NOT fire when bus acks within the timeout window", async () => {
    const { ctx, busEmits, assistantMessages } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;
    await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      { session: ctx.session! },
    );

    // Wait past the 20ms ack timeout — bus already acked.
    await settle(60);

    // Bus emitted → fallback should be suppressed.
    expect(busEmits.length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario #2 — Happy path normal (foreground / passthrough) on OpenCode
// ---------------------------------------------------------------------------

describe("Scenario #2 — happy path normal (passthrough)", () => {
  it("picker picks foreground → tool.execute.before returns continue:true with no replacement", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "foreground", viaTimeout: false }),
      invoker: mkPassthroughInvoker(),
      resolver: mkResolver("background"), // policy says bg but user overrides
    });

    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    expect(result.continue).toBe(true);
    if (result.continue) {
      // No replacement, no modification.
      expect(result.updatedInput).toBeUndefined();
    }
  });

  it("non-task tool calls are always passed through regardless of picker", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput({ tool_name: "bash" }));

    expect(result.continue).toBe(true);
  });

  it("no task_bg side-effects on normal path: bus not emitted, no spawn", async () => {
    const { ctx, busEmits } = makeFakePluginContext();
    const { hooks, registry } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "foreground", viaTimeout: false }),
      invoker: mkPassthroughInvoker(),
      resolver: mkResolver("background"),
    });

    const before = hooks["tool.execute.before"]!;
    await before(mkTaskInput());
    await settle(30);

    expect(registry.size()).toBe(0);
    expect(busEmits.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario #3 — Policy default with timeout
// ---------------------------------------------------------------------------

describe("Scenario #3 — policy default with timeout", () => {
  /**
   * The picker's timeout path is simulated by returning `viaTimeout: true`
   * from our fake picker (the real clack picker uses an actual countdown, but
   * here we control the fake's return). We use vi.useFakeTimers() so that any
   * internal setTimeout calls (ack-timeout fallback) advance deterministically.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("policy default background + picker timeout → task spawns via task_bg route", async () => {
    const { ctx, busEmits } = makeFakePluginContext();
    // Resolver mimics policy that forces background with timeout default.
    const { hooks } = await buildTestServer(ctx, {
      picker: mkTimeoutPicker("background"),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background", 2000),
    });

    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    // Timeout default carries through: replacement to task_bg.
    expect(result.continue).toBe(false);
    if (result.continue !== false) throw new Error("unexpected passthrough");
    expect(result.replacement?.tool_name).toBe("task_bg");

    // Execute the task_bg tool.
    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;
    const taskResult = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit imports" },
      { session: ctx.session! },
    ) as { task_id: string; status: string };
    expect(taskResult.status).toBe("running");

    // Advance timers to trigger any pending microtask + setTimeout paths.
    await vi.runAllTimersAsync();

    // Bus emitted from wireBusEvents (completion path).
    const completedEvent = busEmits.find(
      (e) => e.event["type"] === "bg-subagents/task-complete",
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.event["status"]).toBe("completed");
  });

  it("policy default timeout fires ack suppression (fallback does not double-deliver)", async () => {
    const { ctx, busEmits, assistantMessages } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkTimeoutPicker("background"),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background", 2000),
    });

    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;
    const taskResult = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      { session: ctx.session! },
    ) as { task_id: string };

    // Advance timers past the ack-timeout window.
    await vi.runAllTimersAsync();

    // Bus should have emitted exactly once (no double delivery).
    const busForTask = busEmits.filter(
      (e) => e.event["task_id"] === taskResult.task_id,
    );
    expect(busForTask.length).toBe(1);
    // Fallback should NOT have fired (bus acked).
    expect(assistantMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario #4 — User cancels picker
// ---------------------------------------------------------------------------

describe("Scenario #4 — user cancels picker", () => {
  it("returns continue:false with deny_reason, no task spawned, no bus emit", async () => {
    const { ctx, busEmits } = makeFakePluginContext();
    const { hooks, registry } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "cancelled", reason: "user" }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    expect(result.continue).toBe(false);
    if (result.continue !== false) throw new Error("unexpected passthrough");
    expect(result.deny_reason).toMatch(/user_cancelled:user/);
    expect(result.replacement).toBeUndefined();

    await settle(30);

    // No task spawned, no bus emit.
    expect(registry.size()).toBe(0);
    expect(busEmits.length).toBe(0);
  });

  it("io-unavailable cancel also returns deny_reason with the correct reason code", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "cancelled", reason: "io-unavailable" }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    expect(result.continue).toBe(false);
    if (result.continue !== false) throw new Error("unexpected passthrough");
    expect(result.deny_reason).toMatch(/user_cancelled:io-unavailable/);
  });

  it("cancel with fallback channel off: no assistant message injected", async () => {
    // Even after the ack window passes, no fallback fires on a cancelled task.
    const { ctx, assistantMessages } = makeFakePluginContext();
    await buildTestServer(ctx, {
      picker: mkPicker({ kind: "cancelled", reason: "user" }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    await settle(60);
    expect(assistantMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario #11 — OpenCode hook-order resilience
// ---------------------------------------------------------------------------

describe("Scenario #11 — hook-order resilience", () => {
  /**
   * Even if chat.params fires before tool registration (or in any order),
   * each hook must operate independently and correctly.
   *
   * We test this by:
   *   1. Calling chat.params first and verifying the system steer is injected.
   *   2. Calling tool.execute.before and verifying it still intercepts task.
   *   3. Directly executing the task_bg tool and verifying it still registers.
   *
   * vi.useFakeTimers() used here because multiple completions back-to-back
   * need deterministic ack-timeout advancement.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chat.params fires before tool invocation → system steer still mentions task_bg", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    // Fire chat.params first (simulates it being called before tool registration hook).
    const chatParams = hooks["chat.params"]!;
    const paramsResult = await chatParams({
      session_id: "sess_integration_1",
      system: "You are a helpful assistant.",
    });

    expect(typeof paramsResult.system).toBe("string");
    expect(paramsResult.system).toContain("task_bg");
  });

  it("tool.execute.before still works after chat.params has already fired", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    // Fire chat.params first.
    await hooks["chat.params"]!({ session_id: "sess_integration_1" });

    // Then fire tool.execute.before.
    const before = hooks["tool.execute.before"]!;
    const result = await before(mkTaskInput());

    expect(result.continue).toBe(false);
    if (result.continue !== false) throw new Error("unexpected passthrough");
    expect(result.replacement?.tool_name).toBe("task_bg");
  });

  it("task_bg tool still registers correctly regardless of hook fire order", async () => {
    const { ctx } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    // Fire chat.params and tool.execute.before before accessing Hooks.tool.
    await hooks["chat.params"]!({ session_id: "sess_integration_1" });
    await hooks["tool.execute.before"]!(mkTaskInput());

    // task_bg should still be registered.
    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg");
    expect(taskBgTool).toBeDefined();
    expect(taskBgTool!.name).toBe("task_bg");
  });

  it("multiple completions back-to-back: bus emits for each, no double-delivery", async () => {
    const { ctx, busEmits, assistantMessages } = makeFakePluginContext();
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;

    // Spawn two tasks back-to-back.
    const r1 = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit a" },
      { session: ctx.session! },
    ) as { task_id: string };
    const r2 = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit b" },
      { session: ctx.session! },
    ) as { task_id: string };

    // Advance all timers to settle both completions + ack windows.
    await vi.runAllTimersAsync();

    // Each task should have exactly one bus event.
    const events1 = busEmits.filter((e) => e.event["task_id"] === r1.task_id);
    const events2 = busEmits.filter((e) => e.event["task_id"] === r2.task_id);
    expect(events1.length).toBe(1);
    expect(events2.length).toBe(1);
    // No fallback injections — both acked by bus.
    expect(assistantMessages.length).toBe(0);
  });

  it("all three hooks remain functional even when each is called out of the expected order", async () => {
    const { ctx } = makeFakePluginContext({ session_id: "sess_ooo" });
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "foreground", viaTimeout: false }),
      invoker: mkPassthroughInvoker(),
      resolver: mkResolver("background"),
    });

    // Verify all three hooks are functions and return coherent values in OOO order.
    expect(typeof hooks["chat.params"]).toBe("function");
    expect(typeof hooks["tool.execute.before"]).toBe("function");
    expect(Array.isArray(hooks.tool)).toBe(true);

    // chat.params on the right session → addendum injected.
    const cp = await hooks["chat.params"]!({ session_id: "sess_ooo" });
    expect(cp.system).toContain("task_bg");

    // tool.execute.before on a non-task → passthrough.
    const tb = await hooks["tool.execute.before"]!(mkTaskInput({ tool_name: "bash", session_id: "sess_ooo" }));
    expect(tb.continue).toBe(true);

    // task_bg tool exists with the right name.
    expect(hooks.tool?.find((t) => t.name === "task_bg")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Headless (no bus) integration
// ---------------------------------------------------------------------------

describe("Headless integration (no bus)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fallback fires when bus is absent and ack window expires", async () => {
    const { ctx, assistantMessages } = makeFakePluginContext({ withBus: false });
    const { hooks } = await buildTestServer(ctx, {
      picker: mkPicker({ kind: "picked", mode: "background", viaTimeout: false }),
      invoker: mkSwapInvoker(),
      resolver: mkResolver("background"),
    });

    const taskBgTool = hooks.tool?.find((t) => t.name === "task_bg")!;
    const taskResult = await taskBgTool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      { session: ctx.session! },
    ) as { task_id: string };

    // Advance past the 20ms ack-timeout.
    await vi.runAllTimersAsync();

    // Fallback should have injected a synthetic message.
    expect(assistantMessages.length).toBe(1);
    expect(assistantMessages[0]!.opts.content).toContain(taskResult.task_id);
    expect(assistantMessages[0]!.opts.session_id).toBe("sess_integration_1");
  });
});
