/**
 * RED gate for `src/task/lifecycle.ts`.
 *
 * Covers Batch 3 spec §1.b — task status transitions are the contract the
 * registry, history store, and invokers all agree on. Source of truth for the
 * set of statuses is `@maicolextic/bg-subagents-protocol`'s `TaskStatusSchema`.
 */
import { describe, expect, it } from "vitest";
import {
  TaskStatusSchema,
  type TaskStatus,
  unsafeTaskId,
} from "@maicolextic/bg-subagents-protocol";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminal,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from "../lifecycle.js";

const TASK_ID = unsafeTaskId("tsk_TestTestTest");

describe("lifecycle / status set parity with protocol", () => {
  it("TRANSITIONS covers exactly the protocol TaskStatusSchema values", () => {
    const protocolStatuses = new Set(TaskStatusSchema.options);
    const localStatuses = new Set(Object.keys(TRANSITIONS));
    expect(localStatuses).toEqual(protocolStatuses);
  });

  it("TERMINAL_STATUSES is the exact set {completed, killed, killed_on_disconnect, error}", () => {
    expect(new Set(TERMINAL_STATUSES)).toEqual(
      new Set<TaskStatus>([
        "completed",
        "killed",
        "killed_on_disconnect",
        "error",
      ]),
    );
  });
});

describe("lifecycle / isTerminal", () => {
  it("returns true for all terminal statuses", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("returns false for running/pending/cancelled/passthrough/rejected_limit", () => {
    const nonTerminal: TaskStatus[] = [
      "running",
      "cancelled",
      "passthrough",
      "rejected_limit",
    ];
    for (const status of nonTerminal) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});

describe("lifecycle / canTransition — legal transitions", () => {
  const legal: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
    ["running", "completed"],
    ["running", "killed"],
    ["running", "killed_on_disconnect"],
    ["running", "error"],
    ["running", "cancelled"],
    ["passthrough", "completed"],
  ];

  for (const [from, to] of legal) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to, TASK_ID)).not.toThrow();
    });
  }
});

describe("lifecycle / canTransition — illegal transitions", () => {
  it("rejects terminal → anything", () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(canTransition(terminal, "running")).toBe(false);
      expect(canTransition(terminal, "completed")).toBe(false);
    }
  });

  it("rejects running → running (no self-loop)", () => {
    expect(canTransition("running", "running")).toBe(false);
  });

  it("rejects arbitrary invalid transitions", () => {
    expect(canTransition("cancelled", "completed")).toBe(false);
    expect(canTransition("rejected_limit", "running")).toBe(false);
    expect(canTransition("passthrough", "error")).toBe(false);
  });
});

describe("lifecycle / assertTransition + InvalidTransitionError", () => {
  it("throws InvalidTransitionError on illegal transition", () => {
    let caught: unknown;
    try {
      assertTransition("completed", "running", TASK_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidTransitionError);
    const err = caught as InvalidTransitionError;
    expect(err.from).toBe("completed");
    expect(err.to).toBe("running");
    expect(err.task_id).toBe(TASK_ID);
    expect(err.code).toBe("TASK_INVALID_TRANSITION");
    expect(err.message).toContain("completed");
    expect(err.message).toContain("running");
    expect(err.message).toContain(TASK_ID);
  });

  it("throws with the exact code literal", () => {
    try {
      assertTransition("running", "passthrough", TASK_ID);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as InvalidTransitionError).code).toBe(
        "TASK_INVALID_TRANSITION",
      );
    }
  });
});
