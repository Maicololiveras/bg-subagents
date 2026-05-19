import { describe, expect, it } from "vitest";

import type { ActiveTask } from "./events.js";
import { projectTaskActionAvailability, projectTaskStatus } from "./activity-projection.js";

const baseTask: ActiveTask = {
  childSessionID: "task-1",
  parentSessionID: "parent-1",
  agent: "sdd-apply",
  started: 1_000,
  updatedAt: 2_000,
  status: "running",
  mode: "FG",
};

describe("control-tui activity projection", () => {
  it("projects stale using updatedAt fallback order", () => {
    expect(projectTaskStatus(baseTask, 610_000, { staleAfterMs: 10 * 60 * 1000 })).toBe("stale");
    expect(projectTaskStatus({ ...baseTask, updatedAt: undefined, started: 30_000 }, 630_500, { staleAfterMs: 10 * 60 * 1000 })).toBe("stale");
  });

  it("keeps terminal evidence over stale age", () => {
    expect(projectTaskStatus({ ...baseTask, status: "done", updatedAt: 1_000 }, 9_999_999)).toBe("done");
    expect(projectTaskStatus({ ...baseTask, status: "running", summary: "delivered", updatedAt: 1_000 }, 9_999_999)).toBe("done");
  });

  it("marks ambiguous replacement rows maybe-unknown", () => {
    expect(projectTaskStatus({ ...baseTask, mode: undefined, newChildSessionID: "replacement", status: "running" }, 5_000)).toBe("maybe-unknown");
  });

  it("disables side effects for stale but keeps inspect", () => {
    const actions = projectTaskActionAvailability({ ...baseTask, updatedAt: 1_000 });
    const map = Object.fromEntries(actions.map((item) => [item.action, item.enabled]));
    expect(map.inspect).toBe(true);
    expect(map.kill).toBe(false);
    expect(map.cancel).toBe(false);
    expect(map["move-to-BG"]).toBe(false);
    expect(map.dismiss).toBe(true);
  });
});
