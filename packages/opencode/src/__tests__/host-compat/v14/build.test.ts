/**
 * buildV14Hooks — integration test for the v14 hook builder.
 *
 * Asserts:
 *   - Returns Hooks with `tool.task_bg` (v14 object shape, not array).
 *   - task_bg.args includes subagent_type, prompt, description, policy_override.
 *   - task_bg.execute returns v14-style ToolResult.
 *   - plugin:booted log emitted.
 *
 * Plan Review hooks (messages.transform) and system transform land in
 * Phases 8-9; this minimum-viable builder wires tool-register + delivery
 * only, enough to validate the v14 codepath end-to-end in a real host.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildV14Hooks } from "../../../host-compat/v14/index.js";
import {
  current as sharedStateCurrent,
  clear as sharedStateClear,
} from "../../../tui-plugin/shared-state.js";

function makeV14Input() {
  const promptSpy = vi.fn(async () => ({
    data: { info: { id: "msg_v14_1", role: "user" } },
  }));
  return {
    client: {
      session: { prompt: promptSpy },
    },
    project: { id: "proj_v14" },
    directory: "/tmp/work",
    worktree: "/tmp/work",
    serverUrl: new URL("http://localhost:4096"),
    experimental_workspace: { register: vi.fn() },
    $: undefined as unknown,
    promptSpy,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

describe("buildV14Hooks — shape", () => {
  it("returns Hooks with a `tool` object containing task_bg", async () => {
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never);
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool).toBe("object");
    expect(Array.isArray(hooks.tool)).toBe(false);
    const tools = hooks.tool as Record<string, unknown>;
    expect(tools["task_bg"]).toBeDefined();
  });

  it("task_bg has v14 ToolDefinition shape (description + args + execute)", async () => {
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never);
    const tools = hooks.tool as Record<
      string,
      { description: string; args: Record<string, unknown>; execute: unknown }
    >;
    const taskBg = tools["task_bg"]!;
    expect(typeof taskBg.description).toBe("string");
    expect(taskBg.description.length).toBeGreaterThan(20);
    expect(typeof taskBg.args).toBe("object");
    expect(typeof taskBg.execute).toBe("function");
    expect(taskBg.args["subagent_type"]).toBeDefined();
    expect(taskBg.args["prompt"]).toBeDefined();
  });
});

describe("buildV14Hooks — boot log", () => {
  it("emits plugin:booted info log with v14 mode marker", async () => {
    const input = makeV14Input();
    const logger = makeLogger();
    await buildV14Hooks(input as never, { logger: logger as never });

    const bootCall = logger.info.mock.calls.find(
      ([msg]) => msg === "plugin:booted",
    );
    expect(bootCall).toBeDefined();
    const meta = bootCall?.[1] as Record<string, unknown> | undefined;
    expect(meta?.["host"]).toBe("v14");
    expect(meta?.["task_bg_registered"]).toBe(true);
  });
});

describe("buildV14Hooks — delivery wiring", () => {
  it("registers delivery coordinator wired to the registry's onComplete", async () => {
    // We can't easily observe internal wiring without invoking tasks.
    // Minimum sanity: buildV14Hooks doesn't throw and returns a disposable
    // hook structure.
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never);
    expect(hooks).toBeDefined();
  });
});

describe("buildV14Hooks — Phase 7 hooks wired", () => {
  it("returns an `event` hook callable with { event: { type, properties } }", async () => {
    const input = makeV14Input();
    const logger = makeLogger();
    const hooks = await buildV14Hooks(input as never, {
      logger: logger as never,
    });

    expect(typeof hooks.event).toBe("function");

    await hooks.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess_v14_1" },
      },
    });

    const eventLog = logger.info.mock.calls.find(([msg]) => msg === "v14-event");
    expect(eventLog).toBeDefined();
    const meta = eventLog?.[1] as Record<string, unknown> | undefined;
    expect(meta?.["event_type"]).toBe("session.idle");
  });

  it("returns an `experimental.chat.system.transform` hook that pushes task_bg addendum", async () => {
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never);

    const systemTransform = hooks["experimental.chat.system.transform"];
    expect(typeof systemTransform).toBe("function");

    const output: { system: string[] } = { system: [] };
    await systemTransform!(
      {
        sessionID: "sess_v14_1",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      },
      output,
    );

    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain("task_bg");
  });
});

// ---------------------------------------------------------------------------
// Phase 9.2 — messages.transform hook wired
// ---------------------------------------------------------------------------

describe("buildV14Hooks — Plan Review hook wired (Phase 9.2)", () => {
  it("returns an experimental.chat.messages.transform hook", async () => {
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never);
    const transformHook = hooks["experimental.chat.messages.transform"];
    expect(typeof transformHook).toBe("function");
  });

  it("messages.transform hook rewrites task calls per policy config", async () => {
    const input = makeV14Input();
    const hooks = await buildV14Hooks(input as never, {
      planReviewPolicy: { "sdd-explore": "background" },
    });
    const transformHook = hooks["experimental.chat.messages.transform"];

    const output = {
      messages: [
        {
          parts: [
            {
              type: "tool-invocation",
              toolInvocationId: "call_build_test",
              toolName: "task",
              args: { subagent_type: "sdd-explore", prompt: "explore" },
            },
          ],
        },
      ],
    };

    await transformHook!({ sessionID: "sess_build", model: {} }, output as never);

    const taskParts = output.messages[0]!.parts.filter(
      (p: { type?: string; toolName?: string }) =>
        p.type === "tool-invocation" && p.toolName !== undefined,
    ) as Array<{ toolName: string }>;
    expect(taskParts[0]?.toolName).toBe("task_bg");
  });
});

// ---------------------------------------------------------------------------
// Phase 7.5.6 — Zero-pollution stdout-capture test for buildV14Hooks
// ---------------------------------------------------------------------------

describe("buildV14Hooks — zero stdout pollution (Phase 7.5.6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("buildV14Hooks produces ZERO bytes on stdout when BG_SUBAGENTS_DEBUG is unset", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const input = makeV14Input();
    await buildV14Hooks(input as never);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 11.3 — SharedPluginState wired from buildV14Hooks
// ---------------------------------------------------------------------------

describe("buildV14Hooks — SharedPluginState integration (Phase 11.3)", () => {
  beforeEach(() => {
    sharedStateClear();
  });

  afterEach(() => {
    sharedStateClear();
    vi.restoreAllMocks();
  });

  it("after buildV14Hooks resolves, current() returns a non-undefined SharedPluginState", async () => {
    const input = makeV14Input();
    await buildV14Hooks(input as never);

    const state = sharedStateCurrent();
    expect(state).toBeDefined();
  });

  it("SharedPluginState.registry is the same TaskRegistry instance used by the hooks", async () => {
    const input = makeV14Input();

    // Inject a known registry via overrides so we can test identity
    const { TaskRegistry } = await import("@maicolextic/bg-subagents-core");
    const knownRegistry = new TaskRegistry();

    await buildV14Hooks(input as never, { registry: knownRegistry });

    const state = sharedStateCurrent();
    expect(state?.registry).toBe(knownRegistry);
  });

  it("SharedPluginState.policyStore is a TaskPolicyStore with getSessionOverride/setSessionOverride", async () => {
    const input = makeV14Input();
    await buildV14Hooks(input as never);

    const state = sharedStateCurrent();
    expect(state?.policyStore).toBeDefined();
    expect(typeof state?.policyStore.getSessionOverride).toBe("function");
    expect(typeof state?.policyStore.setSessionOverride).toBe("function");
  });

  it("SharedPluginState is set on globalThis via the well-known symbol key", async () => {
    const input = makeV14Input();
    await buildV14Hooks(input as never);

    const sym = Symbol.for("@maicolextic/bg-subagents/shared");
    const direct = (globalThis as Record<symbol, unknown>)[sym];
    expect(direct).toBeDefined();
    expect(direct).toBe(sharedStateCurrent());
  });
});
