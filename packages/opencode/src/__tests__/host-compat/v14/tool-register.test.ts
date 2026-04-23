/**
 * v14 task_bg tool registration — unit tests.
 *
 * Verifies the Zod 4 args shape (from @opencode-ai/plugin/tool), execute
 * delegation to TaskRegistry.spawn, and the v14-style ToolResult shape:
 *   { output: string, metadata: { task_id, status, subagent_type } }
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { describe, expect, it, vi } from "vitest";

import { registerTaskBgToolV14 } from "../../../host-compat/v14/tool-register.js";
import type { TaskRegistry } from "@maicolextic/bg-subagents-core";

function makeRegistryMock() {
  const spawn = vi.fn(() => ({
    id: "tsk_v14_spawn_1",
    done: Promise.resolve(undefined),
  }));
  return {
    spawn,
    instance: { spawn } as unknown as TaskRegistry,
  };
}

function makeToolCtx() {
  return {
    sessionID: "sess_v14_1",
    messageID: "msg_v14_1",
    agent: "build",
    directory: "/tmp/work",
    worktree: "/tmp/work",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn() as unknown as (input: unknown) => unknown,
  };
}

describe("registerTaskBgToolV14 — shape", () => {
  it("returns an object with description + args + execute", () => {
    const { instance } = makeRegistryMock();
    const def = registerTaskBgToolV14({ registry: instance, run: vi.fn() });
    expect(typeof def.description).toBe("string");
    expect(def.description.length).toBeGreaterThan(20);
    expect(typeof def.args).toBe("object");
    expect(typeof def.execute).toBe("function");
  });

  it("args includes subagent_type, prompt, optional description, optional policy_override", () => {
    const { instance } = makeRegistryMock();
    const { args } = registerTaskBgToolV14({ registry: instance, run: vi.fn() });
    const shape = args as Record<string, unknown>;
    expect(shape["subagent_type"]).toBeDefined();
    expect(shape["prompt"]).toBeDefined();
    expect(shape["description"]).toBeDefined();
    expect(shape["policy_override"]).toBeDefined();
  });
});

describe("registerTaskBgToolV14 — execute", () => {
  it("calls registry.spawn with the parsed input", async () => {
    const { spawn, instance } = makeRegistryMock();
    const run = vi.fn(async () => "done");
    const def = registerTaskBgToolV14({ registry: instance, run });
    const ctx = makeToolCtx();

    await def.execute(
      {
        subagent_type: "code-researcher",
        prompt: "find all TODOs",
      },
      ctx,
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn.mock.calls[0]![0] as {
      meta: { tool: string; subagent_type: string; description: unknown };
      run: unknown;
    };
    expect(call.meta.tool).toBe("task_bg");
    expect(call.meta.subagent_type).toBe("code-researcher");
    expect(call.meta.description).toBeNull();
    expect(typeof call.run).toBe("function");
  });

  it("returns v14-style ToolResult with output + metadata.task_id + metadata.status", async () => {
    const { instance } = makeRegistryMock();
    const def = registerTaskBgToolV14({
      registry: instance,
      run: vi.fn(async () => undefined),
    });
    const ctx = makeToolCtx();

    const result = await def.execute(
      { subagent_type: "sdd-explore", prompt: "investigate" },
      ctx,
    );

    expect(typeof result).toBe("object");
    const r = result as { output: string; metadata?: Record<string, unknown> };
    expect(r.output).toContain("tsk_v14_spawn_1");
    expect(r.metadata).toMatchObject({
      task_id: "tsk_v14_spawn_1",
      status: "running",
      subagent_type: "sdd-explore",
    });
  });

  it("passes ctx.sessionID through to spawn.meta.session_id (bug fix — delivery resolves from here)", async () => {
    const { spawn, instance } = makeRegistryMock();
    const def = registerTaskBgToolV14({ registry: instance, run: vi.fn() });
    const ctx = {
      ...makeToolCtx(),
      sessionID: "ses_REAL_FROM_EXEC",
    };

    await def.execute(
      { subagent_type: "explore", prompt: "test" },
      ctx,
    );

    const call = spawn.mock.calls[0]![0] as {
      meta: Record<string, unknown>;
    };
    expect(call.meta["session_id"]).toBe("ses_REAL_FROM_EXEC");
  });

  it("passes description through to spawn.meta when provided", async () => {
    const { spawn, instance } = makeRegistryMock();
    const def = registerTaskBgToolV14({ registry: instance, run: vi.fn() });

    await def.execute(
      {
        subagent_type: "code-researcher",
        prompt: "audit auth",
        description: "security review",
      },
      makeToolCtx(),
    );

    const call = spawn.mock.calls[0]![0] as {
      meta: { description: string | null };
    };
    expect(call.meta.description).toBe("security review");
  });

  it("accepts optional policy_override=background|foreground", async () => {
    const { instance } = makeRegistryMock();
    const def = registerTaskBgToolV14({
      registry: instance,
      run: vi.fn(async () => undefined),
    });

    await expect(
      def.execute(
        {
          subagent_type: "sdd-apply",
          prompt: "implement X",
          policy_override: "background",
        },
        makeToolCtx(),
      ),
    ).resolves.toBeDefined();

    await expect(
      def.execute(
        {
          subagent_type: "sdd-apply",
          prompt: "implement Y",
          policy_override: "foreground",
        },
        makeToolCtx(),
      ),
    ).resolves.toBeDefined();
  });

  it("the run callback receives ctx, parsed input, and the AbortSignal when the fiber runs", async () => {
    const { spawn, instance } = makeRegistryMock();
    const run = vi.fn(async () => undefined);
    const def = registerTaskBgToolV14({ registry: instance, run });
    const ctx = makeToolCtx();

    await def.execute(
      { subagent_type: "code-researcher", prompt: "p" },
      ctx,
    );

    // The spawn mock was called with a `run` function that, when invoked,
    // delegates to the caller-supplied `run(ctx, input, signal)`.
    const call = spawn.mock.calls[0]![0] as {
      run: (signal: AbortSignal) => Promise<unknown>;
    };
    const fakeSignal = new AbortController().signal;
    await call.run(fakeSignal);

    expect(run).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        subagent_type: "code-researcher",
        prompt: "p",
      }),
      fakeSignal,
    );
  });

  it("emits task_bg:spawned info log when logger is provided", async () => {
    const { instance } = makeRegistryMock();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    const def = registerTaskBgToolV14({
      registry: instance,
      run: vi.fn(async () => undefined),
      logger: logger as never,
    });

    await def.execute(
      { subagent_type: "code-researcher", prompt: "p" },
      makeToolCtx(),
    );

    expect(logger.info).toHaveBeenCalledWith(
      "task_bg:spawned",
      expect.objectContaining({
        task_id: "tsk_v14_spawn_1",
        subagent_type: "code-researcher",
      }),
    );
  });
});
