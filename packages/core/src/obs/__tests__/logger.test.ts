/**
 * RED gate for `src/obs/logger.ts`.
 *
 * Structured JSON-lines logger with level filtering, child scopes, atomic
 * writes (queue-backed), env-var controls. No color, no console.* — writes to
 * a configurable Writable (default: process.stderr). NFR-11, NFR-9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";

import { createLogger, type LogSink } from "../logger.js";

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function collectSink(): {
  sink: LogSink;
  lines: () => string[];
  parsed: () => Array<Record<string, unknown>>;
} {
  const chunks: string[] = [];
  const sink: LogSink = {
    write(chunk: string): void {
      chunks.push(chunk);
    },
  };
  const lines = (): string[] =>
    chunks
      .join("")
      .split("\n")
      .filter((l) => l.length > 0);
  const parsed = (): Array<Record<string, unknown>> =>
    lines().map((l) => JSON.parse(l) as Record<string, unknown>);
  return { sink, lines, parsed };
}

const ENV_KEYS = ["BG_SUBAGENTS_LOG_LEVEL", "BG_SUBAGENTS_LOG_SILENT"] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    const v = snap[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("createLogger", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it("returns an object with debug/info/warn/error/child methods", () => {
    const { sink } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("filters by level: info drops debug but keeps info/warn/error", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "info", sink });
    logger.debug("should be dropped");
    logger.info("keep info");
    logger.warn("keep warn");
    logger.error("keep error");
    await logger.flush();
    const entries = parsed();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e["level"])).toEqual(["info", "warn", "error"]);
  });

  it("each emitted entry is a single JSON line with ts/level/msg", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    logger.info("hello", { extra: 42 });
    await logger.flush();
    const entries = parsed();
    expect(entries.length).toBe(1);
    const entry = entries[0] ?? {};
    expect(typeof entry["ts"]).toBe("number");
    expect(entry["level"]).toBe("info");
    expect(entry["msg"]).toBe("hello");
    expect(entry["extra"]).toBe(42);
  });

  it("child({ scope }) propagates scope to each message", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    const picker = logger.child({ scope: "picker" });
    picker.info("prompting");
    picker.warn("timed out");
    await logger.flush();
    const entries = parsed();
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e["scope"] === "picker")).toBe(true);
  });

  it("child fields merge with per-call fields; per-call wins on conflict", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    const scoped = logger.child({ scope: "task", task_id: "tsk_AAA" });
    scoped.info("ping", { task_id: "tsk_BBB" });
    await logger.flush();
    const entry = parsed()[0] ?? {};
    expect(entry["scope"]).toBe("task");
    expect(entry["task_id"]).toBe("tsk_BBB");
  });

  it("serialises concurrent .info() calls without interleaving within a line", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    const N = 100;
    for (let i = 0; i < N; i += 1) {
      logger.info(`m${i}`, { idx: i });
    }
    await logger.flush();
    const entries = parsed();
    expect(entries.length).toBe(N);
    for (let i = 0; i < N; i += 1) {
      expect(entries[i]?.["idx"]).toBe(i);
    }
  });

  it("logger.error(msg, err) serialises { name, message, stack, code }", async () => {
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    const err = new Error("boom");
    (err as unknown as { code: string }).code = "E_BOOM";
    logger.error("failed", err);
    await logger.flush();
    const entry = parsed()[0] ?? {};
    expect(entry["level"]).toBe("error");
    expect(entry["msg"]).toBe("failed");
    const serialised = entry["err"] as Record<string, unknown>;
    expect(serialised["name"]).toBe("Error");
    expect(serialised["message"]).toBe("boom");
    expect(typeof serialised["stack"]).toBe("string");
    expect(serialised["code"]).toBe("E_BOOM");
  });

  it("respects BG_SUBAGENTS_LOG_LEVEL env when level option omitted", async () => {
    process.env["BG_SUBAGENTS_LOG_LEVEL"] = "warn";
    const { sink, parsed } = collectSink();
    const logger = createLogger({ sink });
    logger.info("info-dropped");
    logger.warn("warn-kept");
    await logger.flush();
    const entries = parsed();
    expect(entries.length).toBe(1);
    expect(entries[0]?.["level"]).toBe("warn");
  });

  it("BG_SUBAGENTS_LOG_SILENT=1 suppresses all output", async () => {
    process.env["BG_SUBAGENTS_LOG_SILENT"] = "1";
    const { sink, parsed } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    logger.info("x");
    logger.error("y");
    await logger.flush();
    expect(parsed().length).toBe(0);
  });

  it("default sink is a process.stderr.write adapter (never console.*)", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleSpies = {
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    };

    const logger = createLogger({ level: "debug" });
    logger.info("default-sink");
    await logger.flush();

    expect(writeSpy).toHaveBeenCalled();
    expect(consoleSpies.log).not.toHaveBeenCalled();
    expect(consoleSpies.info).not.toHaveBeenCalled();
    expect(consoleSpies.error).not.toHaveBeenCalled();
    expect(consoleSpies.warn).not.toHaveBeenCalled();
  });

  it("no phoning home: logger performs no network / fetch calls (NFR-9)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch" as never)
      .mockImplementation((() => {
        throw new Error("fetch should never be called by logger");
      }) as never);

    const { sink } = collectSink();
    const logger = createLogger({ level: "debug", sink });
    logger.info("nothing over the wire");
    logger.error("still nothing", new Error("oops"));
    await logger.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a Writable-shape stream (node:stream Writable)", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _enc, cb): void {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ level: "debug", sink: stream });
    logger.info("to-stream");
    await logger.flush();
    const text = chunks.join("");
    expect(text.endsWith("\n")).toBe(true);
    const entry = JSON.parse(text.trim()) as Record<string, unknown>;
    expect(entry["msg"]).toBe("to-stream");
  });
});
