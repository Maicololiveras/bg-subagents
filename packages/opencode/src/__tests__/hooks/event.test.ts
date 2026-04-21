/**
 * Bus event delivery tests (primary completion path).
 */
import { describe, expect, it, vi } from "vitest";

import { HistoryStore, TaskRegistry } from "@maicolextic/bg-subagents-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TASK_COMPLETE_BUS_EVENT, wireBusEvents } from "../../hooks/event.js";
import type { Bus } from "../../types.js";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-event-"));
}

function mkRegistry(): { registry: TaskRegistry; history: HistoryStore } {
  const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
  const registry = new TaskRegistry({ history });
  return { registry, history };
}

describe("wireBusEvents", () => {
  it("reports busAvailable=false when no bus is passed", () => {
    const { registry } = mkRegistry();
    const handle = wireBusEvents({ registry });
    expect(handle.busAvailable()).toBe(false);
  });

  it("reports busAvailable=true when a bus is passed", () => {
    const { registry } = mkRegistry();
    const bus: Bus = { emit: vi.fn() };
    const handle = wireBusEvents({ registry, bus });
    expect(handle.busAvailable()).toBe(true);
  });

  it("emits a bus event with the expected type on task completion", async () => {
    const { registry } = mkRegistry();
    const emitted: Array<Record<string, unknown>> = [];
    const bus: Bus = {
      emit(e) {
        emitted.push(e as Record<string, unknown>);
      },
    };
    wireBusEvents({ registry, bus });

    const handle = registry.spawn({ run: async () => "ok" });
    await handle.done;
    // flush microtasks
    await new Promise((r) => setTimeout(r, 5));

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const payload = emitted.find((e) => e["type"] === TASK_COMPLETE_BUS_EVENT);
    expect(payload).toBeDefined();
    expect(payload!["task_id"]).toBe(handle.id);
    expect(payload!["status"]).toBe("completed");
    expect(payload!["result"]).toBe("ok");
  });

  it("calls onDelivered with the task_id after successful emit", async () => {
    const { registry } = mkRegistry();
    const delivered: string[] = [];
    const bus: Bus = { emit: vi.fn() };
    wireBusEvents({
      registry,
      bus,
      onDelivered: (id) => delivered.push(id),
    });

    const handle = registry.spawn({ run: async () => 42 });
    await handle.done;
    await new Promise((r) => setTimeout(r, 5));

    expect(delivered).toEqual([handle.id]);
  });

  it("does not throw when bus.emit throws synchronously", async () => {
    const { registry } = mkRegistry();
    const bus: Bus = {
      emit() {
        throw new Error("bus failure");
      },
    };
    wireBusEvents({ registry, bus });

    const handle = registry.spawn({ run: async () => "ok" });
    // The registry should still settle normally — emit error is swallowed.
    await expect(handle.done).resolves.toBe("ok");
  });

  it("registers a noop unsubscribe handle when bus is absent (handle.unsubscribe is a function)", () => {
    const { registry } = mkRegistry();
    const handle = wireBusEvents({ registry });
    expect(typeof handle.unsubscribe).toBe("function");
    expect(() => handle.unsubscribe()).not.toThrow();
  });

  it("emits error status in payload when subagent rejects", async () => {
    const { registry } = mkRegistry();
    const emitted: Array<Record<string, unknown>> = [];
    const bus: Bus = {
      emit(e) {
        emitted.push(e as Record<string, unknown>);
      },
    };
    wireBusEvents({ registry, bus });

    const handle = registry.spawn({
      run: async () => {
        throw new Error("boom");
      },
    });
    await expect(handle.done).rejects.toThrow(/boom/);
    await new Promise((r) => setTimeout(r, 5));

    const payload = emitted.find((e) => e["type"] === TASK_COMPLETE_BUS_EVENT);
    expect(payload).toBeDefined();
    expect(payload!["status"]).toBe("error");
    expect(payload!["error"]).toBeDefined();
  });
});
