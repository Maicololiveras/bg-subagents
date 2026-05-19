import { describe, expect, it } from "vitest";

import type { ActiveTask } from "./events.js";
import { projectTaskActivityVms } from "./activity-projection.js";
import {
  formatTaskCardLines,
  formatTaskDetailRows,
  shortTaskId,
  taskLatestSignal,
  truncateForUi,
} from "./task-ui.js";

const baseTask: ActiveTask = {
  childSessionID: "child-session-123456789",
  parentSessionID: "parent-1",
  agent: "sdd-apply",
  started: 1_000,
  status: "running",
  mode: "BG",
  latestEvent: "reading files",
  detailRef: "child session/logs: child-session-123456789",
};

describe("control-tui task UI labels", () => {
  it("projects FG and BG tasks into the same activity VM contract", () => {
    const fgTask: ActiveTask = {
      ...baseTask,
      childSessionID: "fg-1",
      mode: "FG",
      status: "running",
      latestEvent: "blocking",
    };
    const bgTask: ActiveTask = {
      ...baseTask,
      childSessionID: "bg-1",
      mode: "BG",
      status: "running",
      latestEvent: "background",
    };

    const [fgVm, bgVm] = projectTaskActivityVms([fgTask, bgTask], 66_000);
    expect(fgVm?.box.badge).toBe("FG");
    expect(fgVm?.box.blocking).toBe(true);
    expect(bgVm?.box.badge).toBe("BG");
    expect(bgVm?.box.blocking).toBe(false);
    expect(fgVm?.detail.rows.some((row) => row.label === "Mode")).toBe(true);
    expect(bgVm?.detail.rows.some((row) => row.label === "Mode")).toBe(true);
  });

  it("formats stable Windows-safe task card lines", () => {
    expect(formatTaskCardLines(baseTask, 66_000)).toEqual({
      header: "RUN sdd-apply | BG | 1m05",
      meta: "#child-se | running",
      latest: "reading files",
    });
  });

  it("shows a foreground running task in both card and detail state", () => {
    const fgTask: ActiveTask = {
      ...baseTask,
      mode: "FG",
      childSessionID: "fg-child-123456789",
      status: "running",
      latestEvent: "planning implementation",
      detailRef: "child session/logs: fg-child-123456789",
    };

    expect(formatTaskCardLines(fgTask, 66_000)).toEqual({
      header: "RUN sdd-apply | FG | 1m05",
      meta: "#fg-child | running",
      latest: "planning implementation",
    });

    const rows = formatTaskDetailRows(fgTask, 66_000);
    expect(rows[0]).toEqual({
      title: "Task: fg-child-123456789",
      description: "Agent sdd-apply | FG | running | 1m05",
    });
    expect(rows.find((row) => row.title === "Logs / history reference")?.description)
      .toBe("child session/logs: fg-child-123456789");
  });

  it("prefers the replacement child id for moved BG tasks", () => {
    expect(shortTaskId({ ...baseTask, newChildSessionID: "bg-child-987654321" })).toBe("bg-child");
  });

  it("uses ASCII truncation and fallback text", () => {
    expect(truncateForUi(undefined, 20)).toBe("-");
    expect(truncateForUi(`line 1\n${"x".repeat(120)}`, 32)).toBe("line 1 xxxxxxxxxxxxxxxxxxxxxx...");
  });

  it("keeps latest event compact for cards", () => {
    const latest = taskLatestSignal({ ...baseTask, latestEvent: `working ${"detail ".repeat(40)}` });

    expect(latest).toContain("working");
    expect(latest.length).toBeLessThanOrEqual(72);
    expect(latest.endsWith("...")).toBe(true);
  });

  it("formats detail rows without dumping full prompt or logs", () => {
    const rows = formatTaskDetailRows({
      ...baseTask,
      prompt: `Implement cards ${"details ".repeat(80)}`,
      progressEvents: ["session created", "reading", `raw ${"stdout ".repeat(80)}`],
      summary: `Completed ${"with detail ".repeat(40)}`,
    }, 11_000);

    expect(rows[0]).toEqual({
      title: "Task: child-session-123456789",
      description: "Agent sdd-apply | BG | running | 10s",
    });
    expect(rows.find((row) => row.title === "Prompt / description")?.description.length).toBeLessThanOrEqual(220);
    expect(rows.find((row) => row.title === "Recent events")?.description).toContain("session created | reading | raw stdout");
    expect(rows.find((row) => row.title === "Recent events")?.description).not.toContain("stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout stdout");
    expect(rows.find((row) => row.title === "Result preview")?.description.length).toBeLessThanOrEqual(160);
    expect(rows.find((row) => row.title === "Logs / history reference")?.description).toBe("child session/logs: child-session-123456789");
  });

  it("shows STALE marker and last-seen metadata", () => {
    const staleTask: ActiveTask = {
      ...baseTask,
      updatedAt: 1_000,
      started: 1_000,
      status: "running",
    };
    const card = formatTaskCardLines(staleTask, 700_000);
    expect(card.header.startsWith("STALE ")).toBe(true);
    expect(card.meta).toContain("stale");

    const rows = formatTaskDetailRows(staleTask, 700_000);
    expect(rows.find((row) => row.title === "Last seen")?.description).toBe("11m39 ago");
  });

  it("shows ? marker for maybe-unknown rows", () => {
    const unknownTask: ActiveTask = {
      ...baseTask,
      mode: undefined,
      newChildSessionID: "replacement-1",
      status: "running",
    };
    const card = formatTaskCardLines(unknownTask, 66_000);
    expect(card.header.startsWith("? ")).toBe(true);
    expect(card.meta).toContain("maybe-unknown");
  });

  it("labels errored task result previews honestly", () => {
    const rows = formatTaskDetailRows({
      ...baseTask,
      status: "error",
      errorMessage: "boom",
    });

    expect(rows.find((row) => row.title === "Error preview")?.description).toBe("boom");
  });

});
