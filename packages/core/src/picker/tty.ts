/**
 * Cross-platform TTY acquisition helper.
 *
 * Design §3.1 / Q2. Opens a dedicated terminal device (Unix `/dev/tty`,
 * Windows `CONIN$`/`CONOUT$`) so the picker can draw over piped stdio. Returns
 * `null` whenever we can't get a real terminal — callers must downgrade
 * gracefully (fallback to policy default, never throw up to the host hook).
 *
 * Ref-counted: concurrent `acquireTty()` calls reuse the same open fds; the
 * fds close only when the final reference is released. `forceFallback` is a
 * test hook + policy escape hatch that short-circuits without touching fs.
 */
import * as fs from "node:fs";
import { Readable, Writable } from "node:stream";

export interface TtyHandles {
  readonly input: Readable;
  readonly output: Writable;
  /** Drop one refcount; closes the underlying fds when refcount reaches 0. */
  release(): void;
}

export interface AcquireTtyOpts {
  /** Skip device open entirely. Returns null. */
  readonly forceFallback?: boolean;
}

interface SharedState {
  input: Readable;
  output: Writable;
  inputFd: number | null;
  outputFd: number | null;
  refcount: number;
}

let shared: SharedState | null = null;

function openDevice(): SharedState | null {
  try {
    if (process.platform === "win32") {
      // Windows: separate fds for input (CONIN$) and output (CONOUT$).
      const inFd = fs.openSync("\\\\.\\CONIN$", "r+");
      let outFd: number;
      try {
        outFd = fs.openSync("\\\\.\\CONOUT$", "w");
      } catch (err) {
        fs.closeSync(inFd);
        throw err;
      }
      const input = fs.createReadStream("", { fd: inFd, autoClose: false });
      const output = fs.createWriteStream("", { fd: outFd, autoClose: false });
      return { input, output, inputFd: inFd, outputFd: outFd, refcount: 1 };
    }

    // POSIX: single /dev/tty fd supports both read and write.
    const fd = fs.openSync("/dev/tty", "r+");
    const input = fs.createReadStream("", { fd, autoClose: false });
    const output = fs.createWriteStream("", { fd, autoClose: false });
    return { input, output, inputFd: fd, outputFd: fd, refcount: 1 };
  } catch (err) {
    console.warn(
      `[bg-subagents] acquireTty: failed to open terminal device: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

function makeHandles(): TtyHandles {
  return {
    input: shared!.input,
    output: shared!.output,
    release,
  };
}

function release(): void {
  if (shared === null) return;
  shared.refcount -= 1;
  if (shared.refcount > 0) return;

  const { inputFd, outputFd } = shared;
  try {
    if (inputFd !== null) fs.closeSync(inputFd);
  } catch {
    // Ignore — releasing a half-broken handle should never throw up.
  }
  try {
    if (outputFd !== null && outputFd !== inputFd) fs.closeSync(outputFd);
  } catch {
    // Ignore.
  }
  shared = null;
}

/**
 * Acquire a TTY for picker rendering. Returns `null` when no terminal is
 * available (stdin not a TTY, device open failed, `forceFallback` is set).
 */
export function acquireTty(opts: AcquireTtyOpts = {}): TtyHandles | null {
  if (opts.forceFallback === true) return null;

  // If stdin is not a TTY we cannot reasonably render anything interactive.
  if (process.stdin.isTTY !== true) return null;

  if (shared !== null) {
    shared.refcount += 1;
    return makeHandles();
  }

  const opened = openDevice();
  if (opened === null) return null;

  shared = opened;
  return makeHandles();
}

/**
 * Test-only helper: drop all state so unit tests can re-run the acquire path.
 * Not part of the public API — guarded via `__resetTtyForTests` to prevent
 * accidental use from host adapters.
 */
export function __resetTtyForTests(): void {
  if (shared !== null) {
    const { inputFd, outputFd } = shared;
    try {
      if (inputFd !== null) fs.closeSync(inputFd);
    } catch {
      // ignore
    }
    try {
      if (outputFd !== null && outputFd !== inputFd) fs.closeSync(outputFd);
    } catch {
      // ignore
    }
    shared = null;
  }
}
