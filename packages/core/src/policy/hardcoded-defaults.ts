/**
 * Baseline hardcoded policy applied when no policy.jsonc exists on disk.
 *
 * Design rule: this object MUST be schema-valid (PolicySchema.parse would
 * accept it) even when the user has not touched their config. Test harness
 * enforces this invariant.
 *
 * Path helpers previously lived here — since Batch 5b they delegate to
 * `obs/paths.ts`, which is the single source of truth for XDG + Windows
 * fallback semantics. Re-exports are preserved for backward compatibility.
 */
import type { Policy } from "@maicolextic/bg-subagents-protocol";

import { resolveConfigDir, resolveHistoryPath } from "../obs/paths.js";

// -----------------------------------------------------------------------------
// Filesystem path helpers — delegated to obs/paths.ts (single source of truth)
// -----------------------------------------------------------------------------

/**
 * Compute the directory under which bg-subagents keeps config.
 *
 * @deprecated Use `resolveConfigDir()` from `@maicolextic/bg-subagents-core` (obs module).
 *             Kept as a re-export for backward compatibility with Batch 2
 *             consumers.
 */
export function resolveDefaultConfigDir(): string {
  return resolveConfigDir();
}

/**
 * Absolute path to the default history.jsonl location.
 *
 * @deprecated Use `resolveHistoryPath()` from `@maicolextic/bg-subagents-core` (obs module).
 *             Kept as a re-export for backward compatibility with Batch 3
 *             consumers (HistoryStore default).
 */
export function resolveDefaultHistoryPath(): string {
  return resolveHistoryPath();
}

// -----------------------------------------------------------------------------
// HARDCODED_DEFAULT_POLICY
// -----------------------------------------------------------------------------

/**
 * The baseline policy applied when no policy.jsonc exists (or it fails to
 * load non-fatally). Permissive by design: picker asks on every invocation
 * (no rules match → fallback "ask") and all security fields are reserved as
 * undefined so enforcement code in v0.2+ can treat missing === no-limit.
 *
 * NFR-9: telemetry MUST be off by default — users opt in explicitly.
 * Q4: history defaults pinned to 10 MB rotation, 30-day retention.
 */
export const HARDCODED_DEFAULT_POLICY: Policy = Object.freeze({
  default_mode_by_agent_type: Object.freeze({}) as Readonly<Record<string, never>>,
  // default_mode_by_agent_name is omitted (optional) → picker falls through
  // to the hardcoded "ask" fallback for unknown agents.
  timeout_ms: 2000,
  security: Object.freeze({
    // All three fields reserved/undefined in v0.1 — schema accepts them,
    // runtime ignores them (activation in v0.2/v0.3 per FR-13).
  }) as Policy["security"],
  history: Object.freeze({
    rotation_size_mb: 10,
    retention_days: 30,
  }) as Policy["history"],
  telemetry: Object.freeze({
    enabled: false,
  }) as Policy["telemetry"],
}) as Policy;
