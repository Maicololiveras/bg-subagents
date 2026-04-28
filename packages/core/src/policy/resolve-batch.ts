/**
 * resolveBatch — Phase 8.6
 *
 * Thin standalone helper for Plan Review: resolves a batch of task call
 * entries to PolicyDecision[] using a flat config object (the `policy` key
 * from bgSubagents config in opencode.json).
 *
 * This intentionally does NOT depend on the full PolicyResolver class
 * (which carries the JSONC loader, schema validation, picker timeout, etc.)
 * because Plan Review operates on a simpler, flat config extracted at plugin
 * boot time. The full PolicyResolver is used for the per-call legacy path.
 *
 * Priority (per spec task 8.5):
 *   1. sessionOverride "bg" → all background
 *      sessionOverride "fg" → all foreground
 *      sessionOverride "default" or undefined → fall through to config
 *   2. per-agent exact match in config[agentName]
 *   3. wildcard config["*"] fallback
 *   4. hardcoded fallback: "background" (no config at all)
 *
 * Portability: no path resolution, no file I/O, no process-specific concerns.
 * Fully portable across Windows / POSIX / CI.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 8.5–8.6
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One entry in the batch — corresponds to one `task` tool-invocation part.
 */
export interface BatchEntry {
  readonly call_id: string;
  readonly agent_name: string;
}

/**
 * Flat policy map extracted from opencode.json bgSubagents.policy.
 * Keys are agent names or "*" for wildcard. Values are modes.
 */
export type FlatPolicyConfig = Record<string, "background" | "foreground">;

/**
 * Session-level override from the `/task policy <mode>` slash command.
 * "default" explicitly clears the override and reverts to per-agent config.
 */
export type SessionOverride = "bg" | "fg" | "default";

/**
 * One resolved decision — one per input entry.
 */
export interface PolicyDecision {
  readonly call_id: string;
  readonly agent_name: string;
  readonly mode: "foreground" | "background";
}

/**
 * Full input bag for resolveBatch.
 */
export interface BatchPolicyInput {
  readonly entries: readonly BatchEntry[];
  readonly policy: FlatPolicyConfig;
  readonly sessionOverride?: SessionOverride;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const HARDCODED_FALLBACK: "background" = "background";

/**
 * Resolve a batch of task call entries to PolicyDecision[].
 *
 * @param input - Batch entries, flat policy config, and optional session override.
 * @returns One PolicyDecision per entry, in the same order as input.entries.
 */
export function resolveBatch(input: BatchPolicyInput): PolicyDecision[] {
  const { entries, policy, sessionOverride } = input;

  if (entries.length === 0) return [];

  // Normalize session override:
  //   "bg" → force background for all
  //   "fg" → force foreground for all
  //   "default" or undefined → per-agent config
  const forceMode: "background" | "foreground" | null =
    sessionOverride === "bg"
      ? "background"
      : sessionOverride === "fg"
        ? "foreground"
        : null;

  return entries.map((entry) => {
    let mode: "background" | "foreground";

    if (forceMode !== null) {
      // Session override wins unconditionally.
      mode = forceMode;
    } else {
      // Per-agent config lookup.
      const byName = policy[entry.agent_name];
      if (byName !== undefined) {
        mode = byName;
      } else {
        const wildcard = policy["*"];
        mode = wildcard !== undefined ? wildcard : HARDCODED_FALLBACK;
      }
    }

    return {
      call_id: entry.call_id,
      agent_name: entry.agent_name,
      mode,
    };
  });
}
