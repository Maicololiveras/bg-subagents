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

export {
  createLogger,
  type CreateLoggerOptions,
  type LogFields,
  type LogLevel,
  type LogSink,
  type Logger,
} from "./logger.js";
