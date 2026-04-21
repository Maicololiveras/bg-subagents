/**
 * RED gate for `src/cli/format.ts`.
 *
 * Pure formatters used by the /task command surface. No ANSI color unless
 * explicitly requested + NO_COLOR env not set. No emojis (ASCII tags only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskStatus } from "@maicolextic/bg-subagents-protocol";

import type { TaskState } from "../../task/TaskRegistry.js";
import {
  formatDuration,
  formatError,
  formatStatus,
  formatTaskDetail,
  formatTaskLine,
  formatTaskListHeader,
} from "../format.js";

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  const base: TaskState = {
    id: "tsk_abc123def456" as TaskState["id"],
    status: "running",
    meta: { agent: "code-researcher" },
    started_at: Date.now() - 10_000,
    ...overrides,
  };
  return base;
}

const ENV_KEYS = ["NO_COLOR"] as const;
function clearColorEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    snap[k] = process.env[k];
    delete process.env[k];
  }
  return snap;
}
function restoreColorEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    const v = snap[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ANSI_RE = /\u001b\[[0-9;]*m/;

// -----------------------------------------------------------------------------
// formatTaskLine / formatTaskListHeader
// -----------------------------------------------------------------------------

describe("formatTaskLine", () => {
  it("renders fixed-width columns: id status duration agent", () => {
    const state = makeState({ started_at: Date.now() - 10_000 });
    const line = formatTaskLine(state, { color: false });
    expect(line).toContain("tsk_abc123def456");
    expect(line).toContain("running");
    expect(line).toContain("10s");
    expect(line).toContain("code-researcher");
  });

  it("truncates agent name at 30 chars with ellipsis", () => {
    const state = makeState({
      meta: { agent: "a-very-long-agent-name-that-exceeds-thirty-characters" },
    });
    const line = formatTaskLine(state, { color: false });
    // Character counting around an ellipsis — we accept the single-char "…"
    const ellipsisMatch = /\u2026/.exec(line);
    expect(ellipsisMatch).not.toBeNull();
  });

  it("renders without ANSI codes when color: false", () => {
    const state = makeState();
    const line = formatTaskLine(state, { color: false });
    expect(ANSI_RE.test(line)).toBe(false);
  });
});

describe("formatTaskListHeader", () => {
  it("renders a single header line with labels", () => {
    const header = formatTaskListHeader({ color: false });
    expect(header.split("\n").length).toBe(1);
    expect(header.toUpperCase()).toContain("ID");
    expect(header.toUpperCase()).toContain("STATUS");
    expect(header.toUpperCase()).toContain("DURATION");
    expect(header.toUpperCase()).toContain("AGENT");
  });
});

// -----------------------------------------------------------------------------
// formatTaskDetail
// -----------------------------------------------------------------------------

describe("formatTaskDetail", () => {
  it("renders multi-line key: value detail view for a task state", () => {
    const state = makeState({
      status: "completed",
      completed_at: Date.now(),
      result: "ok",
    });
    const detail = formatTaskDetail(state, { color: false });
    const lines = detail.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(detail).toContain("tsk_abc123def456");
    expect(detail).toContain("completed");
    expect(detail).toContain("code-researcher");
  });
});

// -----------------------------------------------------------------------------
// formatStatus — ANSI guarded by NO_COLOR + TTY
// -----------------------------------------------------------------------------

describe("formatStatus", () => {
  let colorSnap: Record<string, string | undefined>;
  beforeEach(() => {
    colorSnap = clearColorEnv();
  });
  afterEach(() => {
    restoreColorEnv(colorSnap);
  });

  it("uses ASCII tags, not emojis", () => {
    for (const status of ["running", "completed", "error", "killed"] as TaskStatus[]) {
      const out = formatStatus(status, { color: false });
      // Any character above U+FFFF (surrogate-pair emojis) is a rejection.
      for (const ch of [...out]) {
        expect(ch.codePointAt(0) ?? 0).toBeLessThan(0x2600);
      }
    }
  });

  it("honors NO_COLOR env — no ANSI even when color: true", () => {
    process.env["NO_COLOR"] = "1";
    const out = formatStatus("running", { color: true });
    expect(ANSI_RE.test(out)).toBe(false);
  });

  it("emits ANSI when color: true and NO_COLOR unset", () => {
    const out = formatStatus("running", { color: true });
    expect(ANSI_RE.test(out)).toBe(true);
  });

  it("color: false returns bare text even without NO_COLOR", () => {
    const out = formatStatus("completed", { color: false });
    expect(ANSI_RE.test(out)).toBe(false);
    expect(out).toContain("completed");
  });
});

// -----------------------------------------------------------------------------
// formatDuration
// -----------------------------------------------------------------------------

describe("formatDuration", () => {
  it("renders seconds as Ns", () => {
    expect(formatDuration(10_000)).toBe("10s");
    expect(formatDuration(1_000)).toBe("1s");
  });

  it("renders sub-second as 0s (no ms precision in table)", () => {
    expect(formatDuration(500)).toBe("0s");
  });

  it("renders minutes + seconds as NmNs", () => {
    expect(formatDuration(80_000)).toBe("1m20s");
  });

  it("renders hours + minutes as NhNm (seconds dropped)", () => {
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe("2h5m");
  });
});

// -----------------------------------------------------------------------------
// formatError
// -----------------------------------------------------------------------------

describe("formatError", () => {
  it("renders code + message + trimmed stack", () => {
    const err = new Error("boom");
    (err as unknown as { code: string }).code = "E_BOOM";
    const out = formatError(err, { color: false });
    expect(out).toContain("E_BOOM");
    expect(out).toContain("boom");
  });

  it("works without a code property (falls back to name)", () => {
    const err = new Error("bare");
    const out = formatError(err, { color: false });
    expect(out).toContain("Error");
    expect(out).toContain("bare");
  });
});
