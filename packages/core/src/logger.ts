/**
 * Namespace-based file-routing logger — zero-pollution constraint.
 *
 * Phase 7.5 hard constraint: ALL diagnostic output MUST route to the log file.
 * stdout is reserved exclusively for user-visible output (CLI commands, markdown
 * task cards via client.session.prompt). This logger NEVER writes to stdout.
 *
 * Default log path:
 *   POSIX:   ~/.opencode/logs/bg-subagents.log
 *   Windows: %APPDATA%\opencode\logs\bg-subagents.log
 *
 * Overrides:
 *   BG_SUBAGENTS_LOG_FILE  — explicit path override (highest priority)
 *   BG_SUBAGENTS_DEBUG     — when "true", also mirrors output to stderr
 *
 * debug() is a strict no-op unless BG_SUBAGENTS_DEBUG=true.
 * info()/warn()/error() always append to the log file (synchronously, so
 * each line is durable even in crash scenarios). Parent directory is created
 * via mkdirSync({ recursive: true }) on the first write attempt. If the file
 * open/write fails for any reason, the logger falls back to a single one-time
 * stderr warning and silently drops subsequent writes — it NEVER throws.
 *
 * Log line format: one JSON line per call, newline-terminated.
 * { "ts": "<ISO>", "level": "<level>", "ns": "<namespace>", "msg": "<msg>", ...meta }
 *
 * Backward-compat: `createLogger({})` (legacy obs-API call) maps to
 * `createLogger("")` — an empty-namespace file-routing logger. This allows
 * existing callers to migrate without immediate signature changes.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control tasks 7.5.1/7.5.2
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  /**
   * Compatible with the obs-layer `Logger.error` signature so that
   * `FileLogger` is structurally assignable to `Logger` for DI purposes.
   * The `errOrFields` parameter is ignored by this implementation — if an
   * Error is passed, only the `msg` and `meta` are logged (no stack serialisation).
   * Use obs-layer `createLogger` when Error serialisation is needed.
   */
  error(
    msg: string,
    errOrMeta?: Error | Record<string, unknown>,
    meta?: Record<string, unknown>,
  ): void;
  /**
   * Returns a child logger with the same namespace. Provided for structural
   * compatibility with the obs-layer `Logger` interface.
   */
  child(scope: Record<string, unknown>): FileLogger;
  /** No-op flush — file writes are synchronous so there is nothing to drain. */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveLogFilePath(): string {
  const envOverride = process.env["BG_SUBAGENTS_LOG_FILE"];
  if (typeof envOverride === "string" && envOverride.length > 0) {
    return envOverride;
  }

  const homeDir = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    const base =
      typeof appData === "string" && appData.length > 0 ? appData : homeDir;
    return path.join(base, "opencode", "logs", "bg-subagents.log");
  }

  return path.join(homeDir, ".opencode", "logs", "bg-subagents.log");
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/** One-time warning state — we only emit a file-error warning once per process. */
let _fileErrorWarned = false;

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function writeLogLine(filePath: string, line: string): void {
  try {
    ensureParentDir(filePath);
    fs.appendFileSync(filePath, line, "utf8");
  } catch (err) {
    if (!_fileErrorWarned) {
      _fileErrorWarned = true;
      try {
        process.stderr.write(
          `[bg-subagents] WARNING: log file write failed (${
            err instanceof Error ? err.message : String(err)
          }). Diagnostic output will be suppressed.\n`,
        );
      } catch {
        // Even stderr failed — truly silent from here.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a namespaced logger that writes to the bg-subagents log file.
 *
 * @param namespaceOrOpts - Namespace string (e.g. `"v14:boot"`) included in
 *   each log entry as the `ns` field. For backward compatibility, also accepts
 *   a `CreateLoggerOptions`-shaped object (legacy obs-API call pattern) — the
 *   namespace will be empty string in that case.
 */
export function createLogger(
  namespaceOrOpts: string | Record<string, unknown> = "",
): FileLogger {
  const namespace =
    typeof namespaceOrOpts === "string" ? namespaceOrOpts : "";

  const logPath = resolveLogFilePath();
  const debugEnabled = process.env["BG_SUBAGENTS_DEBUG"] === "true";

  function buildLine(
    level: string,
    msg: string,
    meta?: Record<string, unknown>,
  ): string {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg,
      ...(meta !== undefined ? meta : {}),
    };
    return `${JSON.stringify(entry)}\n`;
  }

  return {
    debug(msg: string, meta?: Record<string, unknown>): void {
      if (!debugEnabled) return; // strict no-op
      const line = buildLine("debug", msg, meta);
      // In debug mode: mirror to stderr (NOT stdout), also write to file.
      try {
        process.stderr.write(line);
      } catch {
        // ignore
      }
      writeLogLine(logPath, line);
    },

    info(msg: string, meta?: Record<string, unknown>): void {
      const line = buildLine("info", msg, meta);
      writeLogLine(logPath, line);
      if (debugEnabled) {
        try {
          process.stderr.write(line);
        } catch {
          // ignore
        }
      }
    },

    warn(msg: string, meta?: Record<string, unknown>): void {
      const line = buildLine("warn", msg, meta);
      writeLogLine(logPath, line);
      if (debugEnabled) {
        try {
          process.stderr.write(line);
        } catch {
          // ignore
        }
      }
    },

    error(
      msg: string,
      errOrMeta?: Error | Record<string, unknown>,
      meta?: Record<string, unknown>,
    ): void {
      // Merge fields: if errOrMeta is an Error, extract message for meta;
      // if it's a plain object, merge it; defer to meta as the primary fields.
      let merged: Record<string, unknown> | undefined;
      if (errOrMeta instanceof Error) {
        merged = {
          err: { name: errOrMeta.name, message: errOrMeta.message },
          ...(meta ?? {}),
        };
      } else if (errOrMeta !== undefined) {
        merged = { ...errOrMeta, ...(meta ?? {}) };
      } else {
        merged = meta;
      }
      const line = buildLine("error", msg, merged);
      writeLogLine(logPath, line);
      if (debugEnabled) {
        try {
          process.stderr.write(line);
        } catch {
          // ignore
        }
      }
    },

    child(_scope: Record<string, unknown>): FileLogger {
      // File-routing logger does not propagate child scopes — all entries share
      // the namespace set at construction. This method exists for structural
      // compatibility with the obs-layer Logger interface.
      return createLogger(namespace);
    },

    flush(): Promise<void> {
      // File writes are synchronous (appendFileSync) — nothing to drain.
      return Promise.resolve();
    },
  };
}
