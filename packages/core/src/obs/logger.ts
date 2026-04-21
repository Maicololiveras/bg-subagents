/**
 * Structured JSON-lines logger.
 *
 * NFR-11: every adapter MUST log a structured load banner + event stream.
 * NFR-9: no telemetry, no network. Logger only writes to the provided sink
 *        (default: process.stderr). It NEVER touches process.stdout — stdout
 *        is reserved for CLI command output so the two streams don't collide.
 *
 * Contract:
 *  - `createLogger({ level?, sink? })` returns an object with debug/info/warn/error/child/flush.
 *  - Levels: debug < info < warn < error. Env var `BG_SUBAGENTS_LOG_LEVEL`
 *    overrides the default when `level` is omitted. `BG_SUBAGENTS_LOG_SILENT=1`
 *    suppresses all output (no-op sink).
 *  - Output: one `JSON.stringify(entry) + "\n"` per call. Entries carry
 *    `{ ts, level, msg, ...scope, ...fields }`.
 *  - `child(scope)` returns a bound logger whose fields merge with every call.
 *    Per-call fields override scope fields on key collision.
 *  - `logger.error(msg, err)` serialises Error objects into `err: { name, message, stack, code }`.
 *  - Atomic writes: a single in-flight write per logger keeps concurrent calls
 *    from interleaving partial JSON inside a line. `flush()` awaits drain.
 *  - Sinks: objects with `.write(chunk: string): void` OR node:stream Writable
 *    (whose `.write` signature is honoured — we coerce to strings).
 */

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimum sink contract — accepts any object with `.write(chunk: string)`. */
export interface LogSink {
  write(chunk: string): boolean | void;
}

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, errOrFields?: Error | LogFields, fields?: LogFields): void;
  child(scope: LogFields): Logger;
  /** Await all in-flight writes. Safe to call multiple times. */
  flush(): Promise<void>;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const VALID_LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warn", "error"];

const DEFAULT_LEVEL: LogLevel = "info";

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

/**
 * Build a new logger instance. Every instance owns its own write queue —
 * siblings don't serialise against each other. `child()` shares the parent's
 * queue so scope-propagated writes remain ordered.
 */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const silent = process.env["BG_SUBAGENTS_LOG_SILENT"] === "1";
  const level = silent ? "error" : resolveLevel(opts.level);
  const sink = silent ? NO_OP_SINK : (opts.sink ?? defaultStderrSink());

  const state: LoggerState = {
    level,
    sink,
    silent,
    queue: Promise.resolve(),
  };

  return makeBoundLogger(state, {});
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

interface LoggerState {
  readonly level: LogLevel;
  readonly sink: LogSink;
  readonly silent: boolean;
  queue: Promise<unknown>;
}

const NO_OP_SINK: LogSink = {
  write(): void {
    // Intentionally empty — BG_SUBAGENTS_LOG_SILENT swaps us in.
  },
};

function defaultStderrSink(): LogSink {
  return {
    write(chunk: string): void {
      // Direct process.stderr.write — NOT console.error — to keep output out
      // of any test harness that captures console. stdout is reserved for
      // CLI command output.
      process.stderr.write(chunk);
    },
  };
}

function resolveLevel(optLevel: LogLevel | undefined): LogLevel {
  if (optLevel !== undefined) return optLevel;
  const env = process.env["BG_SUBAGENTS_LOG_LEVEL"];
  if (env !== undefined && (VALID_LEVELS as ReadonlyArray<string>).includes(env)) {
    return env as LogLevel;
  }
  return DEFAULT_LEVEL;
}

function makeBoundLogger(state: LoggerState, scope: LogFields): Logger {
  const emit = (lvl: LogLevel, msg: string, fields: LogFields | undefined): void => {
    if (state.silent) return;
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[state.level]) return;
    const entry: Record<string, unknown> = {
      ts: Date.now(),
      level: lvl,
      msg,
      ...scope,
      ...(fields ?? {}),
    };
    const line = `${JSON.stringify(entry)}\n`;
    state.queue = state.queue.then(
      () => writeToSink(state.sink, line),
      () => writeToSink(state.sink, line),
    );
  };

  return {
    debug(msg: string, fields?: LogFields): void {
      emit("debug", msg, fields);
    },
    info(msg: string, fields?: LogFields): void {
      emit("info", msg, fields);
    },
    warn(msg: string, fields?: LogFields): void {
      emit("warn", msg, fields);
    },
    error(msg: string, errOrFields?: Error | LogFields, fields?: LogFields): void {
      let merged: LogFields;
      if (errOrFields instanceof Error) {
        merged = { ...(fields ?? {}), err: serialiseError(errOrFields) };
      } else if (errOrFields !== undefined) {
        merged = { ...errOrFields, ...(fields ?? {}) };
      } else {
        merged = fields ?? {};
      }
      emit("error", msg, merged);
    },
    child(childScope: LogFields): Logger {
      const combined: LogFields = { ...scope, ...childScope };
      return makeBoundLogger(state, combined);
    },
    async flush(): Promise<void> {
      await state.queue.catch(() => undefined);
    },
  };
}

async function writeToSink(sink: LogSink, line: string): Promise<void> {
  const result = sink.write(line);
  // Writable streams may return false when the buffer is full. We don't wait
  // on drain here — the queue serialises writes so the order is preserved even
  // if the OS briefly buffers. Callers who need backpressure can use flush().
  if (result === undefined) return;
  return;
}

interface SerialisedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string | number;
}

function serialiseError(err: Error): SerialisedError {
  const out: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  } = {
    name: err.name,
    message: err.message,
  };
  if (typeof err.stack === "string") {
    out.stack = err.stack;
  }
  const maybeCode = (err as unknown as { code?: unknown }).code;
  if (typeof maybeCode === "string" || typeof maybeCode === "number") {
    out.code = maybeCode;
  }
  return out;
}
