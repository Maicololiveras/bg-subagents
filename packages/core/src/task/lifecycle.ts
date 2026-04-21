/**
 * Task lifecycle state machine.
 *
 * Source of truth for the status set is `@maicolextic/bg-subagents-protocol`'s
 * `TaskStatusSchema`. This module does NOT redefine those values — it only
 * defines which transitions are legal, which statuses are terminal, and the
 * typed error thrown on invalid transitions.
 *
 * Legal transitions mirror Batch 3 spec §1.b:
 *   running → { completed, killed, killed_on_disconnect, error, cancelled }
 *   passthrough → completed        // bookkeeping entries still end cleanly
 *   (terminal statuses have NO outgoing transitions)
 *
 * The machine does NOT encode spawn-time entry (the registry writes `running`
 * directly). Pre-run rejections (`cancelled`, `rejected_limit`) are written as
 * one-shot terminal transitions without an intermediate `running` step.
 */
import { type TaskId, type TaskStatus } from "@maicolextic/bg-subagents-protocol";

/** Terminal statuses — these emit a CompletionEvent and stop further transitions. */
export const TERMINAL_STATUSES = [
  "completed",
  "killed",
  "killed_on_disconnect",
  "error",
] as const;

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * Transition map. Every TaskStatus (from protocol's TaskStatusSchema) MUST
 * have an entry — the lifecycle parity test asserts this.
 */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> =
  Object.freeze({
    running: [
      "completed",
      "killed",
      "killed_on_disconnect",
      "error",
      "cancelled",
    ],
    passthrough: ["completed"],
    // Terminal entries have empty successor sets.
    completed: [],
    killed: [],
    killed_on_disconnect: [],
    error: [],
    cancelled: [],
    rejected_limit: [],
  });

/** True when `status` is one of the terminal statuses. */
export function isTerminal(status: TaskStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Check whether `from → to` is a legal transition. Pure. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Throw if `from → to` is not legal for the given task id. Always includes
 * the task id + code in the error so callers can log/trace without needing to
 * stitch context back together.
 */
export function assertTransition(
  from: TaskStatus,
  to: TaskStatus,
  task_id: TaskId,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError({ from, to, task_id });
  }
}

export interface InvalidTransitionContext {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly task_id: TaskId;
}

/** Thrown by `assertTransition` on illegal state machine moves. */
export class InvalidTransitionError extends Error {
  public readonly code = "TASK_INVALID_TRANSITION" as const;
  public readonly from: TaskStatus;
  public readonly to: TaskStatus;
  public readonly task_id: TaskId;

  constructor(ctx: InvalidTransitionContext) {
    super(
      `Invalid task transition for ${ctx.task_id}: ${ctx.from} → ${ctx.to}`,
    );
    this.name = "InvalidTransitionError";
    this.from = ctx.from;
    this.to = ctx.to;
    this.task_id = ctx.task_id;
  }
}
