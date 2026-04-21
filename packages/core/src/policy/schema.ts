/**
 * Schema layer for the core policy module.
 *
 * IMPORTANT: Core does NOT redefine zod schemas. Policy/Security/History/Telemetry
 * schemas are re-exported verbatim from @maicolextic/bg-subagents-protocol. Only the
 * LoadedPolicy wrapper + parsePolicyFile helper live here — they belong to the
 * loader surface, not the wire contract.
 */
import { z } from "zod";

import {
  HistoryConfigSchema,
  PolicySchema,
  SecurityLimitsSchema,
  TelemetryConfigSchema,
  type Policy,
} from "@maicolextic/bg-subagents-protocol";

// -----------------------------------------------------------------------------
// Re-exports (SSOT stays in @maicolextic/bg-subagents-protocol)
// -----------------------------------------------------------------------------

export { HistoryConfigSchema, PolicySchema, SecurityLimitsSchema, TelemetryConfigSchema };
export type { Policy };

// -----------------------------------------------------------------------------
// LoadedPolicy wrapper — loader output contract
// -----------------------------------------------------------------------------

/**
 * Source of a loaded policy:
 *   - "file"    → read from a real policy.jsonc on disk.
 *   - "default" → no file found (or unreadable) → hardcoded default applied.
 */
export const LoadedPolicySourceSchema = z.enum(["file", "default"]);
export type LoadedPolicySource = z.infer<typeof LoadedPolicySourceSchema>;

/**
 * Wrapper around a parsed Policy carrying the loader metadata callers need
 * (where it came from, any minor-bump migration that happened, warnings).
 */
export const LoadedPolicySchema = z.object({
  policy: PolicySchema,
  source: LoadedPolicySourceSchema,
  migrated: z.literal(true).optional(),
  warnings: z.array(z.string()),
});

export type LoadedPolicy = {
  readonly policy: Policy;
  readonly source: LoadedPolicySource;
  readonly migrated?: true;
  readonly warnings: readonly string[];
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Validate a raw object against PolicySchema and wrap it as a LoadedPolicy with
 * `source: "file"` metadata. Intended for consumers that already produced a
 * parsed JSON value (e.g. from an IPC boundary). The loader on disk uses the
 * same normalization path but adds JSONC parsing + migration handling around it.
 */
export function parsePolicyFile(raw: unknown): LoadedPolicy {
  const policy = PolicySchema.parse(raw) as Policy;
  return {
    policy,
    source: "file",
    warnings: [],
  };
}
