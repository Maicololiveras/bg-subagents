/**
 * Phase 13.1 RED — TUI plugin boot integration test.
 *
 * Covers:
 *   - default export shape is `{ id: "bg-subagents-tui", tui: Function }` — id is present and non-empty.
 *   - Calling tui(api, options, meta) resolves without throwing.
 *   - api.slots.register() called exactly once with a SlotPlugin matching sidebar_content slot shape.
 *   - api.lifecycle.onDispose() called once to register cleanup.
 *   - When SharedPluginState.current() is undefined at boot, tui() logs warn via createLogger
 *     but does NOT throw — sidebar slot still registers.
 *   - When SharedPluginState.current() is set, sidebar render reads registry data correctly.
 *   - Zero stdout assertion across all paths.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 13.1
 * Design: design.md ADR-9 + TUI entry point + id requirement (spike TQ-1)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerFromServer,
  clear as clearSharedState,
} from "../../tui-plugin/shared-state.js";
import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import { createTaskPolicyStore } from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Import the module under test (default export = { id, tui })
// ---------------------------------------------------------------------------

import tuiModule from "../../tui-plugin/index.js";

// ---------------------------------------------------------------------------
// Minimal mock of TuiPluginApi surface required by the TUI entry point.
// Mirrors the shape from @opencode-ai/plugin/dist/tui.d.ts without importing
// the peer dep at test time.
// ---------------------------------------------------------------------------

type MockSlotPlugin = {
  slots: Record<string, (ctx: unknown) => unknown>;
};

type MockTuiSlots = {
  register: ReturnType<typeof vi.fn>;
};

type MockTuiLifecycle = {
  onDispose: ReturnType<typeof vi.fn>;
  signal: AbortSignal;
};

type MockTuiPluginApi = {
  slots: MockTuiSlots;
  lifecycle: MockTuiLifecycle;
  ui: {
    toast: ReturnType<typeof vi.fn>;
    dialog: {
      replace: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
  };
};

type MockTuiPluginMeta = {
  id: string;
  state: "first" | "updated" | "same";
  source: "file" | "npm" | "internal";
  spec: string;
  target: string;
  first_time: number;
  last_time: number;
  time_changed: number;
  load_count: number;
  fingerprint: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi(): MockTuiPluginApi {
  return {
    slots: {
      register: vi.fn().mockReturnValue("slot-cleanup-id"),
    },
    lifecycle: {
      onDispose: vi.fn().mockReturnValue(() => undefined),
      signal: new AbortController().signal,
    },
    ui: {
      toast: vi.fn(),
      dialog: {
        replace: vi.fn(),
        clear: vi.fn(),
      },
    },
  };
}

function makeMeta(overrides?: Partial<MockTuiPluginMeta>): MockTuiPluginMeta {
  return {
    id: "bg-subagents-tui",
    state: "first",
    source: "npm",
    spec: "@maicolextic/bg-subagents-opencode/tui",
    target: "./dist/tui-plugin/index.js",
    first_time: Date.now(),
    last_time: Date.now(),
    time_changed: Date.now(),
    load_count: 1,
    fingerprint: "abc123",
    ...overrides,
  };
}

function makeSharedState(registry?: TaskRegistry) {
  const reg = registry ?? new TaskRegistry();
  const policyStore = createTaskPolicyStore();
  return { registry: reg, policyStore };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSharedState();
  delete process.env["BG_SUBAGENTS_DEBUG"];
  vi.useFakeTimers();
});

afterEach(() => {
  clearSharedState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Default export shape
// ---------------------------------------------------------------------------

describe("tui module — default export shape", () => {
  it("default export has an `id` field (REQUIRED by TUI runtime per spike TQ-1)", () => {
    expect(tuiModule).toHaveProperty("id");
    expect(typeof tuiModule.id).toBe("string");
    expect(tuiModule.id.length).toBeGreaterThan(0);
  });

  it('id is exactly "bg-subagents-tui"', () => {
    expect(tuiModule.id).toBe("bg-subagents-tui");
  });

  it("default export has a `tui` function", () => {
    expect(tuiModule).toHaveProperty("tui");
    expect(typeof tuiModule.tui).toBe("function");
  });

  it("default export does NOT include a `server` field (TuiPluginModule contract)", () => {
    expect((tuiModule as Record<string, unknown>)["server"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Boot — resolves without throwing
// ---------------------------------------------------------------------------

describe("tui() — resolves without error", () => {
  it("resolves without throwing when SharedPluginState is set", async () => {
    const state = makeSharedState();
    registerFromServer(state);

    const api = makeApi();
    const meta = makeMeta();

    await expect(
      tuiModule.tui(api as never, undefined, meta as never),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when SharedPluginState is NOT set (graceful)", async () => {
    // clearSharedState() already called in beforeEach — current() returns undefined
    const api = makeApi();
    const meta = makeMeta();

    await expect(
      tuiModule.tui(api as never, undefined, meta as never),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing with options=undefined and options={}", async () => {
    const api = makeApi();
    const meta = makeMeta();

    await expect(
      tuiModule.tui(api as never, undefined, meta as never),
    ).resolves.toBeUndefined();

    const api2 = makeApi();
    await expect(
      tuiModule.tui(api2 as never, {} as never, meta as never),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. api.slots.register — called once with correct shape
// ---------------------------------------------------------------------------

describe("tui() — slots.register", () => {
  it("calls api.slots.register exactly once", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    expect(api.slots.register).toHaveBeenCalledTimes(1);
  });

  it("registers a slot plugin with a sidebar_content slot function", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [slotPlugin] = api.slots.register.mock.calls[0] as [MockSlotPlugin];

    // Must have a slots map
    expect(slotPlugin).toHaveProperty("slots");
    expect(typeof slotPlugin.slots).toBe("object");
    expect(slotPlugin.slots).not.toBeNull();

    // Must contain sidebar_content
    expect("sidebar_content" in slotPlugin.slots).toBe(true);
    expect(typeof slotPlugin.slots["sidebar_content"]).toBe("function");
  });

  it("registered slot plugin does NOT have an `id` field (TuiSlotPlugin contract)", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [slotPlugin] = api.slots.register.mock.calls[0] as [
      MockSlotPlugin & { id?: unknown }
    ];
    expect(slotPlugin.id).toBeUndefined();
  });

  it("sidebar_content slot render fn is callable and returns a value", async () => {
    const api = makeApi();
    registerFromServer(makeSharedState());

    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [slotPlugin] = api.slots.register.mock.calls[0] as [MockSlotPlugin];
    const renderFn = slotPlugin.slots["sidebar_content"]!;

    expect(() => renderFn({ session_id: "test-session-123" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. api.lifecycle.onDispose — called once for cleanup
// ---------------------------------------------------------------------------

describe("tui() — lifecycle.onDispose", () => {
  it("calls api.lifecycle.onDispose exactly once", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    expect(api.lifecycle.onDispose).toHaveBeenCalledTimes(1);
  });

  it("onDispose handler is a function", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [disposeFn] = api.lifecycle.onDispose.mock.calls[0] as [() => void];
    expect(typeof disposeFn).toBe("function");
  });

  it("calling the dispose handler does not throw", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [disposeFn] = api.lifecycle.onDispose.mock.calls[0] as [() => void];
    expect(() => disposeFn()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. SharedPluginState undefined at boot — graceful, no throw
// ---------------------------------------------------------------------------

describe("tui() — graceful when SharedPluginState undefined at boot", () => {
  it("does NOT throw when current() returns undefined", async () => {
    // current() is undefined (clearSharedState in beforeEach)
    const api = makeApi();

    await expect(
      tuiModule.tui(api as never, undefined, makeMeta() as never),
    ).resolves.toBeUndefined();
  });

  it("still registers sidebar slot even when SharedPluginState is undefined", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    // Slot must still be registered even without shared state
    expect(api.slots.register).toHaveBeenCalledTimes(1);
  });

  it("sidebar slot render returns empty task list when SharedPluginState is undefined", async () => {
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [slotPlugin] = api.slots.register.mock.calls[0] as [MockSlotPlugin];
    const renderFn = slotPlugin.slots["sidebar_content"]!;
    const result = renderFn({ session_id: "sess" }) as { tasks: unknown[] };

    // Should return a data object with an empty tasks array
    expect(result).toHaveProperty("tasks");
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(result.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. SharedPluginState set — sidebar render reads registry
// ---------------------------------------------------------------------------

describe("tui() — reads registry when SharedPluginState is set", () => {
  it("sidebar render returns task data from the registry", async () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    // Spawn a running task
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);

    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    const [slotPlugin] = api.slots.register.mock.calls[0] as [MockSlotPlugin];
    const renderFn = slotPlugin.slots["sidebar_content"]!;
    const result = renderFn({ session_id: "sess" }) as { tasks: unknown[] };

    expect(result.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Zero stdout assertion
// ---------------------------------------------------------------------------

describe("tui() — zero stdout pollution", () => {
  it("boot with shared state produces ZERO bytes on stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    registerFromServer(makeSharedState());
    const api = makeApi();

    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("boot without shared state produces ZERO bytes on stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    // current() returns undefined — graceful path
    const api = makeApi();
    await tuiModule.tui(api as never, undefined, makeMeta() as never);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
