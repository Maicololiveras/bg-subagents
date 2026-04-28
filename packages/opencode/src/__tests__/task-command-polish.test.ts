/**
 * Batch 9 polish tests for /task command flag parsing + color helpers.
 *
 * Does NOT overwrite host-compat/legacy/task-command.test.ts — covers new flags only.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { HistoryStore, TaskRegistry } from "@maicolextic/bg-subagents-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseTaskCommand,
  handleTaskSlashCommand,
  parseSince,
} from "../host-compat/legacy/task-command.js";
import { makeColors, resolveColorsEnabled } from "../commands/colors.js";

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-polish-"));
}

function mkDeps(extraFormat?: { color?: boolean }) {
  const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
  const registry = new TaskRegistry({ history });
  const buf: string[] = [];
  const stdout = {
    write(chunk: string): void {
      buf.push(chunk);
    },
  };
  return { registry, history, stdout, buf, format: extraFormat };
}

// -----------------------------------------------------------------------------
// parseTaskCommand — new flags
// -----------------------------------------------------------------------------

describe("parseTaskCommand — new flags", () => {
  it("parses --agent=<name>", () => {
    const p = parseTaskCommand("list", ["--agent=my-bot"]);
    expect(p.flags.agent).toBe("my-bot");
    expect(p.errors).toHaveLength(0);
  });

  it("parses --since=1h (duration shorthand)", () => {
    const before = Date.now();
    const p = parseTaskCommand("list", ["--since=1h"]);
    const after = Date.now();
    expect(p.errors).toHaveLength(0);
    expect(p.flags.sinceMs).toBeTypeOf("number");
    // sinceMs should be ~1 hour ago
    const expected = before - 3_600_000;
    expect(p.flags.sinceMs).toBeGreaterThanOrEqual(expected - 500);
    expect(p.flags.sinceMs).toBeLessThanOrEqual(after);
  });

  it("parses --since=30m", () => {
    const p = parseTaskCommand("list", ["--since=30m"]);
    expect(p.errors).toHaveLength(0);
    expect(p.flags.sinceMs).toBeTypeOf("number");
  });

  it("parses --since=7d", () => {
    const p = parseTaskCommand("list", ["--since=7d"]);
    expect(p.errors).toHaveLength(0);
    expect(p.flags.sinceMs).toBeTypeOf("number");
  });

  it("parses --since=<ISO-8601>", () => {
    const iso = "2025-01-01T00:00:00.000Z";
    const p = parseTaskCommand("list", [`--since=${iso}`]);
    expect(p.errors).toHaveLength(0);
    expect(p.flags.sinceMs).toBe(new Date(iso).getTime());
  });

  it("parses --no-color", () => {
    const p = parseTaskCommand("list", ["--no-color"]);
    expect(p.flags.noColor).toBe(true);
    expect(p.errors).toHaveLength(0);
  });

  it("parses --tail=0 (zero is allowed)", () => {
    const p = parseTaskCommand("logs", ["tsk_abc", "--tail=0"]);
    expect(p.flags.tail).toBe(0);
    expect(p.errors).toHaveLength(0);
  });

  it("returns correct subcmd and empty errors with no flags", () => {
    const p = parseTaskCommand("list", []);
    expect(p.subcmd).toBe("list");
    expect(p.errors).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// parseTaskCommand — structured errors (no throw)
// -----------------------------------------------------------------------------

describe("parseTaskCommand — structured errors", () => {
  it("invalid --status=foo → error in ParseResult (not throw)", () => {
    expect(() => parseTaskCommand("list", ["--status=foo"])).not.toThrow();
    const p = parseTaskCommand("list", ["--status=foo"]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]?.flag).toBe("--status");
    expect(p.flags.status).toBeUndefined();
  });

  it("invalid --since=garbage → structured error", () => {
    expect(() => parseTaskCommand("list", ["--since=garbage"])).not.toThrow();
    const p = parseTaskCommand("list", ["--since=garbage"]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]?.flag).toBe("--since");
    expect(p.flags.sinceMs).toBeUndefined();
  });

  it("--tail=abc → structured error", () => {
    const p = parseTaskCommand("logs", ["tsk_x", "--tail=abc"]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]?.flag).toBe("--tail");
    expect(p.flags.tail).toBeUndefined();
  });

  it("--tail=-5 → structured error", () => {
    const p = parseTaskCommand("logs", ["tsk_x", "--tail=-5"]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]?.flag).toBe("--tail");
    expect(p.flags.tail).toBeUndefined();
  });

  it("multiple bad flags accumulate errors", () => {
    const p = parseTaskCommand("list", ["--status=bogus", "--since=???", "--tail=-1"]);
    expect(p.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// -----------------------------------------------------------------------------
// parseSince — unit tests
// -----------------------------------------------------------------------------

describe("parseSince", () => {
  it("returns ms for valid duration 60s", () => {
    const before = Date.now();
    const result = parseSince("60s");
    const after = Date.now();
    if ("error" in result) throw new Error("unexpected error");
    expect(result.ms).toBeGreaterThanOrEqual(before - 60_000 - 500);
    expect(result.ms).toBeLessThanOrEqual(after);
  });

  it("returns error for garbage input", () => {
    const result = parseSince("not-a-date");
    expect("error" in result).toBe(true);
  });

  it("parses ISO-8601 string", () => {
    const iso = "2024-06-01T12:00:00Z";
    const result = parseSince(iso);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.ms).toBe(new Date(iso).getTime());
  });
});

// -----------------------------------------------------------------------------
// colors.ts
// -----------------------------------------------------------------------------

describe("makeColors(false) — identity", () => {
  it("running returns input unchanged", () => {
    expect(makeColors(false).running("x")).toBe("x");
  });

  it("completed returns input unchanged", () => {
    expect(makeColors(false).completed("x")).toBe("x");
  });

  it("error returns input unchanged", () => {
    expect(makeColors(false).error("x")).toBe("x");
  });

  it("killed returns input unchanged", () => {
    expect(makeColors(false).killed("x")).toBe("x");
  });

  it("dim returns input unchanged", () => {
    expect(makeColors(false).dim("x")).toBe("x");
  });

  it("bold returns input unchanged", () => {
    expect(makeColors(false).bold("x")).toBe("x");
  });
});

describe("makeColors(true) — ANSI wrapping", () => {
  it("running includes yellow ANSI code", () => {
    expect(makeColors(true).running("x")).toContain("\x1b[33m");
  });

  it("completed includes green ANSI code", () => {
    expect(makeColors(true).completed("x")).toContain("\x1b[32m");
  });

  it("error includes red ANSI code", () => {
    expect(makeColors(true).error("x")).toContain("\x1b[31m");
  });

  it("killed includes magenta ANSI code", () => {
    expect(makeColors(true).killed("x")).toContain("\x1b[35m");
  });

  it("dim includes ANSI dim code", () => {
    expect(makeColors(true).dim("x")).toContain("\x1b[2m");
  });

  it("bold includes ANSI bold code", () => {
    expect(makeColors(true).bold("x")).toContain("\x1b[1m");
  });
});

// -----------------------------------------------------------------------------
// resolveColorsEnabled — TTY + FORCE_COLOR auto-detection
// -----------------------------------------------------------------------------

describe("resolveColorsEnabled", () => {
  it("non-TTY stream → colors disabled by default", () => {
    const stream = new PassThrough(); // isTTY is undefined → false
    expect(resolveColorsEnabled(stream, {})).toBe(false);
  });

  it("TTY stream → colors enabled", () => {
    const stream = { isTTY: true };
    expect(resolveColorsEnabled(stream, {})).toBe(true);
  });

  it("FORCE_COLOR=1 overrides non-TTY → colors enabled", () => {
    const stream = new PassThrough();
    expect(resolveColorsEnabled(stream, { FORCE_COLOR: "1" })).toBe(true);
  });

  it("NO_COLOR set → colors disabled even on TTY", () => {
    const stream = { isTTY: true };
    expect(resolveColorsEnabled(stream, { NO_COLOR: "1" })).toBe(false);
  });

  it("FORCE_COLOR=1 beats NO_COLOR (FORCE wins)", () => {
    const stream = { isTTY: true };
    expect(resolveColorsEnabled(stream, { FORCE_COLOR: "1", NO_COLOR: "1" })).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// --no-color propagates to format layer
// -----------------------------------------------------------------------------

describe("handleTaskSlashCommand — --no-color propagates to format layer", () => {
  it("--no-color causes listCommand to receive color: false", async () => {
    const { registry, history, stdout, buf } = mkDeps();

    // Spawn a task so list prints a table row, not "No tasks."
    await new Promise<void>((resolve) => {
      registry.spawn({ meta: { agent: "tester" }, run: async () => { resolve(); return "ok"; } });
    });
    // Give the task time to complete.
    await new Promise((r) => setTimeout(r, 50));

    // Call with color: true in format, but --no-color flag should override.
    const res = await handleTaskSlashCommand(
      "list",
      ["--no-color"],
      { registry, history, stdout, format: { color: true } },
    );
    expect(res.exit_code).toBe(0);

    const out = buf.join("");
    // With --no-color, no ANSI escape codes should appear in output.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("without --no-color and color:true, ANSI codes appear in output", async () => {
    const { registry, history, stdout, buf } = mkDeps();

    await new Promise<void>((resolve) => {
      registry.spawn({ meta: { agent: "tester" }, run: async () => { resolve(); return "ok"; } });
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await handleTaskSlashCommand(
      "list",
      [],
      { registry, history, stdout, format: { color: true } },
    );
    expect(res.exit_code).toBe(0);

    const out = buf.join("");
    // With color:true, ANSI codes should appear.
    expect(out).toMatch(/\x1b\[/);
  });
});
