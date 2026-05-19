import { describe, expect, it } from "vitest";

import {
  compactActivitySignal,
  normalizeActivityMode,
  normalizeActivityState,
  projectActions,
  projectAgentActivities,
  projectTranscriptSummary,
  type AgentActivityProjection,
  type AgentActivitySource,
} from "./activity-projection.js";

describe("activity-projection", () => {
  it("normalizes mode aliases", () => {
    const cases = [
      { input: "BG", expected: "background" },
      { input: "bg", expected: "background" },
      { input: "FG", expected: "foreground" },
      { input: "foreground", expected: "foreground" },
      { input: "other", expected: "unknown" },
      { input: undefined, expected: "unknown" },
    ] as const;

    for (const { input, expected } of cases) {
      expect(normalizeActivityMode(input)).toBe(expected);
    }
  });

  it("normalizes status aliases", () => {
    const cases = [
      { input: "done", expected: "completed" },
      { input: "success", expected: "completed" },
      { input: "failed", expected: "failed" },
      { input: "error", expected: "failed" },
      { input: "killed", expected: "cancelled" },
      { input: "pending", expected: "queued" },
      { input: "running", expected: "running" },
      { input: undefined, expected: "running" },
    ] as const;

    for (const { input, expected } of cases) {
      expect(normalizeActivityState(input)).toBe(expected);
    }
  });

  it("merges duplicate sources by task id", () => {
    const sources: AgentActivitySource[] = [
      { source: "host-event", id: "a", taskId: "t1", status: "running", latestSignal: "tool call" },
      { source: "core-task", id: "b", taskId: "t1", status: "completed", resultPreview: "done" },
      { source: "delivery", id: "c", taskId: "t2", status: "running" },
    ];

    const projected = projectAgentActivities(sources);
    expect(projected).toHaveLength(2);
    const t1 = projected.find((item) => item.id === "task:t1");
    expect(t1?.state).toBe("completed");
    expect(t1?.sourceIds).toEqual(["a", "b"]);
  });

  it("bounds and sanitizes signals", () => {
    const raw = JSON.stringify({ type: "message.part.updated", payload: "internal" });
    const safe = compactActivitySignal(raw);
    expect(safe).toContain("detail reference");

    const long = "x".repeat(400);
    expect(compactActivitySignal(long).length).toBeLessThanOrEqual(120);
  });

  it("creates transcript summaries only for non-running states", () => {
    const doneProjection = {
      id: "task:1",
      sourceIds: ["a"],
      mode: "background",
      state: "completed",
      blocking: false,
      agentName: "planner",
      title: "planner",
      subtitle: "completed",
      latestSignal: "finished ok",
      signals: [],
      detailRef: "task:1",
      actions: [],
      transcript: { activityId: "task:1", shouldEmit: false, text: "", reference: "task:1" },
    } satisfies AgentActivityProjection;
    const runningProjection = { ...doneProjection, state: "running", latestSignal: "still running" } satisfies AgentActivityProjection;
    const done = projectTranscriptSummary(doneProjection);
    const running = projectTranscriptSummary(runningProjection);

    expect(done.shouldEmit).toBe(true);
    expect(done.text).toContain("[planner] completed");
    expect(running.shouldEmit).toBe(false);
  });

  it("projects action matrix with policy-safe defaults", () => {
    const fgRunning = projectActions("running", "foreground", true);
    expect(fgRunning.find((action) => action.action === "move-to-BG")?.enabled).toBe(true);
    expect(fgRunning.find((action) => action.action === "kill")?.sideEffect).toBe(true);

    const completedBg = projectActions("completed", "background", false);
    expect(completedBg.find((action) => action.action === "kill")?.enabled).toBe(false);
    expect(completedBg.find((action) => action.action === "inspect")?.enabled).toBe(true);
  });
});
