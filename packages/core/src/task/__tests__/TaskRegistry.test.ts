/**
 * RED gate for `src/task/TaskRegistry.ts`.
 *
 * Covers Batch 3 spec §1.c — in-memory registry with EventEmitter-backed
 * completion + progress signals, AbortController cancellation propagation,
 * optional HistoryStore integration, and bounded GC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRegistry, type CompletionEvent } from "../TaskRegistry.js";
import { isValidTaskId } from "../id.js";
import { unsafeTaskId } from "@maicolextic/bg-subagents-protocol";

/** Helper: resolve after n ms. */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("TaskRegistry / spawn + get + list", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("spawn returns a handle with a generated TaskId when id is omitted", async () => {
    const handle = registry.spawn({
      run: async () => 42,
    });
    expect(isValidTaskId(handle.id)).toBe(true);
    await expect(handle.done).resolves.toBe(42);
  });

  it("spawn uses the provided id when supplied", async () => {
    const id = unsafeTaskId("tsk_FixedIdValue");
    const handle = registry.spawn({
      id,
      run: async () => "ok",
    });
    expect(handle.id).toBe(id);
    await handle.done;
    expect(registry.get(id)?.id).toBe(id);
  });

  it("get returns TaskState by id; undefined when unknown", () => {
    const handle = registry.spawn({ run: async () => "x" });
    expect(registry.get(handle.id)?.status).toBe("running");
    expect(registry.get(unsafeTaskId("tsk_UnknownUnkno"))).toBeUndefined();
  });

  it("list returns all tasks; filter by status narrows the result", async () => {
    const a = registry.spawn({ run: async () => "a" });
    const b = registry.spawn({ run: async () => "b" });
    await Promise.all([a.done, b.done]);
    const all = registry.list();
    expect(all.length).toBe(2);
    expect(new Set(all.map((t) => t.id))).toEqual(new Set([a.id, b.id]));
    const completed = registry.list({ status: "completed" });
    expect(completed.length).toBe(2);
    const running = registry.list({ status: "running" });
    expect(running.length).toBe(0);
  });

  it("exposes size() for observability", async () => {
    expect(registry.size()).toBe(0);
    const a = registry.spawn({ run: async () => "a" });
    const b = registry.spawn({ run: async () => "b" });
    expect(registry.size()).toBe(2);
    await Promise.all([a.done, b.done]);
    expect(registry.size()).toBe(2);
  });
});

describe("TaskRegistry / events", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("onComplete fires once with CompletionEvent; unsub stops future calls", async () => {
    const events: CompletionEvent[] = [];
    const unsub = registry.onComplete((e) => events.push(e));
    const a = registry.spawn({ run: async () => "alpha" });
    await a.done;
    expect(events.length).toBe(1);
    expect(events[0]?.status).toBe("completed");
    expect(events[0]?.task_id).toBe(a.id);
    expect(events[0]?.result).toBe("alpha");

    unsub();
    const b = registry.spawn({ run: async () => "beta" });
    await b.done;
    expect(events.length).toBe(1);
  });

  it("onProgress fires per progress signal for the matching task only", async () => {
    const progressEvents: Array<{ task_id: string; message: string }> = [];
    const handle = registry.spawn({
      run: async (signal, progress) => {
        progress?.("step-1");
        progress?.("step-2");
        void signal;
        return "done";
      },
    });
    const unsub = registry.onProgress(handle.id, (e) => {
      progressEvents.push({ task_id: e.task_id, message: e.message });
    });
    await handle.done;
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(progressEvents.every((e) => e.task_id === handle.id)).toBe(true);
    expect(progressEvents.map((e) => e.message)).toContain("step-1");
    expect(progressEvents.map((e) => e.message)).toContain("step-2");
    unsub();
  });

  it("catches unhandled rejection → emits CompletionEvent with status=error + message/stack", async () => {
    const events: CompletionEvent[] = [];
    registry.onComplete((e) => events.push(e));
    const handle = registry.spawn({
      run: async () => {
        throw new Error("boom");
      },
    });
    await expect(handle.done).rejects.toThrow("boom");
    expect(events.length).toBe(1);
    expect(events[0]?.status).toBe("error");
    expect(events[0]?.error?.message).toBe("boom");
    expect(typeof events[0]?.error?.stack).toBe("string");
  });
});

describe("TaskRegistry / kill + cancellation", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("kill transitions running → killed, triggers AbortSignal, emits completion", async () => {
    const events: CompletionEvent[] = [];
    registry.onComplete((e) => events.push(e));
    let aborted = false;
    const handle = registry.spawn({
      run: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return "never";
      },
    });
    // Let the run callback register its abort listener before killing.
    await sleep(5);
    await registry.kill(handle.id);
    await expect(handle.done).rejects.toThrow();
    expect(aborted).toBe(true);
    expect(registry.get(handle.id)?.status).toBe("killed");
    expect(events.length).toBe(1);
    expect(events[0]?.status).toBe("killed");
  });
});

describe("TaskRegistry / concurrency + gc + history integration", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  afterEach(() => {
    registry.disposeAll();
  });

  it("concurrent spawns don't cross-pollute state", async () => {
    const handles = Array.from({ length: 25 }, (_, i) =>
      registry.spawn({ run: async () => `value-${i}` }),
    );
    const results = await Promise.all(handles.map((h) => h.done));
    expect(results).toEqual(handles.map((_, i) => `value-${i}`));
    const ids = new Set(handles.map((h) => h.id));
    expect(ids.size).toBe(25);
  });

  it("gc evicts terminal tasks older than olderThanMs; preserves running", async () => {
    const done = registry.spawn({ run: async () => "ok" });
    await done.done;
    const running = registry.spawn({
      run: async (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve("aborted"),
            { once: true },
          );
        }),
    });
    // Wait for terminal task to age.
    await sleep(40);
    const evicted = registry.gc({ olderThanMs: 20 });
    expect(evicted).toBe(1);
    expect(registry.get(done.id)).toBeUndefined();
    expect(registry.get(running.id)?.status).toBe("running");
    // cleanup
    await registry.kill(running.id);
    await running.done.catch(() => undefined);
  });

  it("forwards HistoryStore.append events for spawn + complete transitions", async () => {
    const recorded: Array<{ type: string; task_id: string }> = [];
    const historyStub = {
      append: vi.fn(async (evt: { type: string; task_id: string }) => {
        recorded.push({ type: evt.type, task_id: evt.task_id });
      }),
    };
    const reg = new TaskRegistry({
      history: historyStub as unknown as NonNullable<
        ConstructorParameters<typeof TaskRegistry>[0]
      >["history"],
    });
    const handle = reg.spawn({
      meta: { agent: "test" },
      run: async () => "value",
    });
    await handle.done;
    reg.disposeAll();
    const kinds = recorded.map((r) => r.type);
    expect(kinds).toContain("spawn");
    expect(kinds).toContain("complete");
    expect(recorded.every((r) => r.task_id === handle.id)).toBe(true);
    expect(historyStub.append).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Single-delivery guarantee (Phase 6 — delivery dedupe)
// ---------------------------------------------------------------------------
//
// Spec: openspec/changes/opencode-plan-review-live-control/specs/delivery/spec.md
//   "Each task MUST produce at most one delivery to the main chat, regardless
//    of whether primary or fallback succeeded. `markDelivered(task_id)` MUST
//    return true the first time and false on every subsequent call."

describe("TaskRegistry / delivery dedupe", () => {
  it("markDelivered returns true the first time for a given id", () => {
    const reg = new TaskRegistry();
    const handle = reg.spawn({ run: async () => "ok" });
    expect(reg.markDelivered(handle.id)).toBe(true);
  });

  it("markDelivered returns false on subsequent calls for the same id", () => {
    const reg = new TaskRegistry();
    const handle = reg.spawn({ run: async () => "ok" });
    reg.markDelivered(handle.id);
    expect(reg.markDelivered(handle.id)).toBe(false);
    expect(reg.markDelivered(handle.id)).toBe(false);
  });

  it("markDelivered tracks ids independently", () => {
    const reg = new TaskRegistry();
    const a = reg.spawn({ run: async () => "a" });
    const b = reg.spawn({ run: async () => "b" });
    expect(reg.markDelivered(a.id)).toBe(true);
    expect(reg.markDelivered(b.id)).toBe(true);
    expect(reg.markDelivered(a.id)).toBe(false);
    expect(reg.markDelivered(b.id)).toBe(false);
  });

  it("markDelivered works for ids that were never spawned (defensive)", () => {
    const reg = new TaskRegistry();
    const fakeId = unsafeTaskId("tsk_synthetic_never_spawned");
    expect(reg.markDelivered(fakeId)).toBe(true);
    expect(reg.markDelivered(fakeId)).toBe(false);
  });

  it("race: three simultaneous markDelivered calls yield exactly one true", async () => {
    const reg = new TaskRegistry();
    const handle = reg.spawn({ run: async () => "ok" });
    const results = await Promise.all([
      Promise.resolve(reg.markDelivered(handle.id)),
      Promise.resolve(reg.markDelivered(handle.id)),
      Promise.resolve(reg.markDelivered(handle.id)),
    ]);
    const trues = results.filter(Boolean).length;
    expect(trues).toBe(1);
  });
});
