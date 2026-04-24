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
// The public API `createLogger(namespace)` is exported from the root index.ts
// via `./logger.js` (file-routing version, zero-stdout guarantee — Phase 7.5).
// The obs/logger.ts stderr-based factory is available for internal use via
// direct import: `import { createLogger as createStderrLogger } from "./obs/logger.js"`.
export {
  type CreateLoggerOptions,
  type LogFields,
  type LogLevel,
  type LogSink,
  type Logger,
} from "./logger.js";
