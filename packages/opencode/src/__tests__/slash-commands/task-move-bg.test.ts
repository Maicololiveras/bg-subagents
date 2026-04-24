/**
 * RED gate — Phase 12.3: /task move-bg slash command
 *
 * Spec ref: tasks.md 12.3
 *
 * Scenarios:
 *   - Valid: /task move-bg <id> where task is running in FG
 *     → kills it + re-spawns in BG, returns confirmation message
 *   - Invalid: /task move-bg <unknown-id> → error "task not found"
 *   - Invalid: /task move-bg (no arg) → error "missing task id"
 *   - Already BG: /task move-bg <bg-task-id> → "task already in BG, no-op"
 *   - Zero stdout assertion (production mode)
 *
 * Zero-pollution: no stdout bytes emitted in any scenario.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import {
  createTaskPolicyStore,
  interceptTaskMoveBgCommand,
  type TaskPolicyStore,
} from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(): TaskRegistry {
  return new TaskRegistry();
}

/** Spawn a running FG task in the registry (meta.mode = "fg"). */
function spawnFgTask(registry: TaskRegistry): string {
  const handle = registry.spawn({
    meta: { mode: "fg", prompt: "do something", agent: "sdd-explore" },
    run: (signal) =>
      new Promise<void>((_resolve, reject) => {
        // Resolves when aborted (so disposeAll/kill don't leave orphan rejections).
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  // Suppress unhandled rejection — task will be killed or disposed in tests.
  handle.done.catch(() => undefined);
  return handle.id;
}

/** Spawn a running BG task in the registry (meta.mode = "bg"). */
function spawnBgTask(registry: TaskRegistry): string {
  const handle = registry.spawn({
    meta: { mode: "bg", prompt: "bg work", agent: "sdd-apply" },
    run: (signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  // Suppress unhandled rejection.
  handle.done.catch(() => undefined);
  return handle.id;
}

// ---------------------------------------------------------------------------
// Zero-stdout capture helper
// ---------------------------------------------------------------------------

function captureStdoutBytes(fn: () => void | Promise<void>): Promise<number> {
  return new Promise<number>((resolve) => {
    let bytes = 0;
    const orig = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(
      (...args: Parameters<typeof process.stdout.write>): boolean => {
        const chunk = args[0];
        if (typeof chunk === "string") bytes += chunk.length;
        else if (Buffer.isBuffer(chunk)) bytes += chunk.byteLength;
        return orig(...(args as Parameters<typeof orig>));
      },
    );
    const result = fn();
    const cleanup = (): void => {
      spy.mockRestore();
      resolve(bytes);
    };
    if (result instanceof Promise) {
      result.then(cleanup, cleanup);
    } else {
      cleanup();
    }
  });
}

// ---------------------------------------------------------------------------
// Tests — missing task id
// ---------------------------------------------------------------------------

describe("interceptTaskMoveBgCommand — missing task id", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns error for bare /task move-bg (no id)", async () => {
    const result = await interceptTaskMoveBgCommand(
      "/task move-bg",
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("missing");
    }
  });

  it("returns error for /task move-bg with only whitespace after", async () => {
    const result = await interceptTaskMoveBgCommand(
      "/task move-bg   ",
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("missing");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — unknown task id
// ---------------------------------------------------------------------------

describe("interceptTaskMoveBgCommand — unknown task id", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'task not found' for an id not in the registry", async () => {
    const result = await interceptTaskMoveBgCommand(
      "/task move-bg tsk_DoesNotExist",
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("not found");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — task already BG
// ---------------------------------------------------------------------------

describe("interceptTaskMoveBgCommand — task already in BG", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns no-op message when task meta.mode is already 'bg'", async () => {
    const id = spawnBgTask(registry);
    const result = await interceptTaskMoveBgCommand(
      `/task move-bg ${id}`,
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      // Should indicate it's already BG — no-op
      const lower = result.reply.toLowerCase();
      expect(lower.includes("already") || lower.includes("no-op")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — valid FG → BG move
// ---------------------------------------------------------------------------

describe("interceptTaskMoveBgCommand — valid FG task move to BG", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns handled: true with a confirmation reply", async () => {
    const id = spawnFgTask(registry);
    const result = await interceptTaskMoveBgCommand(
      `/task move-bg ${id}`,
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
    }
  });

  it("kills the original task (status becomes 'killed')", async () => {
    const id = spawnFgTask(registry);
    expect(registry.get(id)?.status).toBe("running");

    await interceptTaskMoveBgCommand(
      `/task move-bg ${id}`,
      "sess_1",
      registry,
      store,
    );

    // Original task should be killed
    const state = registry.get(id);
    expect(state?.status).toBe("killed");
  });

  it("spawns a new task with mode=bg in registry", async () => {
    const id = spawnFgTask(registry);
    const countBefore = registry.list().length;

    await interceptTaskMoveBgCommand(
      `/task move-bg ${id}`,
      "sess_1",
      registry,
      store,
    );

    // A new task should have been spawned
    expect(registry.list().length).toBeGreaterThan(countBefore);
    // The new task should have mode="bg" in meta
    const tasks = registry.list();
    const newTask = tasks.find(
      (t) => t.id !== id && t.meta.mode === "bg" && t.status === "running",
    );
    expect(newTask).toBeDefined();
  });

  it("new task id is included in the reply", async () => {
    const id = spawnFgTask(registry);
    const result = await interceptTaskMoveBgCommand(
      `/task move-bg ${id}`,
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(true);
    if (result.handled) {
      // Reply should reference a new task id (tsk_ prefix)
      expect(result.reply).toMatch(/tsk_/);
    }
  });

  it("does not match a non-/task command", async () => {
    const result = await interceptTaskMoveBgCommand(
      "move something else",
      "sess_1",
      registry,
      store,
    );
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — zero stdout assertion
// ---------------------------------------------------------------------------

describe("interceptTaskMoveBgCommand — zero stdout (production mode)", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
    // Ensure no debug mode
    delete process.env["BG_SUBAGENTS_DEBUG"];
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("emits zero stdout bytes for unknown id scenario", async () => {
    const bytes = await captureStdoutBytes(async () => {
      await interceptTaskMoveBgCommand(
        "/task move-bg tsk_Unknown",
        "sess_stdout",
        registry,
        store,
      );
    });
    expect(bytes).toBe(0);
  });

  it("emits zero stdout bytes for valid move scenario", async () => {
    const id = spawnFgTask(registry);
    const bytes = await captureStdoutBytes(async () => {
      await interceptTaskMoveBgCommand(
        `/task move-bg ${id}`,
        "sess_stdout",
        registry,
        store,
      );
    });
    expect(bytes).toBe(0);
  });
});
