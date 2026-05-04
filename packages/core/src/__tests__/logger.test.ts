/**
 * RED gate for `src/logger.ts` — namespace-based file-routing logger.
 *
 * Phase 7.5.1: Zero-pollution constraint.
 *
 * This logger satisfies the hard constraint that NO diagnostic output from
 * bg-subagents ever reaches process.stdout. Output routes to a log file
 * (default: ~/.opencode/logs/bg-subagents.log on POSIX,
 *  %APPDATA%\opencode\logs\bg-subagents.log on Windows).
 *
 * debug() is a strict no-op unless BG_SUBAGENTS_DEBUG=true.
 * info()/warn()/error() write JSON lines to the log file — never stdout, never
 * stderr in production mode.
 * BG_SUBAGENTS_LOG_FILE env var overrides the default log path.
 * Logger never throws — silently falls back to stderr-only on file open failure.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "BG_SUBAGENTS_DEBUG",
  "BG_SUBAGENTS_LOG_FILE",
] as const;

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLogger — shape", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-test-"));
    logFile = path.join(tmpDir, "test.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = logFile;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createLogger(namespace) returns { debug, info, warn, error }", () => {
    const logger = createLogger("test:ns");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});

describe("createLogger — debug no-op when BG_SUBAGENTS_DEBUG unset", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-test-"));
    logFile = path.join(tmpDir, "test.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = logFile;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("debug() is a strict no-op: zero stdout writes when BG_SUBAGENTS_DEBUG is unset", () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.debug("should be suppressed");

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("debug() is a strict no-op: zero file writes when BG_SUBAGENTS_DEBUG is unset", () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];

    const logger = createLogger("test:ns");
    logger.debug("should not reach file");

    // Wait for sync write
    const exists = fs.existsSync(logFile);
    if (exists) {
      const content = fs.readFileSync(logFile, "utf8");
      // If file exists, it must not contain debug entries
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const debugLines = lines.filter((l) => {
        try {
          const parsed = JSON.parse(l) as Record<string, unknown>;
          return parsed["level"] === "debug";
        } catch {
          return false;
        }
      });
      expect(debugLines).toHaveLength(0);
    }
    // Either file doesn't exist or has no debug lines — both acceptable.
  });
});

describe("createLogger — debug writes to stderr (not stdout) when BG_SUBAGENTS_DEBUG=true", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-test-"));
    logFile = path.join(tmpDir, "test.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = logFile;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("debug() writes to stderr NOT stdout when BG_SUBAGENTS_DEBUG=true", () => {
    process.env["BG_SUBAGENTS_DEBUG"] = "true";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.debug("debug message");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe("createLogger — info/warn/error write to log file, never stdout", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-test-"));
    logFile = path.join(tmpDir, "test.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = logFile;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("info() never writes to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.info("info message");

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("warn() never writes to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.warn("warn message");

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("error() never writes to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.error("error message");

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("info() never writes to stderr in production mode (BG_SUBAGENTS_DEBUG unset)", () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.info("production info");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("warn() never writes to stderr in production mode", () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.warn("production warn");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("error() never writes to stderr in production mode", () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("test:ns");
    logger.error("production error");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("info() writes a JSON line to the log file with correct fields", () => {
    const logger = createLogger("test:namespace");
    logger.info("hello from info", { custom_field: 42 });

    // Logger writes synchronously (appendFileSync)
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry["level"]).toBe("info");
    expect(entry["msg"]).toBe("hello from info");
    expect(entry["ns"]).toBe("test:namespace");
    expect(entry["custom_field"]).toBe(42);
    expect(typeof entry["ts"]).toBe("string"); // ISO timestamp
  });

  it("error() writes a JSON line to the log file", () => {
    const logger = createLogger("test:namespace");
    logger.error("something broke");

    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const errorLine = lines.find((l) => {
      try {
        return (JSON.parse(l) as Record<string, unknown>)["level"] === "error";
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
    const entry = JSON.parse(errorLine!) as Record<string, unknown>;
    expect(entry["msg"]).toBe("something broke");
  });

  it("warn() writes a JSON line to the log file", () => {
    const logger = createLogger("test:namespace");
    logger.warn("watch out");

    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const warnLine = lines.find((l) => {
      try {
        return (JSON.parse(l) as Record<string, unknown>)["level"] === "warn";
      } catch {
        return false;
      }
    });
    expect(warnLine).toBeDefined();
  });

  it("namespaced output includes [namespace] or ns field in log entry", () => {
    const logger = createLogger("v14:boot");
    logger.info("boot complete");

    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry["ns"]).toBe("v14:boot");
  });
});

describe("createLogger — BG_SUBAGENTS_LOG_FILE env override", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-override-"));
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("BG_SUBAGENTS_LOG_FILE overrides the default log path", () => {
    const customLog = path.join(tmpDir, "custom.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = customLog;

    const logger = createLogger("test:ns");
    logger.info("custom path test");

    expect(fs.existsSync(customLog)).toBe(true);
    const content = fs.readFileSync(customLog, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("createLogger — parent directory created if missing", () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-logger-mkdir-"));
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates parent directory recursively if it does not exist", () => {
    const nestedDir = path.join(tmpDir, "deeply", "nested", "dir");
    const logPath = path.join(nestedDir, "bg-subagents.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = logPath;

    const logger = createLogger("test:ns");
    logger.info("mkdir test");

    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(logPath)).toBe(true);
  });
});

describe("createLogger — never throws", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it("does not throw when log file parent dir creation fails (e.g., write to root)", () => {
    // On all platforms, writing to a path under a read-only system directory
    // without elevated privileges will fail. We test silent failure by using an
    // invalid path with a null byte — Node throws ENOENT/EINVAL on mkdirSync
    // for null bytes on all platforms.
    // We verify the logger swallows the error and does NOT throw.
    const invalidPath = path.join(os.tmpdir(), "bg-null\0path", "test.log");
    process.env["BG_SUBAGENTS_LOG_FILE"] = invalidPath;

    const logger = createLogger("test:ns");
    // Must not throw
    expect(() => logger.info("should not throw")).not.toThrow();
    expect(() => logger.warn("should not throw")).not.toThrow();
    expect(() => logger.error("should not throw")).not.toThrow();
  });
});
