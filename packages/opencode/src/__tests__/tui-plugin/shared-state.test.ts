/**
 * Phase 11.1 RED — SharedPluginState singleton tests.
 *
 * Covers:
 *   - registerFromServer(state) sets globalThis[Symbol.for(KEY)] to the state object
 *   - current() returns the registered state
 *   - current() returns undefined when nothing registered
 *   - clear() removes the registration; subsequent current() returns undefined
 *   - Calling registerFromServer twice replaces (last-write wins)
 *   - Another module importing the same file sees the SAME singleton (direct globalThis probe)
 *   - Zero stdout assertion (spy on process.stdout.write)
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 11.1
 * Design: design.md "SharedPluginState — Symbol.for globalThis pattern"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerFromServer,
  current,
  clear,
} from "../../tui-plugin/shared-state.js";
import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import type { TaskPolicyStore } from "../../host-compat/v14/slash-commands.js";
import { createTaskPolicyStore } from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHARED_SYMBOL_KEY = "@maicolextic/bg-subagents/shared";

function makeState() {
  const registry = new TaskRegistry();
  const policyStore = createTaskPolicyStore();
  return { registry, policyStore };
}

// ---------------------------------------------------------------------------
// Lifecycle helpers — ensure clean slate for each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clear();
  delete process.env["BG_SUBAGENTS_DEBUG"];
});

afterEach(() => {
  clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. registerFromServer sets globalThis
// ---------------------------------------------------------------------------

describe("registerFromServer", () => {
  it("sets globalThis[Symbol.for(KEY)] to the exact state object", () => {
    const state = makeState();
    registerFromServer(state);

    const stored = (globalThis as Record<symbol, unknown>)[
      Symbol.for(SHARED_SYMBOL_KEY)
    ];
    expect(stored).toBe(state);
  });

  it("last-write wins when called twice (replaces previous state)", () => {
    const state1 = makeState();
    const state2 = makeState();

    registerFromServer(state1);
    registerFromServer(state2);

    const stored = (globalThis as Record<symbol, unknown>)[
      Symbol.for(SHARED_SYMBOL_KEY)
    ];
    expect(stored).toBe(state2);
    expect(stored).not.toBe(state1);
  });
});

// ---------------------------------------------------------------------------
// 2. current() returns registered state
// ---------------------------------------------------------------------------

describe("current()", () => {
  it("returns undefined before any registration", () => {
    expect(current()).toBeUndefined();
  });

  it("returns the registered state after registerFromServer", () => {
    const state = makeState();
    registerFromServer(state);
    expect(current()).toBe(state);
  });

  it("returns the SAME registry and policyStore instances (same reference)", () => {
    const state = makeState();
    registerFromServer(state);

    const retrieved = current();
    expect(retrieved?.registry).toBe(state.registry);
    expect(retrieved?.policyStore).toBe(state.policyStore);
  });
});

// ---------------------------------------------------------------------------
// 3. clear() removes the registration
// ---------------------------------------------------------------------------

describe("clear()", () => {
  it("removes the state so current() returns undefined after clear()", () => {
    const state = makeState();
    registerFromServer(state);
    expect(current()).toBe(state);

    clear();
    expect(current()).toBeUndefined();
  });

  it("removes globalThis[Symbol.for(KEY)] so direct probe also returns undefined", () => {
    const state = makeState();
    registerFromServer(state);

    clear();

    const stored = (globalThis as Record<symbol, unknown>)[
      Symbol.for(SHARED_SYMBOL_KEY)
    ];
    expect(stored).toBeUndefined();
  });

  it("is safe to call clear() multiple times without throwing", () => {
    clear();
    clear();
    expect(current()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Direct globalThis probe — proves same singleton across module boundaries
// ---------------------------------------------------------------------------

describe("globalThis symbol — cross-module singleton contract", () => {
  it("direct globalThis access returns the same object as current()", () => {
    const state = makeState();
    registerFromServer(state);

    // A hypothetical "TUI plugin" would do exactly this:
    const direct = (globalThis as Record<symbol, unknown>)[
      Symbol.for(SHARED_SYMBOL_KEY)
    ];

    expect(direct).toBe(current());
    expect(direct).toBe(state);
  });

  it("mutations to registry are visible via both current() and direct probe (same reference)", () => {
    const state = makeState();
    registerFromServer(state);

    // Spawn a task on the registry held in SharedPluginState
    const handle = state.registry.spawn({
      meta: { mode: "bg" },
      run: (_signal) => Promise.resolve(),
    });
    // Suppress unhandled rejection
    handle.done.catch(() => undefined);

    // Both access paths see the same registry with the spawned task
    expect(current()?.registry.size()).toBe(1);
    const direct = (globalThis as Record<symbol, unknown>)[
      Symbol.for(SHARED_SYMBOL_KEY)
    ] as { registry: TaskRegistry } | undefined;
    expect(direct?.registry.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Zero stdout pollution
// ---------------------------------------------------------------------------

describe("SharedPluginState — zero stdout pollution", () => {
  it("registerFromServer produces ZERO bytes on stdout when BG_SUBAGENTS_DEBUG is unset", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const state = makeState();
    registerFromServer(state);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("current() produces ZERO bytes on stdout", () => {
    const state = makeState();
    registerFromServer(state);

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    current();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("clear() produces ZERO bytes on stdout", () => {
    const state = makeState();
    registerFromServer(state);

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    clear();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
