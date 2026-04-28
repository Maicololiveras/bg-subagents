/**
 * Phase 12.1 RED — TUI plan-review-dialog unit tests.
 *
 * Covers:
 *   - createTuiPlanPicker(api) returns a PlanPicker object with pickPlan(batch)
 *   - pickPlan(batch) calls api.ui.dialog.replace exactly once per entry
 *   - render fn returns a JSX-like element whose onSelect handler accumulates decisions
 *   - pickPlan resolves with PolicyDecision[] matching simulated user selections
 *   - Cancel path: if onClose fires mid-cycle, pickPlan resolves with defaultDecisions fallback
 *   - Timeout path: no interaction within timeoutMs resolves with defaultDecisions fallback
 *   - Zero stdout assertion across all paths
 *
 * Design constraint: TUI DialogSelect is single-select. The picker cycles through entries
 * one at a time — dialog shows "Entry 1 of N — <agent_name>", on select moves to next entry.
 * api.ui.dialog.replace(render, onClose) is called once per entry.
 *
 * Coexistence: this picker is ADDITIVE on PolicyResolver (OQ-1 amendment, ADR-9).
 * PolicyResolver defaults are passed as defaultDecisions and used for cancel/timeout fallbacks.
 *
 * Spec: tasks.md Phase 12.1
 * Design: design.md ADR-9 + OQ-1 amendment
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTuiPlanPicker,
  type TuiPlanPickerOptions,
  type PlanPicker,
} from "../../tui-plugin/plan-review-dialog.js";
import type { BatchEntry, PolicyDecision } from "../../plan-review/types.js";

// ---------------------------------------------------------------------------
// Types — minimal mock shapes derived from tui.d.ts without importing from
// @opencode-ai/plugin (peer dep may not be resolvable at test time)
// ---------------------------------------------------------------------------

type MockDialogSelectOption = {
  title: string;
  value: unknown;
  description?: string;
  onSelect?: () => void;
};

type MockDialogSelectProps = {
  title: string;
  options: MockDialogSelectOption[];
  onSelect?: (option: MockDialogSelectOption) => void;
};

type MockJsxElement = MockDialogSelectProps & { __type: "DialogSelect" };

type MockDialogStack = {
  replace: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  size: "medium" | "large" | "xlarge";
  depth: number;
  open: boolean;
};

type MockTuiPluginApi = {
  ui: {
    DialogSelect: (props: MockDialogSelectProps) => MockJsxElement;
    dialog: MockDialogStack;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi(): MockTuiPluginApi {
  const dialog: MockDialogStack = {
    replace: vi.fn(),
    clear: vi.fn(),
    setSize: vi.fn(),
    size: "medium",
    depth: 0,
    open: false,
  };

  const DialogSelect = vi.fn(
    (props: MockDialogSelectProps): MockJsxElement => ({
      __type: "DialogSelect",
      ...props,
    }),
  );

  return {
    ui: {
      DialogSelect: DialogSelect as unknown as (
        props: MockDialogSelectProps,
      ) => MockJsxElement,
      dialog,
    },
  };
}

function makeBatch(count = 3): BatchEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    call_id: `call_${i}`,
    agent_name: `agent-${i}`,
    prompt: `prompt ${i}`,
    original_part_index: i,
  }));
}

function makeDefaults(batch: BatchEntry[]): PolicyDecision[] {
  return batch.map((e) => ({
    call_id: e.call_id,
    agent_name: e.agent_name,
    mode: "background" as const,
  }));
}

/**
 * Simulate user selecting an option for entry at index `entryIdx`.
 * Extracts the render fn registered via dialog.replace for that call,
 * renders it to get the DialogSelect element, and calls onSelect on the
 * option whose value.mode === targetMode (or the first option if not found).
 */
function simulateSelect(
  dialogReplaceMock: ReturnType<typeof vi.fn>,
  callIndex: number,
  targetMode: "background" | "foreground",
): void {
  const [renderFn] = dialogReplaceMock.mock.calls[callIndex] as [
    () => MockJsxElement,
    () => void,
  ];
  const element = renderFn();
  const option = element.options.find(
    (o) => (o.value as { mode: string }).mode === targetMode,
  );
  if (!option) throw new Error(`No option found for mode=${targetMode}`);
  option.onSelect?.();
}

/**
 * Simulate the user pressing Escape (triggers the onClose callback).
 */
function simulateEscape(
  dialogReplaceMock: ReturnType<typeof vi.fn>,
  callIndex: number,
): void {
  const [, onCloseFn] = dialogReplaceMock.mock.calls[callIndex] as [
    () => MockJsxElement,
    () => void,
  ];
  onCloseFn?.();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  delete process.env["BG_SUBAGENTS_DEBUG"];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Factory
// ---------------------------------------------------------------------------

describe("createTuiPlanPicker", () => {
  it("returns an object with a pickPlan method", () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);

    expect(picker).toBeDefined();
    expect(typeof picker.pickPlan).toBe("function");
  });

  it("returns a different picker instance on each call", () => {
    const api = makeApi();
    const p1 = createTuiPlanPicker(api as never);
    const p2 = createTuiPlanPicker(api as never);

    expect(p1).not.toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// 2. pickPlan — dialog.replace called once per entry
// ---------------------------------------------------------------------------

describe("pickPlan — dialog.replace call count", () => {
  it("with 3 entries: calls dialog.replace exactly 3 times after all selections", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(3);

    const promise = picker.pickPlan(batch);

    // Simulate user selecting BG for each of the 3 entries sequentially
    simulateSelect(api.ui.dialog.replace, 0, "background");
    simulateSelect(api.ui.dialog.replace, 1, "foreground");
    simulateSelect(api.ui.dialog.replace, 2, "background");

    await promise;

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(3);
  });

  it("with 1 entry: calls dialog.replace exactly 1 time", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(1);

    const promise = picker.pickPlan(batch);
    simulateSelect(api.ui.dialog.replace, 0, "background");

    await promise;

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. pickPlan — dialog options shape per entry
// ---------------------------------------------------------------------------

describe("pickPlan — DialogSelect element shape", () => {
  it("each rendered element contains BG and FG options (2 options per entry)", () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(3);

    // Start picking — do NOT await yet (no selections made)
    picker.pickPlan(batch);

    // Check entry 0 render fn
    const [renderFn0] = api.ui.dialog.replace.mock.calls[0] as [
      () => MockJsxElement,
    ];
    const element0 = renderFn0();

    expect(element0.options).toHaveLength(2);

    const modes = element0.options.map(
      (o) => (o.value as { mode: string }).mode,
    );
    expect(modes).toContain("background");
    expect(modes).toContain("foreground");
  });

  it("dialog title contains entry index (1-based) and total count", () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(3);

    picker.pickPlan(batch);

    const [renderFn0] = api.ui.dialog.replace.mock.calls[0] as [
      () => MockJsxElement,
    ];
    const element0 = renderFn0();

    // Title must reference "1" (current) and "3" (total), e.g. "1 of 3"
    expect(element0.title).toMatch(/1/);
    expect(element0.title).toMatch(/3/);
  });

  it("dialog title contains the agent_name for the current entry", () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    picker.pickPlan(batch);

    const [renderFn0] = api.ui.dialog.replace.mock.calls[0] as [
      () => MockJsxElement,
    ];
    const element0 = renderFn0();

    expect(element0.title).toContain("agent-0");
  });
});

// ---------------------------------------------------------------------------
// 4. pickPlan — resolves with accumulated PolicyDecision[]
// ---------------------------------------------------------------------------

describe("pickPlan — resolved decisions", () => {
  it("resolves with decisions matching user selections (mixed BG/FG)", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(3);

    const promise = picker.pickPlan(batch);

    simulateSelect(api.ui.dialog.replace, 0, "background");
    simulateSelect(api.ui.dialog.replace, 1, "foreground");
    simulateSelect(api.ui.dialog.replace, 2, "background");

    const result = await promise;

    expect(result.cancelled).toBe(false);
    expect(result.decisions).toHaveLength(3);
    expect(result.decisions[0]).toEqual({
      call_id: "call_0",
      agent_name: "agent-0",
      mode: "background",
    });
    expect(result.decisions[1]).toEqual({
      call_id: "call_1",
      agent_name: "agent-1",
      mode: "foreground",
    });
    expect(result.decisions[2]).toEqual({
      call_id: "call_2",
      agent_name: "agent-2",
      mode: "background",
    });
  });

  it("resolves with all-foreground decisions when user picks FG for each", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);

    simulateSelect(api.ui.dialog.replace, 0, "foreground");
    simulateSelect(api.ui.dialog.replace, 1, "foreground");

    const result = await promise;

    expect(result.cancelled).toBe(false);
    expect(result.decisions.every((d) => d.mode === "foreground")).toBe(true);
  });

  it("resolved decisions carry correct call_id and agent_name", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch: BatchEntry[] = [
      { call_id: "abc", agent_name: "sdd-explore", prompt: "p", original_part_index: 0 },
    ];

    const promise = picker.pickPlan(batch);
    simulateSelect(api.ui.dialog.replace, 0, "background");

    const result = await promise;
    expect(result.decisions[0]?.call_id).toBe("abc");
    expect(result.decisions[0]?.agent_name).toBe("sdd-explore");
  });
});

// ---------------------------------------------------------------------------
// 5. Cancel path — onClose fires mid-cycle
// ---------------------------------------------------------------------------

describe("pickPlan — cancel / Esc path", () => {
  it("if Esc pressed on first entry, resolves with defaultDecisions", async () => {
    const api = makeApi();
    const defaults = makeDefaults(makeBatch(3));
    const picker = createTuiPlanPicker(api as never, { defaultDecisions: defaults });
    const batch = makeBatch(3);

    const promise = picker.pickPlan(batch);
    simulateEscape(api.ui.dialog.replace, 0);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.decisions).toEqual(defaults);
  });

  it("if Esc pressed after 1 selection, resolves with defaultDecisions (not partial)", async () => {
    const api = makeApi();
    const defaults = makeDefaults(makeBatch(3));
    const picker = createTuiPlanPicker(api as never, { defaultDecisions: defaults });
    const batch = makeBatch(3);

    const promise = picker.pickPlan(batch);

    // Select entry 0, then cancel on entry 1
    simulateSelect(api.ui.dialog.replace, 0, "background");
    simulateEscape(api.ui.dialog.replace, 1);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.decisions).toEqual(defaults);
  });

  it("if no defaultDecisions provided, cancel resolves with empty decisions array", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);
    simulateEscape(api.ui.dialog.replace, 0);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.decisions).toEqual([]);
  });

  it("cancel calls dialog.clear() to close the dialog", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);
    simulateEscape(api.ui.dialog.replace, 0);

    await promise;

    expect(api.ui.dialog.clear).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Timeout path
// ---------------------------------------------------------------------------

describe("pickPlan — timeout path", () => {
  it("resolves with defaultDecisions after timeoutMs if no interaction", async () => {
    vi.useFakeTimers();

    const api = makeApi();
    const defaults = makeDefaults(makeBatch(3));
    const picker = createTuiPlanPicker(api as never, {
      timeoutMs: 1000,
      defaultDecisions: defaults,
    });
    const batch = makeBatch(3);

    const promise = picker.pickPlan(batch);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1001);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.decisions).toEqual(defaults);
  });

  it("timeout resolves with empty array if no defaultDecisions provided", async () => {
    vi.useFakeTimers();

    const api = makeApi();
    const picker = createTuiPlanPicker(api as never, { timeoutMs: 500 });
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);

    await vi.advanceTimersByTimeAsync(501);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.decisions).toEqual([]);
  });

  it("no timeout fires if all selections complete before timeoutMs", async () => {
    vi.useFakeTimers();

    const api = makeApi();
    const defaults = makeDefaults(makeBatch(2));
    const picker = createTuiPlanPicker(api as never, {
      timeoutMs: 5000,
      defaultDecisions: defaults,
    });
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);

    // Select both entries before timeout
    simulateSelect(api.ui.dialog.replace, 0, "background");
    simulateSelect(api.ui.dialog.replace, 1, "foreground");

    const result = await promise;

    expect(result.cancelled).toBe(false);
    expect(result.decisions[0]?.mode).toBe("background");
    expect(result.decisions[1]?.mode).toBe("foreground");

    // Advance past would-be timeout — promise already resolved, no double-resolve
    await vi.advanceTimersByTimeAsync(6000);
    // No assertion error means no second resolve
  });
});

// ---------------------------------------------------------------------------
// 7. Zero stdout assertion
// ---------------------------------------------------------------------------

describe("pickPlan — zero stdout pollution", () => {
  it("complete happy-path produces ZERO bytes on stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);
    simulateSelect(api.ui.dialog.replace, 0, "background");
    simulateSelect(api.ui.dialog.replace, 1, "background");

    await promise;

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("cancel path produces ZERO bytes on stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);
    simulateEscape(api.ui.dialog.replace, 0);

    await promise;

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("timeout path produces ZERO bytes on stdout", async () => {
    vi.useFakeTimers();

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const api = makeApi();
    const picker = createTuiPlanPicker(api as never, { timeoutMs: 100 });
    const batch = makeBatch(2);

    const promise = picker.pickPlan(batch);
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Empty batch edge case
// ---------------------------------------------------------------------------

describe("pickPlan — edge cases", () => {
  it("empty batch resolves immediately with empty decisions and no dialog calls", async () => {
    const api = makeApi();
    const picker = createTuiPlanPicker(api as never);

    const result = await picker.pickPlan([]);

    expect(result.cancelled).toBe(false);
    expect(result.decisions).toEqual([]);
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });
});
