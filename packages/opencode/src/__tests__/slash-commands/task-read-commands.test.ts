/**
 * RED gate — Phase 12.5: /task list|show|logs|kill slash commands
 *
 * Spec ref: tasks.md 12.5
 *
 * Scenarios:
 *   - /task list → formatted markdown list of all registry tasks (mode/status/elapsed)
 *   - /task list with no active tasks → "No active tasks."
 *   - /task show <id> → detailed card (agent, mode, elapsed, prompt preview, status)
 *   - /task show <bad-id> → error "task not found"
 *   - /task logs <id> → returns logs buffer (mocked via meta.logs)
 *   - /task kill <running-id> → cancels via registry, returns confirmation
 *   - /task kill <already-done-id> → "task already completed"
 *   - Invalid subcommand: /task foo bar → error listing valid subcommands
 *   - Zero stdout assertion (production mode)
 *
 * Zero-pollution: no stdout bytes emitted in any scenario.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import {
  interceptTaskListCommand,
  interceptTaskShowCommand,
  interceptTaskLogsCommand,
  interceptTaskKillCommand,
  interceptTaskCommand,
  createTaskPolicyStore,
  type TaskPolicyStore,
} from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(): TaskRegistry {
  return new TaskRegistry();
}

type SpawnedTask = { id: string };

/** Spawn a running task with given meta. Returns id. */
function spawnTask(
  registry: TaskRegistry,
  meta: Record<string, unknown>,
): SpawnedTask {
  const handle = registry.spawn({
    meta,
    run: (signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  handle.done.catch(() => undefined);
  return { id: handle.id };
}

/** Spawn a task that completes immediately. */
async function spawnCompletedTask(
  registry: TaskRegistry,
  meta: Record<string, unknown>,
): Promise<SpawnedTask> {
  const handle = registry.spawn({ meta, run: async () => "done" });
  await handle.done;
  return { id: handle.id };
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
// /task list tests
// ---------------------------------------------------------------------------

describe("interceptTaskListCommand — empty registry", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'No active tasks.' when registry is empty", () => {
    const result = interceptTaskListCommand(registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("no active tasks");
    }
  });
});

describe("interceptTaskListCommand — tasks present", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns handled: true with a table containing the task id", () => {
    const { id } = spawnTask(registry, { mode: "fg", agent: "sdd-explore" });
    const result = interceptTaskListCommand(registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(id);
    }
  });

  it("includes mode in the reply", () => {
    spawnTask(registry, { mode: "bg", agent: "sdd-apply" });
    const result = interceptTaskListCommand(registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("bg");
    }
  });

  it("includes status in the reply", () => {
    spawnTask(registry, { mode: "fg" });
    const result = interceptTaskListCommand(registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("running");
    }
  });

  it("lists all tasks when multiple are present", () => {
    const t1 = spawnTask(registry, { mode: "fg", agent: "a1" });
    const t2 = spawnTask(registry, { mode: "bg", agent: "a2" });
    const result = interceptTaskListCommand(registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(t1.id);
      expect(result.reply).toContain(t2.id);
    }
  });
});

// ---------------------------------------------------------------------------
// /task show tests
// ---------------------------------------------------------------------------

describe("interceptTaskShowCommand — unknown id", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'not found' for unknown id", () => {
    const result = interceptTaskShowCommand("tsk_NoSuchTask", registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("not found");
    }
  });
});

describe("interceptTaskShowCommand — valid id", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns handled: true with a card containing the task id", () => {
    const { id } = spawnTask(registry, { mode: "fg", agent: "sdd-explore", prompt: "explore codebase" });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(id);
    }
  });

  it("includes agent in the card", () => {
    const { id } = spawnTask(registry, { mode: "fg", agent: "sdd-explore", prompt: "do stuff" });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("sdd-explore");
    }
  });

  it("includes mode in the card", () => {
    const { id } = spawnTask(registry, { mode: "bg", agent: "sdd-apply" });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("bg");
    }
  });

  it("includes status in the card", () => {
    const { id } = spawnTask(registry, { mode: "fg" });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("running");
    }
  });

  it("includes a prompt preview in the card", () => {
    const prompt = "explore the codebase and understand the architecture";
    const { id } = spawnTask(registry, { mode: "fg", prompt });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      // Prompt preview is at most 80 chars
      expect(result.reply).toContain(prompt.slice(0, 20));
    }
  });

  it("truncates long prompts to 80 chars", () => {
    const prompt = "a".repeat(200);
    const { id } = spawnTask(registry, { mode: "fg", prompt });
    const result = interceptTaskShowCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      // Full prompt of 200 chars should NOT appear verbatim
      expect(result.reply).not.toContain(prompt);
      // But first 80 chars should appear
      expect(result.reply).toContain("a".repeat(80));
    }
  });
});

// ---------------------------------------------------------------------------
// /task logs tests
// ---------------------------------------------------------------------------

describe("interceptTaskLogsCommand — unknown id", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'not found' for unknown id", () => {
    const result = interceptTaskLogsCommand("tsk_Unknown", registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("not found");
    }
  });
});

describe("interceptTaskLogsCommand — with logs in meta", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns string logs from meta.logs string field", () => {
    const { id } = spawnTask(registry, { mode: "bg", logs: "line 1\nline 2" });
    const result = interceptTaskLogsCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("line 1");
      expect(result.reply).toContain("line 2");
    }
  });

  it("returns logs from meta.logs array field", () => {
    const { id } = spawnTask(registry, { mode: "bg", logs: ["entry A", "entry B"] });
    const result = interceptTaskLogsCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain("entry A");
      expect(result.reply).toContain("entry B");
    }
  });

  it("returns 'no logs available' when meta.logs is absent", () => {
    const { id } = spawnTask(registry, { mode: "bg" });
    const result = interceptTaskLogsCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("no logs");
    }
  });
});

// ---------------------------------------------------------------------------
// /task kill tests
// ---------------------------------------------------------------------------

describe("interceptTaskKillCommand — unknown id", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'not found' for unknown id", async () => {
    const result = await interceptTaskKillCommand("tsk_Unknown", registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("not found");
    }
  });
});

describe("interceptTaskKillCommand — running task", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("kills the task and returns confirmation", async () => {
    const { id } = spawnTask(registry, { mode: "fg" });
    const preState = registry.get(id as Parameters<typeof registry.get>[0]);
    expect(preState?.status).toBe("running");

    const result = await interceptTaskKillCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(id);
      // Should indicate cancelled/killed
      const lower = result.reply.toLowerCase();
      expect(lower.includes("cancel") || lower.includes("kill")).toBe(true);
    }
    // Task should be killed
    const state = registry.get(id as Parameters<typeof registry.get>[0]);
    expect(state?.status).toBe("killed");
  });
});

describe("interceptTaskKillCommand — already completed task", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns 'already completed' for a completed task", async () => {
    const { id } = await spawnCompletedTask(registry, { mode: "fg" });
    const result = await interceptTaskKillCommand(id, registry);
    expect(result.handled).toBe(true);
    if (result.handled) {
      const lower = result.reply.toLowerCase();
      expect(lower.includes("already") || lower.includes("completed")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// /task dispatcher — invalid subcommand
// ---------------------------------------------------------------------------

describe("interceptTaskCommand — invalid subcommand", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("returns error listing valid subcommands for unknown subcommand", async () => {
    const result = await interceptTaskCommand("/task foo bar", "sess_1", registry, store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      const lower = result.reply.toLowerCase();
      // Should mention valid subcommands
      expect(
        lower.includes("valid") || lower.includes("list") || lower.includes("unknown"),
      ).toBe(true);
    }
  });

  it("returns handled: false for non-/task messages", async () => {
    const result = await interceptTaskCommand("hello world", "sess_1", registry, store);
    expect(result.handled).toBe(false);
  });

  it("routes /task list to list handler", async () => {
    spawnTask(registry, { mode: "bg" });
    const result = await interceptTaskCommand("/task list", "sess_1", registry, store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("task");
    }
  });

  it("routes /task show <id> to show handler", async () => {
    const { id } = spawnTask(registry, { mode: "fg", agent: "tester" });
    const result = await interceptTaskCommand(`/task show ${id}`, "sess_1", registry, store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(id);
    }
  });

  it("routes /task kill <id> to kill handler", async () => {
    const { id } = spawnTask(registry, { mode: "fg" });
    const result = await interceptTaskCommand(`/task kill ${id}`, "sess_1", registry, store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply).toContain(id);
    }
  });

  it("routes /task policy bg to policy handler", async () => {
    const result = await interceptTaskCommand("/task policy bg", "sess_1", registry, store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("policy");
    }
  });
});

// ---------------------------------------------------------------------------
// Zero stdout assertion
// ---------------------------------------------------------------------------

describe("Task read commands — zero stdout (production mode)", () => {
  let registry: TaskRegistry;
  let store: TaskPolicyStore;

  beforeEach(() => {
    registry = makeRegistry();
    store = createTaskPolicyStore();
    delete process.env["BG_SUBAGENTS_DEBUG"];
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("/task list emits zero stdout bytes", async () => {
    spawnTask(registry, { mode: "bg" });
    const bytes = await captureStdoutBytes(() => {
      interceptTaskListCommand(registry);
    });
    expect(bytes).toBe(0);
  });

  it("/task show emits zero stdout bytes", async () => {
    const { id } = spawnTask(registry, { mode: "fg" });
    const bytes = await captureStdoutBytes(() => {
      interceptTaskShowCommand(id, registry);
    });
    expect(bytes).toBe(0);
  });

  it("/task logs emits zero stdout bytes", async () => {
    const { id } = spawnTask(registry, { mode: "bg", logs: "some log" });
    const bytes = await captureStdoutBytes(() => {
      interceptTaskLogsCommand(id, registry);
    });
    expect(bytes).toBe(0);
  });

  it("/task kill emits zero stdout bytes", async () => {
    const { id } = spawnTask(registry, { mode: "fg" });
    const bytes = await captureStdoutBytes(async () => {
      await interceptTaskKillCommand(id, registry);
    });
    expect(bytes).toBe(0);
  });

  it("/task foo (invalid) emits zero stdout bytes", async () => {
    const bytes = await captureStdoutBytes(async () => {
      await interceptTaskCommand("/task foo", "sess_1", registry, store);
    });
    expect(bytes).toBe(0);
  });
});
