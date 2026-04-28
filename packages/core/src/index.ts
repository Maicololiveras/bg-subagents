/**
 * Public barrel for @maicolextic/bg-subagents-core.
 *
 * v0.1 surface: policy + task + picker + invoker + obs + cli modules.
 * Convenience factories (`createDefaultInvoker`, `createDefaultPicker`,
 * `createLogger`) are re-exported from their submodule barrels — consumers
 * import everything from the root.
 *
 * Phase 7.5: `createLogger` is re-exported from `./logger.js` (file-routing,
 * zero-stdout guarantee). The obs-layer logger (stderr-based) remains available
 * internally via direct import but the public `createLogger` factory is now
 * the file-routing namespace-based version.
 */

export * from "./policy/index.js";
export * from "./task/index.js";
export * from "./picker/index.js";
export * from "./invoker/index.js";
export * from "./obs/index.js";
export * from "./cli/index.js";

// Phase 7.5: file-routing logger (overrides the obs-layer createLogger export).
// Must come AFTER obs/index so the named export here takes precedence.
export { createLogger, type FileLogger } from "./logger.js";
