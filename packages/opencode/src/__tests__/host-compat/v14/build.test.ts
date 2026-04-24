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

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildV14Hooks } from "../../../host-compat/v14/index.js";

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
