import { describe, expect, it } from "vitest";

import {
  AUTO_FLIP_ANTI_LOOP_WINDOW_MS,
  markAutoFlipParent,
  shouldAutoFlipTask,
} from "./auto-flip.js";
import type { ActiveTask } from "./events.js";
import type { Mode } from "./policy-writer.js";

function task(overrides: Partial<ActiveTask> = {}): ActiveTask {
  return {
    childSessionID: "child-1",
    parentSessionID: "parent-1",
    agent: "sdd-explore",
    started: 1,
    status: "running",
    ...overrides,
  };
}

describe("control-tui auto-flip guard", () => {
  it("flips BG-policy agents and marks the parent before the respawn can cascade", () => {
    const policies: Record<string, Mode> = { "sdd-explore": "bg" };
    const recentlyFlippedParents = new Map<string, number>();
    const first = task({ childSessionID: "native-task-child" });

    expect(shouldAutoFlipTask(first, policies, recentlyFlippedParents, 1_000)).toEqual({
      shouldFlip: true,
      reason: "bg-policy",
    });

    markAutoFlipParent(first, recentlyFlippedParents, 1_000);

    const respawned = task({ childSessionID: "task-bg-child" });
    expect(
      shouldAutoFlipTask(respawned, policies, recentlyFlippedParents, 1_100),
    ).toEqual({
      shouldFlip: false,
      reason: "recently-flipped-parent",
      msSinceLastFlip: 100,
    });
  });

  it("keeps foreground-policy agents on native task", () => {
    const policies: Record<string, Mode> = { "sdd-apply": "fg" };

    expect(
      shouldAutoFlipTask(
        task({ agent: "sdd-apply" }),
        policies,
        new Map(),
        1_000,
      ),
    ).toEqual({ shouldFlip: false, reason: "not-bg-policy" });
  });

  it("allows another BG flip after the anti-loop window expires", () => {
    const policies: Record<string, Mode> = { "sdd-explore": "bg" };
    const recentlyFlippedParents = new Map<string, number>([["parent-1", 1_000]]);

    expect(
      shouldAutoFlipTask(
        task(),
        policies,
        recentlyFlippedParents,
        1_000 + AUTO_FLIP_ANTI_LOOP_WINDOW_MS,
      ),
    ).toEqual({ shouldFlip: true, reason: "bg-policy" });
  });
});
