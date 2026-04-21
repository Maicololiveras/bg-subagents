/**
 * RED gate for `src/cli/commands.ts`.
 *
 * Pure command implementations take a deps object (TaskRegistry, HistoryStore,
 * stdout writable) so tests can inject fakes. Each command returns
 * `{ exit_code, stdout_captured? }` for tests + programmatic callers. No host
 * IO — that's the adapter's job.
 *
 * FR-7 (list/show/kill/logs) + FR-18 (kill).
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskId, TaskStatus } from "@maicolextic/bg-subagents-protocol";

import { HistoryStore, type HistoryEvent } from "../../task/HistoryStore.js";
import { TaskRegistry } from "../../task/TaskRegistry.js";
import {
  killCommand,
  listCommand,
  logsCommand,
  showCommand,
} from "../commands.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function tempHistoryStore(): Promise<{
  store: HistoryStore;
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "bg-cli-"));
  const store = new HistoryStore({ path: join(dir, "history.jsonl") });
  return {
    store,
    dir,
    async cleanup(): Promise<void> {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function collectStdout(): { stdout: { write(chunk: string): void }; text: () => string } {
  const chunks: string[] = [];
  return {
    stdout: {
      write(chunk: string): void {
        chunks.push(chunk);
      },
    },
    text(): string {
      return chunks.join("");
    },
  };
}

async function spawnTaskToCompletion(
  registry: TaskRegistry,
  meta: Record<string, unknown> = {},
): Promise<TaskId> {
  const h = registry.spawn({
    meta,
    run: async () => "done",
  });
  await h.done;
  return h.id;
}

function spawnLiveTask(
  registry: TaskRegistry,
  meta: Record<string, unknown> = {},
): { id: TaskId; done: Promise<unknown> } {
  const h = registry.spawn<unknown>({
    meta,
    run: (signal: AbortSignal): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const onAbort = (): void => {
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        // Resolve after a long delay — tests should kill before this fires.
        setTimeout(() => resolve("late"), 60_000);
      }),
  });
  // Swallow rejection so vitest doesn't flag the handle's unhandled error.
  h.done.catch(() => undefined);
  return { id: h.id, done: h.done };
}

// -----------------------------------------------------------------------------
// listCommand
// -----------------------------------------------------------------------------

describe("listCommand", () => {
  it("prints a table of all tasks (exit 0)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    await spawnTaskToCompletion(registry, { agent: "alpha" });
    await spawnTaskToCompletion(registry, { agent: "beta" });

    const { stdout, text } = collectStdout();
    const res = listCommand({ registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    const out = text();
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    await cleanup();
  });

  it("filters with status: 'running' narrows output", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    await spawnTaskToCompletion(registry, { agent: "done-agent" });
    const live = spawnLiveTask(registry, { agent: "live-agent" });

    const { stdout, text } = collectStdout();
    const res = listCommand({
      registry,
      history: store,
      stdout,
      filter: { status: "running" as TaskStatus },
    });
    expect(res.exit_code).toBe(0);
    const out = text();
    expect(out).toContain("live-agent");
    expect(out).not.toContain("done-agent");

    await registry.kill(live.id);
    await cleanup();
  });

  it("prints 'No tasks.' when registry is empty", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const { stdout, text } = collectStdout();
    const res = listCommand({ registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    expect(text()).toContain("No tasks.");
    await cleanup();
  });
});

// -----------------------------------------------------------------------------
// showCommand
// -----------------------------------------------------------------------------

describe("showCommand", () => {
  it("prints detail for an existing task (exit 0)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const id = await spawnTaskToCompletion(registry, { agent: "detail-agent" });
    const { stdout, text } = collectStdout();
    const res = showCommand({ id, registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    const out = text();
    expect(out).toContain(id);
    expect(out).toContain("detail-agent");
    await cleanup();
  });

  it("returns exit_code 1 for a non-existent id", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const { stdout, text } = collectStdout();
    const res = showCommand({
      id: "tsk_doesnotexist" as TaskId,
      registry,
      history: store,
      stdout,
    });
    expect(res.exit_code).toBe(1);
    expect(text()).toContain("tsk_doesnotexist");
    await cleanup();
  });
});

// -----------------------------------------------------------------------------
// killCommand
// -----------------------------------------------------------------------------

describe("killCommand", () => {
  it("kills a running task and prints confirmation (exit 0)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const live = spawnLiveTask(registry, { agent: "will-die" });

    const { stdout, text } = collectStdout();
    const res = await killCommand({ id: live.id, registry, stdout });
    expect(res.exit_code).toBe(0);
    expect(text()).toContain(live.id);
    expect(registry.get(live.id)?.status).toBe("killed");
    await cleanup();
  });

  it("prints 'already done' for a terminal task (exit 0)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const id = await spawnTaskToCompletion(registry, { agent: "done" });
    const { stdout, text } = collectStdout();
    const res = await killCommand({ id, registry, stdout });
    expect(res.exit_code).toBe(0);
    expect(text().toLowerCase()).toContain("already");
    await cleanup();
  });

  it("returns exit_code 1 for missing id", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const { stdout } = collectStdout();
    const res = await killCommand({
      id: "tsk_nope" as TaskId,
      registry,
      stdout,
    });
    expect(res.exit_code).toBe(1);
    await cleanup();
  });

  it("invokes registry.kill exactly once on a live task (no double-kill)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const live = spawnLiveTask(registry, { agent: "counted" });

    let killCalls = 0;
    const originalKill = registry.kill.bind(registry);
    registry.kill = async (id: TaskId): Promise<void> => {
      killCalls += 1;
      await originalKill(id);
    };

    const { stdout } = collectStdout();
    const res = await killCommand({ id: live.id, registry, stdout });
    expect(res.exit_code).toBe(0);
    expect(killCalls).toBe(1);
    expect(registry.get(live.id)?.status).toBe("killed");
    await cleanup();
  });
});

// -----------------------------------------------------------------------------
// logsCommand
// -----------------------------------------------------------------------------

describe("logsCommand", () => {
  it("reads history.read({ task_id }) and prints events", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const registry = new TaskRegistry({ history: store });
    const id = await spawnTaskToCompletion(registry, { agent: "loggy" });
    await store.flushRotation();

    const { stdout, text } = collectStdout();
    const res = await logsCommand({ id, history: store, stdout });
    expect(res.exit_code).toBe(0);
    const out = text();
    // Each history event lives on its own output line.
    expect(out.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain(id);
    await cleanup();
  });

  it("respects tail N (limits output to last N events)", async () => {
    const { store, cleanup } = await tempHistoryStore();
    // Hand-seed 5 events manually so we bypass registry timing.
    const id = "tsk_seeded000001";
    const ts = 1_700_000_000_000;
    const events: HistoryEvent[] = [
      { type: "spawn", task_id: id, ts, meta: {} },
      { type: "progress", task_id: id, ts: ts + 1, message: "a" },
      { type: "progress", task_id: id, ts: ts + 2, message: "b" },
      { type: "progress", task_id: id, ts: ts + 3, message: "c" },
      { type: "complete", task_id: id, ts: ts + 4, status: "completed" },
    ];
    for (const e of events) await store.append(e);
    await store.flushRotation();

    const { stdout, text } = collectStdout();
    const res = await logsCommand({ id, history: store, stdout, tail: 2 });
    expect(res.exit_code).toBe(0);
    const lines = text().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    // The last two events are `progress c` and `complete`.
    expect(text()).toContain("complete");
    await cleanup();
  });

  it("returns exit_code 0 (empty) for unknown id — history is agnostic", async () => {
    const { store, cleanup } = await tempHistoryStore();
    const { stdout, text } = collectStdout();
    const res = await logsCommand({
      id: "tsk_unknown0000000" as TaskId,
      history: store,
      stdout,
    });
    expect(res.exit_code).toBe(0);
    expect(text().trim()).toBe("");
    await cleanup();
  });
});
