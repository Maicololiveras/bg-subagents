/**
 * Public barrel for the core policy module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export {
  HARDCODED_DEFAULT_POLICY,
  resolveDefaultConfigDir,
  resolveDefaultHistoryPath,
} from "./hardcoded-defaults.js";

export {
  loadPolicy,
  resolveDefaultPolicyPath,
} from "./loader.js";

export {
  HistoryConfigSchema,
  LoadedPolicySchema,
  LoadedPolicySourceSchema,
  parsePolicyFile,
  PolicySchema,
  SecurityLimitsSchema,
  TelemetryConfigSchema,
  type LoadedPolicy,
  type LoadedPolicySource,
  type Policy,
} from "./schema.js";

export {
  PolicyResolver,
  type Invocation,
  type PolicyLoaderFn,
  type ResolvedPolicy,
  type ResolvedPolicySource,
} from "./resolver.js";

export {
  resolveBatch,
  type BatchEntry as PolicyBatchEntry,
  type BatchPolicyInput,
  type FlatPolicyConfig,
  type PolicyDecision,
  type SessionOverride,
} from "./resolve-batch.js";
