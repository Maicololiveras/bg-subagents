/**
 * task_bg tool registration tests.
 */
import { describe, expect, it, vi } from "vitest";

import { HistoryStore, TaskRegistry, createLogger } from "@maicolextic/bg-subagents-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerTaskBgTool } from "../../hooks/tool-register.js";
import type { ToolContext } from "../../types.js";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-tool-register-"));
}

function mkCtx(): ToolContext {
  return {
    session: {
      async prompt() {
        return "ok";
      },
    },
  };
}

describe("registerTaskBgTool", () => {
  it("returns a tool definition named `task_bg`", () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    const tool = registerTaskBgTool({
      registry,
      run: async () => "done",
    });
    expect(tool.name).toBe("task_bg");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(20);
    expect(typeof tool.execute).toBe("function");
  });

  it("exposes a parameters schema declaring subagent_type + prompt required", () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    const tool = registerTaskBgTool({
      registry,
      run: async () => "done",
    });
    const params = tool.parameters as { required?: readonly string[] };
    expect(params.required).toContain("subagent_type");
    expect(params.required).toContain("prompt");
  });

  it("execute() delegates to registry.spawn and returns task_id+running immediately", async () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    const run = vi.fn(async () => "subagent-done");
    const tool = registerTaskBgTool({ registry, run });

    const before = registry.size();
    const result = (await tool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      mkCtx(),
    )) as { task_id: string; status: string };

    expect(result.status).toBe("running");
    expect(result.task_id).toMatch(/^tsk_[A-Za-z0-9]{8,}$/);
    expect(registry.size()).toBe(before + 1);
  });

  it("execute() invokes the run callback asynchronously (returns before callback settles)", async () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    let callbackFired = false;
    const tool = registerTaskBgTool({
      registry,
      run: async () => {
        callbackFired = true;
        return 42;
      },
    });

    const result = (await tool.execute(
      { subagent_type: "code-researcher", prompt: "audit" },
      mkCtx(),
    )) as { task_id: string; status: string };
    // Immediate return — callback scheduled but not yet awaited.
    expect(result.status).toBe("running");
    // Drain microtasks.
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(callbackFired).toBe(true);
  });

  it("execute() throws on missing required fields", async () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    const tool = registerTaskBgTool({ registry, run: async () => "x" });
    await expect(
      tool.execute({ subagent_type: "code-researcher" }, mkCtx()),
    ).rejects.toThrow(/subagent_type.*prompt/);
  });

  it("execute() records metadata on the spawned task", async () => {
    const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
    const registry = new TaskRegistry({ history });
    const tool = registerTaskBgTool({
      registry,
      run: async () => "x",
      logger: createLogger({}),
    });
    const result = (await tool.execute(
      {
        subagent_type: "code-researcher",
        prompt: "audit",
        description: "audit imports",
      },
      mkCtx(),
    )) as { task_id: string };
    const state = registry.get(result.task_id as `tsk_${string}`);
    expect(state).toBeDefined();
    expect(state!.meta["tool"]).toBe("task_bg");
    expect(state!.meta["subagent_type"]).toBe("code-researcher");
    expect(state!.meta["description"]).toBe("audit imports");
  });
});
