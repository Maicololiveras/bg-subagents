/**
 * Phase 12.7 RED — TUI sidebar slot unit tests.
 *
 * Covers:
 *   - getSidebarData() returns { tasks: SidebarTaskRow[] } with one row per registered task.
 *   - Each row includes: id (short form), agentName, mode ("bg" | "fg"), status, elapsedMs.
 *   - When SharedPluginState.current() returns undefined, getSidebarData() returns { tasks: [] }.
 *   - When registry is empty, returns { tasks: [] }.
 *   - Sorting: running tasks first (by most-recent-started), then done/failed (by most-recent-finished).
 *   - buildSidebarSlotPlugin(options?) returns an object with a `slots` surface keyed by slot name.
 *   - Polling interval default is 1000ms, overridable via buildSidebarSlotPlugin({ pollIntervalMs }).
 *   - Zero stdout assertion.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 12.7
 * Design: design.md ADR-9 + TUI scope (v1.0)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSidebarData,
  buildSidebarSlotPlugin,
  type SidebarTaskRow,
  type SidebarData,
  type BuildSidebarOptions,
} from "../../tui-plugin/sidebar.js";
import {
  registerFromServer,
  clear as clearSharedState,
} from "../../tui-plugin/shared-state.js";
import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import { createTaskPolicyStore } from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSharedState(registry?: TaskRegistry) {
  const reg = registry ?? new TaskRegistry();
  const policyStore = createTaskPolicyStore();
  return { registry: reg, policyStore };
}

function spawnTask(
  registry: TaskRegistry,
  meta: Record<string, unknown>,
): { id: string; done: Promise<unknown> } {
  const handle = registry.spawn({
    meta,
    run: (_signal) => new Promise(() => undefined), // never resolves (no setTimeout — fake-timer safe)
  });
  // Suppress unhandled rejection if the task gets killed/cancelled by test cleanup
  handle.done.catch(() => undefined);
  return { id: handle.id, done: handle.done };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSharedState();
  vi.useFakeTimers();
  delete process.env["BG_SUBAGENTS_DEBUG"];
});

afterEach(() => {
  clearSharedState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Undefined shared state — returns empty
// ---------------------------------------------------------------------------

describe("getSidebarData() — no shared state", () => {
  it("returns { tasks: [] } when SharedPluginState.current() is undefined", () => {
    // Nothing registered in globalThis — current() returns undefined
    const data = getSidebarData();
    expect(data).toEqual({ tasks: [] });
  });
});

// ---------------------------------------------------------------------------
// 2. Empty registry — returns empty
// ---------------------------------------------------------------------------

describe("getSidebarData() — empty registry", () => {
  it("returns { tasks: [] } when registry has no tasks", () => {
    const state = makeSharedState();
    registerFromServer(state);

    const data = getSidebarData();
    expect(data).toEqual({ tasks: [] });
  });
});

// ---------------------------------------------------------------------------
// 3. Single running task — shape validation
// ---------------------------------------------------------------------------

describe("getSidebarData() — single running task", () => {
  it("returns one SidebarTaskRow with correct shape for a running BG task", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const nowMs = 1_000_000;
    const { id } = spawnTask(registry, {
      agent_name: "sdd-explore",
      mode: "bg",
    });

    const data = getSidebarData(nowMs + 5_000);

    expect(data.tasks).toHaveLength(1);
    const row = data.tasks[0]!;

    // id must be a non-empty string (short form)
    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(0);

    expect(row.agentName).toBe("sdd-explore");
    expect(row.mode).toBe("bg");
    expect(row.status).toBe("running");
    // elapsedMs must be a non-negative number
    expect(typeof row.elapsedMs).toBe("number");
    expect(row.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("exposes the task id in short form (matches the task id from registry)", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const { id } = spawnTask(registry, { agent_name: "sdd-design", mode: "fg" });

    const data = getSidebarData();
    expect(data.tasks[0]!.id).toBe(id);
  });

  it("maps mode=fg to SidebarTaskRow.mode 'fg'", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-apply", mode: "fg" });

    const data = getSidebarData();
    expect(data.tasks[0]!.mode).toBe("fg");
  });

  it("maps mode=bg to SidebarTaskRow.mode 'bg'", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-verify", mode: "bg" });

    const data = getSidebarData();
    expect(data.tasks[0]!.mode).toBe("bg");
  });

  it("falls back to agentName='' when meta.agent_name is absent", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, {}); // no agent_name in meta

    const data = getSidebarData();
    expect(data.tasks[0]!.agentName).toBe("");
  });

  it("falls back to mode='bg' when meta.mode is absent", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-explore" }); // no mode

    const data = getSidebarData();
    expect(data.tasks[0]!.mode).toBe("bg");
  });
});

// ---------------------------------------------------------------------------
// 4. Status mapping
// ---------------------------------------------------------------------------

describe("getSidebarData() — status mapping", () => {
  it("maps TaskStatus 'running' → SidebarTaskRow.status 'running'", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });

    const data = getSidebarData();
    expect(data.tasks[0]!.status).toBe("running");
  });

  it("maps TaskStatus 'completed' → SidebarTaskRow.status 'done'", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    // Spawn a task that resolves immediately
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "bg" },
      run: () => Promise.resolve("ok"),
    });

    // Wait for the task to complete
    await handle.done;

    const data = getSidebarData();
    expect(data.tasks[0]!.status).toBe("done");
  });

  it("maps TaskStatus 'error' → SidebarTaskRow.status 'failed'", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const handle = registry.spawn({
      meta: { agent_name: "sdd-verify", mode: "bg" },
      run: () => Promise.reject(new Error("boom")),
    });

    // Wait for settlement (suppress unhandled rejection)
    await handle.done.catch(() => undefined);

    const data = getSidebarData();
    expect(data.tasks[0]!.status).toBe("failed");
  });

  it("maps TaskStatus 'killed' → SidebarTaskRow.status 'failed'", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const handle = registry.spawn({
      meta: { agent_name: "sdd-archive", mode: "bg" },
      run: (_signal) => new Promise(() => undefined), // never resolves
    });

    // Suppress the rejection before killing
    handle.done.catch(() => undefined);
    await registry.kill(handle.id);

    const data = getSidebarData();
    expect(data.tasks[0]!.status).toBe("failed");
  });

  it("maps TaskStatus 'killed' via cancel() → SidebarTaskRow.status 'failed'", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const handle = registry.spawn({
      meta: { agent_name: "sdd-tasks", mode: "bg" },
      run: (_signal) => new Promise(() => undefined), // never resolves
    });

    // Suppress the rejection from the kill that cancel() triggers
    handle.done.catch(() => undefined);
    handle.cancel();
    // Wait for the registry to process the cancellation
    await Promise.resolve();
    await Promise.resolve();

    const data = getSidebarData();
    const row = data.tasks[0]!;
    expect(row.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 5. elapsedMs computation
// ---------------------------------------------------------------------------

describe("getSidebarData() — elapsedMs", () => {
  it("computes elapsedMs as nowMs - started_at for a running task", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    // Use fake timers: set clock to T=0, spawn, then query at T+5000
    vi.setSystemTime(0);
    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });

    const data = getSidebarData(5_000);
    expect(data.tasks[0]!.elapsedMs).toBe(5_000);
  });

  it("computes elapsedMs as completed_at - started_at for a terminal task", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    vi.setSystemTime(0);
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "bg" },
      run: () => Promise.resolve("done"),
    });

    vi.setSystemTime(3_000);
    await handle.done;

    // nowMs is irrelevant for terminal tasks — elapsed is fixed at (completed_at - started_at)
    const data = getSidebarData(99_999);
    expect(data.tasks[0]!.elapsedMs).toBe(3_000);
  });

  it("includes finishedAtMs for terminal tasks", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    vi.setSystemTime(1_000);
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "bg" },
      run: () => Promise.resolve("done"),
    });

    vi.setSystemTime(4_000);
    await handle.done;

    const data = getSidebarData(99_999);
    expect(data.tasks[0]!.finishedAtMs).toBe(4_000);
  });
});

// ---------------------------------------------------------------------------
// 6. Sorting — running first (most-recent-started), then terminal (most-recent-finished)
// ---------------------------------------------------------------------------

describe("getSidebarData() — sorting", () => {
  it("running tasks appear before terminal tasks", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    // Spawn a task that completes immediately
    vi.setSystemTime(0);
    const doneHandle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "bg" },
      run: () => Promise.resolve("done"),
    });
    await doneHandle.done;

    // Spawn a running task
    vi.setSystemTime(1_000);
    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });

    const data = getSidebarData(5_000);
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0]!.status).toBe("running");
    expect(data.tasks[1]!.status).toBe("done");
  });

  it("among running tasks, most-recently-started comes first", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    vi.setSystemTime(0);
    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" }); // started at 0

    vi.setSystemTime(2_000);
    spawnTask(registry, { agent_name: "sdd-design", mode: "bg" }); // started at 2000

    const data = getSidebarData(5_000);
    expect(data.tasks[0]!.agentName).toBe("sdd-design"); // most recently started
    expect(data.tasks[1]!.agentName).toBe("sdd-explore");
  });

  it("among terminal tasks, most-recently-finished comes first", async () => {
    // Use real timers for this test since fake timers + queueMicrotask ordering
    // is non-deterministic for sequential settlement.
    vi.useRealTimers();

    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    // h1 finishes first
    const h1 = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "bg" },
      run: () => Promise.resolve("done"),
    });
    await h1.done;

    // Small delay to ensure different completed_at timestamps
    await new Promise((r) => setTimeout(r, 5));

    // h2 finishes second (more recent)
    const h2 = registry.spawn({
      meta: { agent_name: "sdd-verify", mode: "bg" },
      run: () => Promise.resolve("done"),
    });
    await h2.done;

    const data = getSidebarData(Date.now());
    // Both terminal; h2 finished later → comes first
    expect(data.tasks[0]!.agentName).toBe("sdd-verify");
    expect(data.tasks[1]!.agentName).toBe("sdd-apply");
  });
});

// ---------------------------------------------------------------------------
// 7. buildSidebarSlotPlugin shape
// ---------------------------------------------------------------------------

describe("buildSidebarSlotPlugin()", () => {
  it("returns an object with a `slots` map containing 'sidebar_content'", () => {
    const plugin = buildSidebarSlotPlugin();

    // Must have a slots map
    expect(plugin).toHaveProperty("slots");
    expect(typeof plugin.slots).toBe("object");
    expect(plugin.slots).not.toBeNull();

    // Must register sidebar_content slot
    expect("sidebar_content" in plugin.slots).toBe(true);
  });

  it("returns an object without an `id` field (TuiSlotPlugin contract: id must be absent)", () => {
    const plugin = buildSidebarSlotPlugin();
    // TuiSlotPlugin<{}> = Omit<SolidPlugin<...>, "id"> & { id?: never }
    // We never set id
    expect((plugin as Record<string, unknown>)["id"]).toBeUndefined();
  });

  it("accepts pollIntervalMs option without throwing", () => {
    expect(() => buildSidebarSlotPlugin({ pollIntervalMs: 500 })).not.toThrow();
  });

  it("uses default pollIntervalMs of 1000ms when not specified", () => {
    const plugin = buildSidebarSlotPlugin();
    // The implementation exposes pollIntervalMs for Phase 13 lifecycle wiring
    expect((plugin as Record<string, unknown>)["pollIntervalMs"]).toBe(1_000);
  });

  it("sidebar_content slot value is a render function (callable)", () => {
    const plugin = buildSidebarSlotPlugin();
    const slotEntry = (plugin.slots as Record<string, unknown>)["sidebar_content"];
    expect(typeof slotEntry).toBe("function");
  });

  it("slot render function accepts { session_id } context and returns a value", () => {
    const plugin = buildSidebarSlotPlugin();
    const renderFn = (plugin.slots as Record<string, (ctx: unknown) => unknown>)["sidebar_content"]!;

    // Should not throw when called with minimal context matching TuiHostSlotMap.sidebar_content
    expect(() => renderFn({ session_id: "test-session" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Multiple tasks — full row set
// ---------------------------------------------------------------------------

describe("getSidebarData() — multiple tasks", () => {
  it("returns one row per task in the registry", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });
    spawnTask(registry, { agent_name: "sdd-design", mode: "fg" });
    spawnTask(registry, { agent_name: "sdd-apply", mode: "bg" });

    const data = getSidebarData();
    expect(data.tasks).toHaveLength(3);
  });

  it("each row has the correct agentName and mode from task meta", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });
    spawnTask(registry, { agent_name: "sdd-apply", mode: "fg" });

    const data = getSidebarData();
    const agentNames = data.tasks.map((r) => r.agentName).sort();
    expect(agentNames).toEqual(["sdd-apply", "sdd-explore"]);

    const row = data.tasks.find((r) => r.agentName === "sdd-apply")!;
    expect(row.mode).toBe("fg");
  });
});

// ---------------------------------------------------------------------------
// 9. Zero stdout assertion
// ---------------------------------------------------------------------------

describe("getSidebarData() — zero stdout pollution", () => {
  it("produces ZERO bytes on stdout when BG_SUBAGENTS_DEBUG is unset", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));
    spawnTask(registry, { agent_name: "sdd-explore", mode: "bg" });
    getSidebarData();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("buildSidebarSlotPlugin() produces ZERO bytes on stdout", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    buildSidebarSlotPlugin({ pollIntervalMs: 500 });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
