/**
 * Public barrel for @maicolextic/bg-subagents-core.
 *
 * v0.1 surface: policy + task + picker + invoker + obs + cli modules.
 * Convenience factories (`createDefaultInvoker`, `createDefaultPicker`,
 * `createLogger`) are re-exported from their submodule barrels — consumers
 * import everything from the root.
 */

export * from "./policy/index.js";
export * from "./task/index.js";
export * from "./picker/index.js";
export * from "./invoker/index.js";
export * from "./obs/index.js";
export * from "./cli/index.js";
