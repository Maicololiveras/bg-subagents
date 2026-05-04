import type { ActiveTask } from "./events.js";
import type { Mode } from "./policy-writer.js";

export const AUTO_FLIP_ANTI_LOOP_WINDOW_MS = 30_000;

export interface AutoFlipDecision {
  readonly shouldFlip: boolean;
  readonly reason: "bg-policy" | "not-bg-policy" | "recently-flipped-parent";
  readonly msSinceLastFlip?: number;
}

export function shouldAutoFlipTask(
  task: ActiveTask,
  policies: Record<string, Mode>,
  recentlyFlippedParents: ReadonlyMap<string, number>,
  now = Date.now(),
  antiLoopWindowMs = AUTO_FLIP_ANTI_LOOP_WINDOW_MS,
): AutoFlipDecision {
  if (policies[task.agent] !== "bg") {
    return { shouldFlip: false, reason: "not-bg-policy" };
  }

  const parentID = task.parentSessionID;
  if (!parentID) return { shouldFlip: true, reason: "bg-policy" };

  const lastFlip = recentlyFlippedParents.get(parentID);
  if (lastFlip !== undefined) {
    const msSinceLastFlip = now - lastFlip;
    if (msSinceLastFlip < antiLoopWindowMs) {
      return { shouldFlip: false, reason: "recently-flipped-parent", msSinceLastFlip };
    }
  }

  return { shouldFlip: true, reason: "bg-policy" };
}

export function markAutoFlipParent(
  task: ActiveTask,
  recentlyFlippedParents: Map<string, number>,
  now = Date.now(),
): void {
  if (task.parentSessionID) recentlyFlippedParents.set(task.parentSessionID, now);
}
