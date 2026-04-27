/**
 * Public barrel for the core obs module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export {
  __forPlatform__,
  expandEnv,
  expandTilde,
  resolveConfigDir,
  resolveHistoryPath,
  resolvePolicyPath,
  resolveStateDir,
  safePathSegment,
  type PlatformOverride,
} from "./paths.js";

// NOTE: createLogger is intentionally NOT re-exported from this barrel.
// The public API createLogger(namespace) is exported from the root index.ts
// via the root-level logger module (file-routing version, zero-stdout
// guarantee — Phase 7.5). The stderr-based factory in this folder remains
// available for internal use via direct sibling import (createStderrLogger
// alias), but the public surface is the root-level logger only.
export {
  type CreateLoggerOptions,
  type LogFields,
  type LogLevel,
  type LogSink,
  type Logger,
} from "./logger.js";
