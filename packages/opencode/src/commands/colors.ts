/**
 * Zero-dep ANSI color helpers for the /task command surface.
 *
 * `makeColors(false)` → identity functions (no ANSI codes).
 * `makeColors(true)`  → wraps strings with ANSI escape codes.
 *
 * Auto-detection helper `resolveColorsEnabled` mirrors conventional CLI
 * behaviour: colors ON when stdout is a TTY, OFF otherwise, unless
 * FORCE_COLOR=1 overrides.
 *
 * NFR-11 / Batch 9 polish.
 */

// -----------------------------------------------------------------------------
// Public interface
// -----------------------------------------------------------------------------

export interface ColorFns {
  running: (s: string) => string;
  completed: (s: string) => string;
  error: (s: string) => string;
  killed: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

// -----------------------------------------------------------------------------
// ANSI codes
// -----------------------------------------------------------------------------

const RESET = "\x1b[0m";

function wrap(code: number): (s: string) => string {
  return (s: string) => `\x1b[${code}m${s}${RESET}`;
}

const IDENTITY = (s: string): string => s;

const ENABLED_FNS: ColorFns = {
  running: wrap(33),   // yellow
  completed: wrap(32), // green
  error: wrap(31),     // red
  killed: wrap(35),    // magenta
  dim: wrap(2),        // dim
  bold: wrap(1),       // bold
};

const DISABLED_FNS: ColorFns = {
  running: IDENTITY,
  completed: IDENTITY,
  error: IDENTITY,
  killed: IDENTITY,
  dim: IDENTITY,
  bold: IDENTITY,
};

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function makeColors(enabled: boolean): ColorFns {
  return enabled ? ENABLED_FNS : DISABLED_FNS;
}

// -----------------------------------------------------------------------------
// Auto-detect helper — TTY + FORCE_COLOR
// -----------------------------------------------------------------------------

export interface TtyLike {
  readonly isTTY?: boolean;
}

/**
 * Resolves whether colors should be enabled for the given stream.
 * Rules (in order):
 *  1. `FORCE_COLOR=1` in env  → enabled
 *  2. `NO_COLOR` set and non-empty → disabled
 *  3. `stream.isTTY === true`  → enabled
 *  4. default → disabled
 */
export function resolveColorsEnabled(
  stream: TtyLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env["FORCE_COLOR"] === "1") return true;
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor.length > 0) return false;
  return stream.isTTY === true;
}
