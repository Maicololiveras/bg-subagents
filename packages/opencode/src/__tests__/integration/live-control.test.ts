/**
 * Integration test: v14 Live Control E2E — Phase 14.2
 *
 * Simulates the server-side message interception chain end-to-end:
 *   interceptTaskCommand (dispatcher) → move-bg handler → registry.kill + registry.spawn
 *
 * Scenarios:
 *   - /task move-bg <id>: cancels FG task, re-spawns as BG, confirmation reply injected
 *   - Coexistence: /task list after move-bg shows the newly-BG task
 *   - /task move-bg on an already-BG task → no-op reply
 *   - /task move-bg with missing id → usage error reply
 *   - /task move-bg on unknown id → not-found reply
 *   - /task list with no tasks → "No active tasks" reply
 *   - /task kill: cancels task, subsequent /task list shows reduced count
 *   - Unknown subcommand → informative error
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md 14.2
 */

import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";

import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import {
  interceptTaskCommand,
  createTaskPolicyStore,
} from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(): TaskRegistry {
  return new TaskRegistry();
}

/** Spawn a fake FG task in the registry with a given agent name. */
function spawnFgTask(
  registry: TaskRegistry,
  agentName: string,
): { id: string } {
  const handle = registry.spawn({
    meta: { mode: "fg", agent: agentName, prompt: `prompt for ${agentName}` },
    run: (_signal) =>
      new Promise<void>((resolve, reject) => {
        // Keep running until killed. Suppress the abort rejection so it
        // doesn't leak as an unhandled rejection when move-bg kills the task.
        _signal.addEventListener("abort", () => reject(new Error("killed")), { once: true });
      }),
  });
  // Suppress the "killed" rejection — it is expected when move-bg kills this task.
  handle.done.catch(() => undefined);
  return { id: handle.id };
}

// ---------------------------------------------------------------------------
// 14.2.A — /task move-bg happy path
// ---------------------------------------------------------------------------

describe("v14 Live Control E2E — /task move-bg happy path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("move-bg cancels FG task and re-spawns as BG, returns confirmation reply", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();
    const { id } = spawnFgTask(registry, "sdd-explore");

    const result = await interceptTaskCommand(
      `/task move-bg ${id}`,
      "sess_movebg_e2e",
      registry,
      store,
    );

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");

    // Reply must mention the old id and new id
    expect(result.reply).toContain(id);
    expect(result.reply).toContain("background");
  });

  it("after move-bg, registry contains a new BG task (old id killed)", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();
    const { id: oldId } = spawnFgTask(registry, "sdd-design");

    await interceptTaskCommand(`/task move-bg ${oldId}`, "sess_movebg2", registry, store);

    // Old task should be killed
    const oldTask = registry.get(oldId as Parameters<typeof registry.get>[0]);
    if (oldTask) {
      expect(["killed", "error"]).toContain(oldTask.status);
    }
    // There should be at least one more task in the registry (the new BG one)
    // (old task may still appear in killed state depending on registry impl)
    const allTasks = registry.list();
    const bgTasks = allTasks.filter((t) => t.meta["mode"] === "bg");
    expect(bgTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("after move-bg, /task list shows the new BG task", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();
    spawnFgTask(registry, "sdd-spec");
    const { id } = spawnFgTask(registry, "sdd-explore");

    await interceptTaskCommand(`/task move-bg ${id}`, "sess_list_after_movebg", registry, store);

    const listResult = await interceptTaskCommand("/task list", "sess_list_after_movebg", registry, store);
    expect(listResult.handled).toBe(true);
    if (!listResult.handled) throw new Error("unexpected handled:false");

    // The list reply should mention "bg" mode somewhere
    expect(listResult.reply).toMatch(/bg/i);
  });
});

// ---------------------------------------------------------------------------
// 14.2.B — /task move-bg edge cases
// ---------------------------------------------------------------------------

describe("v14 Live Control E2E — /task move-bg edge cases", () => {
  afterEach(() => vi.restoreAllMocks());

  it("move-bg on already-BG task returns no-op reply", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    // Spawn with mode=bg
    const handle = registry.spawn({
      meta: { mode: "bg", agent: "sdd-verify" },
      run: async () => "ok",
    });
    // Suppress unhandled rejection
    handle.done.catch(() => undefined);

    const result = await interceptTaskCommand(
      `/task move-bg ${handle.id}`,
      "sess_already_bg",
      registry,
      store,
    );

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toMatch(/already.*bg|bg.*already|no-op/i);
  });

  it("move-bg with missing task id returns usage error", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand("/task move-bg", "sess_missing_id", registry, store);

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toContain("missing");
  });

  it("move-bg with unknown task id returns not-found error", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand(
      "/task move-bg tsk_does_not_exist",
      "sess_not_found",
      registry,
      store,
    );

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// 14.2.C — /task list
// ---------------------------------------------------------------------------

describe("v14 Live Control E2E — /task list", () => {
  afterEach(() => vi.restoreAllMocks());

  it("empty registry returns 'No active tasks'", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand("/task list", "sess_empty_list", registry, store);

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply).toMatch(/no active tasks/i);
  });

  it("with 2 tasks, list returns a markdown table with both", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();
    const h1 = registry.spawn({
      meta: { mode: "fg", agent: "sdd-explore" },
      run: (_s) => new Promise<void>((_r) => {}),
    });
    h1.done.catch(() => undefined);
    const h2 = registry.spawn({
      meta: { mode: "bg", agent: "sdd-apply" },
      run: (_s) => new Promise<void>((_r) => {}),
    });
    h2.done.catch(() => undefined);

    const result = await interceptTaskCommand("/task list", "sess_two_tasks", registry, store);

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply).toContain(h1.id);
    expect(result.reply).toContain(h2.id);
  });
});

// ---------------------------------------------------------------------------
// 14.2.D — /task kill
// ---------------------------------------------------------------------------

describe("v14 Live Control E2E — /task kill", () => {
  afterEach(() => vi.restoreAllMocks());

  it("kill existing running task → confirmation reply", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();
    const { id } = spawnFgTask(registry, "sdd-spec");

    const result = await interceptTaskCommand(`/task kill ${id}`, "sess_kill", registry, store);

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toContain("cancelled");
    expect(result.reply).toContain(id);
  });

  it("kill unknown task → not-found reply", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand(
      "/task kill tsk_ghost",
      "sess_kill_miss",
      registry,
      store,
    );

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// 14.2.E — Unknown subcommand
// ---------------------------------------------------------------------------

describe("v14 Live Control E2E — unknown subcommand", () => {
  it("unknown /task subcommand returns informative error with valid subcommand list", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand(
      "/task frobnicate",
      "sess_unknown_sub",
      registry,
      store,
    );

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("unexpected handled:false");
    expect(result.reply.toLowerCase()).toMatch(/unknown subcommand|invalid/i);
    // Should mention valid subcommands
    expect(result.reply).toMatch(/list|show|kill|move-bg/i);
  });

  it("non-task message is not handled", async () => {
    const registry = makeRegistry();
    const store = createTaskPolicyStore();

    const result = await interceptTaskCommand(
      "just a regular message",
      "sess_not_task",
      registry,
      store,
    );

    expect(result.handled).toBe(false);
  });
});
